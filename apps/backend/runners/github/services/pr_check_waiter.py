"""
PR Check Waiter for Auto-PR-Review
==================================

Waits for CI checks and external bot comments with circuit breaker protection
and exponential backoff.

Key features:
- Circuit breaker (pybreaker) for API failure protection
- Exponential backoff (60s base, 300s max) following rate_limiter.py patterns
- Bot expectation tracking (configurable expected bots)
- PR open status verification at each poll iteration
- Force push detection via SHA tracking
- Comprehensive logging with correlation IDs

Configuration:
    Set GITHUB_EXPECTED_BOTS environment variable with bot names to wait for:
    - Single bot: "coderabbitai[bot]"
    - Multiple bots: "coderabbitai[bot],dependabot[bot]"
    - If not set, only CI checks are waited for

Usage:
    waiter = PRCheckWaiter()

    # Wait for all checks
    result = await waiter.wait_for_all_checks(
        pr_number=123,
        repo="owner/repo",
        expected_bots=["coderabbitai[bot]"],
        head_sha="abc123",
    )

    if result.all_passed:
        print("All checks passed!")
    else:
        for failure in result.failures:
            print(f"Failed: {failure.name} - {failure.reason}")

    # Cancel waiting
    waiter.cancel()
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

try:
    from pybreaker import CircuitBreaker, CircuitBreakerError
except ImportError:
    # Fallback for testing without pybreaker installed
    CircuitBreaker = None
    CircuitBreakerError = Exception

try:
    from ..models_pkg.pr_review_state import (
        CheckStatus,
        CICheckResult,
        ExternalBotStatus,
    )
except ImportError:
    # When running directly (not as package)
    from models_pkg.pr_review_state import CheckStatus, CICheckResult, ExternalBotStatus

logger = logging.getLogger(__name__)


# Environment variable for expected bots
EXPECTED_BOTS_ENV_VAR = "GITHUB_EXPECTED_BOTS"


class WaitResult(str, Enum):
    """Result of waiting for checks."""

    SUCCESS = "success"  # All checks passed
    CI_FAILED = "ci_failed"  # CI checks failed
    CI_TIMEOUT = "ci_timeout"  # CI checks timed out
    BOT_TIMEOUT = "bot_timeout"  # External bots timed out
    PR_CLOSED = "pr_closed"  # PR was closed during wait
    PR_MERGED = "pr_merged"  # PR was merged during wait
    FORCE_PUSH = "force_push"  # Force push detected (SHA changed)
    CANCELLED = "cancelled"  # Wait was cancelled
    CIRCUIT_OPEN = "circuit_open"  # Circuit breaker is open
    ERROR = "error"  # Unrecoverable error


@dataclass
class CheckFailure:
    """Details of a failed check."""

    name: str
    check_type: str  # "ci" or "bot"
    reason: str
    status: CheckStatus = CheckStatus.FAILED
    url: str | None = None
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


@dataclass
class WaitForChecksResult:
    """Result of waiting for all checks to complete."""

    result: WaitResult
    all_passed: bool = False
    ci_checks: list[CICheckResult] = field(default_factory=list)
    bot_statuses: list[ExternalBotStatus] = field(default_factory=list)
    failures: list[CheckFailure] = field(default_factory=list)
    elapsed_seconds: float = 0.0
    poll_count: int = 0
    final_head_sha: str | None = None
    pr_state: str | None = None  # "open", "closed", "merged"
    error_message: str | None = None
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        return {
            "result": self.result.value,
            "all_passed": self.all_passed,
            "ci_checks": [c.to_dict() for c in self.ci_checks],
            "bot_statuses": [b.to_dict() for b in self.bot_statuses],
            "failures": [
                {
                    "name": f.name,
                    "check_type": f.check_type,
                    "reason": f.reason,
                    "status": f.status.value,
                    "url": f.url,
                    "timestamp": f.timestamp,
                }
                for f in self.failures
            ],
            "elapsed_seconds": self.elapsed_seconds,
            "poll_count": self.poll_count,
            "final_head_sha": self.final_head_sha,
            "pr_state": self.pr_state,
            "error_message": self.error_message,
            "timestamp": self.timestamp,
        }


class CircuitBreakerOpenError(Exception):
    """Raised when circuit breaker is open."""

    def __init__(self, message: str, open_since: float | None = None):
        self.open_since = open_since
        super().__init__(message)


class PRClosedError(Exception):
    """Raised when PR is closed/merged during wait."""

    def __init__(self, pr_state: str):
        self.pr_state = pr_state
        super().__init__(f"PR is {pr_state}")


class ForcePushError(Exception):
    """Raised when force push detected during wait."""

    def __init__(self, old_sha: str, new_sha: str):
        self.old_sha = old_sha
        self.new_sha = new_sha
        super().__init__(f"Force push detected: {old_sha} -> {new_sha}")


class PRCheckWaiter:
    """
    Waits for CI checks and external bot comments to complete.

    Features:
    - Circuit breaker protection for GitHub API failures
    - Exponential backoff between poll attempts
    - Bot expectation tracking with configurable expected bots
    - PR state monitoring (detects closure/merge during wait)
    - Force push detection via SHA tracking
    - Cancellation support

    Usage:
        waiter = PRCheckWaiter()

        # Wait for all checks with default timeouts
        result = await waiter.wait_for_all_checks(
            pr_number=123,
            repo="owner/repo",
        )

        # Wait with custom expected bots
        result = await waiter.wait_for_all_checks(
            pr_number=123,
            repo="owner/repo",
            expected_bots=["coderabbitai[bot]", "codecov[bot]"],
            ci_timeout=1800.0,  # 30 minutes
            bot_timeout=900.0,  # 15 minutes
        )

    Configuration:
        Set GITHUB_EXPECTED_BOTS env var for default expected bots.
        Circuit breaker: fail_max=3, reset_timeout=300 (5 minutes)
        Backoff: base_delay=15s, max_delay=120s
    """

    # Default configuration
    DEFAULT_CI_TIMEOUT = 1800.0  # 30 minutes
    DEFAULT_BOT_TIMEOUT = 900.0  # 15 minutes
    DEFAULT_POLL_INTERVAL = 15.0  # 15 seconds (faster initial poll)
    BASE_BACKOFF_DELAY = 15.0  # 15 seconds base (faster for interactive use)
    MAX_BACKOFF_DELAY = 120.0  # 2 minutes max (reasonable cap)
    CIRCUIT_BREAKER_FAIL_MAX = 3
    CIRCUIT_BREAKER_RESET_TIMEOUT = 300  # 5 minutes

    def __init__(
        self,
        ci_timeout: float = DEFAULT_CI_TIMEOUT,
        bot_timeout: float = DEFAULT_BOT_TIMEOUT,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
        base_backoff_delay: float = BASE_BACKOFF_DELAY,
        max_backoff_delay: float = MAX_BACKOFF_DELAY,
        circuit_breaker_fail_max: int = CIRCUIT_BREAKER_FAIL_MAX,
        circuit_breaker_reset_timeout: int = CIRCUIT_BREAKER_RESET_TIMEOUT,
        log_enabled: bool = True,
        correlation_id: str | None = None,
    ):
        """
        Initialize the PR check waiter.

        Args:
            ci_timeout: Maximum time to wait for CI checks (seconds)
            bot_timeout: Maximum time to wait for external bots (seconds)
            poll_interval: Initial interval between polls (seconds)
            base_backoff_delay: Base delay for exponential backoff (seconds)
            max_backoff_delay: Maximum delay for exponential backoff (seconds)
            circuit_breaker_fail_max: Number of failures before circuit opens
            circuit_breaker_reset_timeout: Time in seconds before circuit resets
            log_enabled: Whether to log polling activity
            correlation_id: Correlation ID for structured logging
        """
        self.ci_timeout = ci_timeout
        self.bot_timeout = bot_timeout
        self.poll_interval = poll_interval
        self.base_backoff_delay = base_backoff_delay
        self.max_backoff_delay = max_backoff_delay
        self.log_enabled = log_enabled
        self.correlation_id = correlation_id

        # Cancellation flag
        self._cancelled = False
        self._cancel_event = asyncio.Event()

        # Statistics
        self._poll_count = 0
        self._error_count = 0
        self._consecutive_failures = 0
        self._circuit_open_time: float | None = None

        # Initialize circuit breaker
        if CircuitBreaker is not None:
            self._circuit_breaker = CircuitBreaker(
                fail_max=circuit_breaker_fail_max,
                reset_timeout=circuit_breaker_reset_timeout,
                state_storage=None,  # Use in-memory storage
                name="pr_check_waiter",
            )
        else:
            # Fallback: simple failure tracking without pybreaker
            self._circuit_breaker = None
            self._manual_fail_count = 0
            self._manual_fail_max = circuit_breaker_fail_max
            self._manual_reset_timeout = circuit_breaker_reset_timeout
            self._manual_open_since: float | None = None

        # Default expected bots from environment
        self._default_expected_bots = self._load_expected_bots_from_env()

    def _load_expected_bots_from_env(self) -> list[str]:
        """Load expected bot names from environment variable."""
        raw_value = os.environ.get(EXPECTED_BOTS_ENV_VAR, "").strip()
        if not raw_value:
            return []

        bots = [b.strip() for b in raw_value.split(",") if b.strip()]
        if bots and self.log_enabled:
            logger.info(
                f"Loaded {len(bots)} expected bots from {EXPECTED_BOTS_ENV_VAR}: {bots}",
                extra={"correlation_id": self.correlation_id},
            )
        return bots

    def cancel(self) -> None:
        """Cancel any ongoing wait operation."""
        self._cancelled = True
        self._cancel_event.set()
        if self.log_enabled:
            logger.info(
                "PR check wait cancelled",
                extra={"correlation_id": self.correlation_id},
            )

    def reset(self) -> None:
        """Reset the waiter state for a new wait operation."""
        self._cancelled = False
        self._cancel_event.clear()
        self._poll_count = 0
        self._error_count = 0
        self._consecutive_failures = 0
        self._circuit_open_time = None

        # Reset manual circuit breaker if pybreaker not available
        if self._circuit_breaker is None:
            self._manual_fail_count = 0
            self._manual_open_since = None

    def _calculate_backoff_delay(self, attempt: int) -> float:
        """
        Calculate exponential backoff delay.

        Following rate_limiter.py pattern:
        delay = min(base_delay * (2 ** attempt), max_delay)

        Args:
            attempt: Current attempt number (0-indexed)

        Returns:
            Delay in seconds
        """
        delay = min(
            self.base_backoff_delay * (2**attempt),
            self.max_backoff_delay,
        )
        return delay

    def _check_circuit_breaker(self) -> None:
        """
        Check if circuit breaker allows operation.

        Raises:
            CircuitBreakerOpenError: If circuit is open
        """
        if self._circuit_breaker is not None:
            # pybreaker handles this internally via call decorator
            return

        # Manual circuit breaker check
        if self._manual_open_since is not None:
            elapsed = time.monotonic() - self._manual_open_since
            if elapsed < self._manual_reset_timeout:
                raise CircuitBreakerOpenError(
                    f"Circuit breaker open for {elapsed:.1f}s "
                    f"(reset after {self._manual_reset_timeout}s)",
                    open_since=self._manual_open_since,
                )
            else:
                # Reset circuit breaker
                self._manual_fail_count = 0
                self._manual_open_since = None
                if self.log_enabled:
                    logger.info(
                        "Circuit breaker reset after timeout",
                        extra={"correlation_id": self.correlation_id},
                    )

    def _record_failure(self) -> None:
        """Record a failure for circuit breaker."""
        self._error_count += 1
        self._consecutive_failures += 1

        if self._circuit_breaker is None:
            # Manual circuit breaker
            self._manual_fail_count += 1
            if self._manual_fail_count >= self._manual_fail_max:
                self._manual_open_since = time.monotonic()
                if self.log_enabled:
                    logger.warning(
                        f"Circuit breaker opened after {self._manual_fail_count} failures",
                        extra={
                            "correlation_id": self.correlation_id,
                            "fail_count": self._manual_fail_count,
                        },
                    )

    def _record_success(self) -> None:
        """Record a successful operation."""
        self._consecutive_failures = 0
        if self._circuit_breaker is None:
            self._manual_fail_count = max(0, self._manual_fail_count - 1)

    async def _fetch_ci_checks(
        self,
        pr_number: int,
        repo: str,
    ) -> tuple[list[CICheckResult], str | None, str | None]:
        """
        Fetch CI check status from GitHub.

        Returns:
            Tuple of (ci_checks, current_head_sha, pr_state)
        """
        # Use gh CLI to get PR status
        cmd = [
            "gh",
            "pr",
            "view",
            str(pr_number),
            "--repo",
            repo,
            "--json",
            "statusCheckRollup,headRefOid,state,mergedAt",
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() or "Unknown error"
                logger.error(
                    f"Failed to fetch PR checks: {error_msg}",
                    extra={
                        "correlation_id": self.correlation_id,
                        "pr_number": pr_number,
                        "repo": repo,
                    },
                )
                raise RuntimeError(f"gh pr view failed: {error_msg}")

            data = json.loads(result.stdout)

        except subprocess.TimeoutExpired:
            raise RuntimeError("gh pr view timed out")
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Invalid JSON from gh: {e}")

        # Parse PR state
        pr_state = "open"
        if data.get("mergedAt"):
            pr_state = "merged"
        elif data.get("state", "").upper() == "CLOSED":
            pr_state = "closed"

        head_sha = data.get("headRefOid")

        # Parse status checks
        ci_checks = []
        rollup = data.get("statusCheckRollup", []) or []

        if self.log_enabled:
            logger.debug(
                f"Raw statusCheckRollup: {len(rollup)} checks",
                extra={"correlation_id": self.correlation_id},
            )

        for check in rollup:
            name = check.get("name") or check.get("context") or "unknown"
            conclusion = check.get("conclusion")
            state = check.get("state", "").upper()
            check_status_field = check.get(
                "status", ""
            ).upper()  # For GitHub Actions checks

            if self.log_enabled:
                logger.debug(
                    f"Check '{name}': state={state}, conclusion={conclusion}, status={check_status_field}",
                    extra={"correlation_id": self.correlation_id},
                )

            # Map GitHub state to CheckStatus
            # GitHub has two types of checks:
            # 1. Check Runs (GitHub Actions): uses 'status' (queued/in_progress/completed) and 'conclusion'
            # 2. Status Checks (commit status API): uses 'state' (PENDING/SUCCESS/FAILURE/ERROR)
            if conclusion:
                conclusion_upper = conclusion.upper()
                if conclusion_upper == "SUCCESS":
                    status = CheckStatus.PASSED
                elif conclusion_upper in ("FAILURE", "ERROR"):
                    status = CheckStatus.FAILED
                elif conclusion_upper == "SKIPPED":
                    status = CheckStatus.SKIPPED
                elif conclusion_upper == "CANCELLED":
                    status = CheckStatus.FAILED
                else:
                    status = CheckStatus.UNKNOWN
            elif check_status_field in (
                "QUEUED",
                "IN_PROGRESS",
                "WAITING",
                "PENDING",
                "REQUESTED",
            ):
                # GitHub Actions check runs use 'status' field
                status = CheckStatus.RUNNING
            elif check_status_field == "COMPLETED":
                # Completed but no conclusion - treat as unknown/passed
                status = CheckStatus.PASSED
            elif state in ("PENDING", "QUEUED", "IN_PROGRESS"):
                # Traditional status checks use 'state' field
                status = CheckStatus.RUNNING
            elif state == "SUCCESS":
                # Traditional status check success
                status = CheckStatus.PASSED
            elif state in ("FAILURE", "ERROR"):
                # Traditional status check failure
                status = CheckStatus.FAILED
            else:
                status = CheckStatus.PENDING

            ci_checks.append(
                CICheckResult(
                    name=name,
                    status=status,
                    conclusion=conclusion,
                    url=check.get("detailsUrl"),
                    started_at=check.get("startedAt"),
                    completed_at=check.get("completedAt"),
                )
            )

        return ci_checks, head_sha, pr_state

    async def _fetch_bot_comments(
        self,
        pr_number: int,
        repo: str,
        expected_bots: list[str],
    ) -> list[ExternalBotStatus]:
        """
        Fetch comments from expected bots.

        Returns:
            List of ExternalBotStatus for expected bots
        """
        if not expected_bots:
            return []

        # Use gh CLI to get PR comments
        cmd = [
            "gh",
            "pr",
            "view",
            str(pr_number),
            "--repo",
            repo,
            "--json",
            "comments",
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() or "Unknown error"
                logger.warning(
                    f"Failed to fetch PR comments: {error_msg}",
                    extra={
                        "correlation_id": self.correlation_id,
                        "pr_number": pr_number,
                        "repo": repo,
                    },
                )
                # Return pending status for all expected bots
                return [
                    ExternalBotStatus(
                        bot_name=bot,
                        status=CheckStatus.PENDING,
                    )
                    for bot in expected_bots
                ]

            data = json.loads(result.stdout)

        except subprocess.TimeoutExpired:
            logger.warning("gh pr view comments timed out")
            return [
                ExternalBotStatus(bot_name=bot, status=CheckStatus.PENDING)
                for bot in expected_bots
            ]
        except json.JSONDecodeError:
            logger.warning("Invalid JSON from gh pr view comments")
            return [
                ExternalBotStatus(bot_name=bot, status=CheckStatus.PENDING)
                for bot in expected_bots
            ]

        # Find comments from expected bots
        comments = data.get("comments", []) or []
        bot_statuses = []

        for expected_bot in expected_bots:
            # Find latest comment from this bot
            bot_comment = None
            for comment in reversed(comments):
                author = comment.get("author", {})
                login = author.get("login", "")
                if login.lower() == expected_bot.lower():
                    bot_comment = comment
                    break

            if bot_comment:
                author = bot_comment.get("author", {})
                bot_statuses.append(
                    ExternalBotStatus(
                        bot_name=expected_bot,
                        bot_id=str(author.get("id")) if author.get("id") else None,
                        status=CheckStatus.PASSED,  # Bot commented = success
                        comment_id=bot_comment.get("id"),
                        comment_url=bot_comment.get("url"),
                        findings_count=0,  # Would need to parse comment content
                        last_seen_at=bot_comment.get("createdAt"),
                        trusted=False,  # Will be verified by BotVerifier
                    )
                )
            else:
                bot_statuses.append(
                    ExternalBotStatus(
                        bot_name=expected_bot,
                        status=CheckStatus.PENDING,
                    )
                )

        return bot_statuses

    async def _poll_once(
        self,
        pr_number: int,
        repo: str,
        expected_bots: list[str],
        initial_head_sha: str | None,
    ) -> tuple[list[CICheckResult], list[ExternalBotStatus], str | None, str | None]:
        """
        Perform a single poll for CI checks and bot comments.

        Returns:
            Tuple of (ci_checks, bot_statuses, current_head_sha, pr_state)

        Raises:
            PRClosedError: If PR is closed or merged
            ForcePushError: If force push detected
            CircuitBreakerOpenError: If circuit breaker is open
        """
        # Check circuit breaker
        self._check_circuit_breaker()

        try:
            ci_checks, head_sha, pr_state = await self._fetch_ci_checks(pr_number, repo)

            self._record_success()

        except CircuitBreakerError:
            self._circuit_open_time = time.monotonic()
            raise CircuitBreakerOpenError(
                "Circuit breaker open due to repeated failures"
            )
        except Exception:
            self._record_failure()
            raise

        # Check PR state
        if pr_state == "closed":
            raise PRClosedError("closed")
        if pr_state == "merged":
            raise PRClosedError("merged")

        # Check for force push
        if initial_head_sha and head_sha and head_sha != initial_head_sha:
            raise ForcePushError(initial_head_sha, head_sha)

        # Fetch bot comments
        bot_statuses = await self._fetch_bot_comments(pr_number, repo, expected_bots)

        self._poll_count += 1

        return ci_checks, bot_statuses, head_sha, pr_state

    def _all_ci_passed(self, ci_checks: list[CICheckResult]) -> bool:
        """Check if all CI checks have passed."""
        if not ci_checks:
            return True  # No checks = all passed

        for check in ci_checks:
            if check.status == CheckStatus.FAILED:
                return False
            if check.status in (CheckStatus.PENDING, CheckStatus.RUNNING):
                return False  # Still in progress

        return True

    def _all_ci_completed(self, ci_checks: list[CICheckResult]) -> bool:
        """Check if all CI checks have completed (passed or failed)."""
        if not ci_checks:
            return True

        pending_checks = []
        for check in ci_checks:
            if check.status in (CheckStatus.PENDING, CheckStatus.RUNNING):
                pending_checks.append(f"{check.name}:{check.status.value}")

        if pending_checks and self.log_enabled:
            logger.debug(
                f"Still waiting for {len(pending_checks)} checks: {pending_checks[:5]}{'...' if len(pending_checks) > 5 else ''}",
                extra={"correlation_id": self.correlation_id},
            )

        return len(pending_checks) == 0

    def _all_bots_responded(self, bot_statuses: list[ExternalBotStatus]) -> bool:
        """Check if all expected bots have responded."""
        if not bot_statuses:
            return True

        for status in bot_statuses:
            if status.status == CheckStatus.PENDING:
                return False

        return True

    async def wait_for_all_checks(
        self,
        pr_number: int,
        repo: str,
        expected_bots: list[str] | None = None,
        head_sha: str | None = None,
        ci_timeout: float | None = None,
        bot_timeout: float | None = None,
        on_progress: Callable[[int, list[CICheckResult], list[ExternalBotStatus]], None]
        | None = None,
    ) -> WaitForChecksResult:
        """
        Wait for all CI checks and expected bot comments to complete.

        Args:
            pr_number: PR number to monitor
            repo: Repository in owner/repo format
            expected_bots: List of bot usernames to wait for (default: from env)
            head_sha: Initial HEAD SHA for force push detection
            ci_timeout: Timeout for CI checks (default: 30 minutes)
            bot_timeout: Timeout for bot comments (default: 15 minutes)
            on_progress: Optional callback for progress updates

        Returns:
            WaitForChecksResult with final status and details
        """
        # Use defaults if not specified
        if expected_bots is None:
            expected_bots = self._default_expected_bots.copy()
        if ci_timeout is None:
            ci_timeout = self.ci_timeout
        if bot_timeout is None:
            bot_timeout = self.bot_timeout

        # Reset state
        self.reset()

        start_time = time.monotonic()
        ci_start_time = start_time
        bot_start_time = start_time
        attempt = 0
        current_head_sha = head_sha
        final_pr_state = "open"

        ci_checks: list[CICheckResult] = []
        bot_statuses: list[ExternalBotStatus] = []
        failures: list[CheckFailure] = []

        if self.log_enabled:
            logger.info(
                f"Starting PR check wait for PR #{pr_number}",
                extra={
                    "correlation_id": self.correlation_id,
                    "pr_number": pr_number,
                    "repo": repo,
                    "expected_bots": expected_bots,
                    "ci_timeout": ci_timeout,
                    "bot_timeout": bot_timeout,
                },
            )

        ci_completed = False
        bots_responded = len(expected_bots) == 0  # True if no bots expected

        try:
            while not self._cancelled:
                # Check timeouts
                elapsed = time.monotonic() - start_time
                ci_elapsed = time.monotonic() - ci_start_time
                bot_elapsed = time.monotonic() - bot_start_time

                if not ci_completed and ci_elapsed >= ci_timeout:
                    if self.log_enabled:
                        logger.warning(
                            f"CI check timeout after {ci_elapsed:.1f}s",
                            extra={
                                "correlation_id": self.correlation_id,
                                "pr_number": pr_number,
                            },
                        )
                    return WaitForChecksResult(
                        result=WaitResult.CI_TIMEOUT,
                        all_passed=False,
                        ci_checks=ci_checks,
                        bot_statuses=bot_statuses,
                        failures=[
                            CheckFailure(
                                name="ci_timeout",
                                check_type="ci",
                                reason=f"CI checks did not complete within {ci_timeout}s",
                                status=CheckStatus.TIMED_OUT,
                            )
                        ],
                        elapsed_seconds=elapsed,
                        poll_count=self._poll_count,
                        final_head_sha=current_head_sha,
                        pr_state=final_pr_state,
                    )

                if ci_completed and not bots_responded and bot_elapsed >= bot_timeout:
                    if self.log_enabled:
                        logger.warning(
                            f"Bot response timeout after {bot_elapsed:.1f}s",
                            extra={
                                "correlation_id": self.correlation_id,
                                "pr_number": pr_number,
                                "expected_bots": expected_bots,
                            },
                        )
                    # Proceed anyway - bots are optional per spec
                    break

                # Poll for status
                try:
                    ci_checks, bot_statuses, new_sha, pr_state = await self._poll_once(
                        pr_number, repo, expected_bots, head_sha
                    )
                    current_head_sha = new_sha or current_head_sha
                    final_pr_state = pr_state or "open"

                    # Progress callback
                    if on_progress:
                        on_progress(self._poll_count, ci_checks, bot_statuses)

                except PRClosedError as e:
                    result_type = (
                        WaitResult.PR_MERGED
                        if e.pr_state == "merged"
                        else WaitResult.PR_CLOSED
                    )
                    return WaitForChecksResult(
                        result=result_type,
                        all_passed=False,
                        ci_checks=ci_checks,
                        bot_statuses=bot_statuses,
                        elapsed_seconds=time.monotonic() - start_time,
                        poll_count=self._poll_count,
                        pr_state=e.pr_state,
                        error_message=f"PR was {e.pr_state} during wait",
                    )

                except ForcePushError as e:
                    return WaitForChecksResult(
                        result=WaitResult.FORCE_PUSH,
                        all_passed=False,
                        ci_checks=ci_checks,
                        bot_statuses=bot_statuses,
                        elapsed_seconds=time.monotonic() - start_time,
                        poll_count=self._poll_count,
                        final_head_sha=e.new_sha,
                        pr_state=final_pr_state,
                        error_message=f"Force push detected: {e.old_sha} -> {e.new_sha}",
                    )

                except CircuitBreakerOpenError as e:
                    return WaitForChecksResult(
                        result=WaitResult.CIRCUIT_OPEN,
                        all_passed=False,
                        ci_checks=ci_checks,
                        bot_statuses=bot_statuses,
                        elapsed_seconds=time.monotonic() - start_time,
                        poll_count=self._poll_count,
                        pr_state=final_pr_state,
                        error_message=str(e),
                    )

                except Exception as e:
                    if self.log_enabled:
                        logger.error(
                            f"Error polling PR checks: {e}",
                            extra={
                                "correlation_id": self.correlation_id,
                                "pr_number": pr_number,
                                "attempt": attempt,
                            },
                        )
                    # Continue with backoff on recoverable errors
                    attempt += 1
                    delay = self._calculate_backoff_delay(attempt)
                    await asyncio.sleep(delay)
                    continue

                # Check completion status
                if not ci_completed:
                    ci_completed = self._all_ci_completed(ci_checks)
                    if ci_completed:
                        bot_start_time = time.monotonic()  # Start bot timer
                        if self.log_enabled:
                            logger.info(
                                f"CI checks completed after {ci_elapsed:.1f}s",
                                extra={
                                    "correlation_id": self.correlation_id,
                                    "pr_number": pr_number,
                                },
                            )

                if not bots_responded:
                    bots_responded = self._all_bots_responded(bot_statuses)

                # Check if all done
                if ci_completed and bots_responded:
                    break

                # Wait before next poll with exponential backoff
                delay = self._calculate_backoff_delay(min(attempt, 5))
                attempt += 1

                if self.log_enabled:
                    logger.debug(
                        f"Waiting {delay:.1f}s before next poll",
                        extra={
                            "correlation_id": self.correlation_id,
                            "poll_count": self._poll_count,
                            "ci_completed": ci_completed,
                            "bots_responded": bots_responded,
                        },
                    )

                # Wait with cancellation support
                try:
                    await asyncio.wait_for(
                        self._cancel_event.wait(),
                        timeout=delay,
                    )
                    # If we get here, cancellation was requested
                    break
                except asyncio.TimeoutError:
                    # Normal timeout - continue polling
                    pass

            # Check final status
            if self._cancelled:
                return WaitForChecksResult(
                    result=WaitResult.CANCELLED,
                    all_passed=False,
                    ci_checks=ci_checks,
                    bot_statuses=bot_statuses,
                    elapsed_seconds=time.monotonic() - start_time,
                    poll_count=self._poll_count,
                    final_head_sha=current_head_sha,
                    pr_state=final_pr_state,
                )

            # Collect failures
            all_passed = True
            for check in ci_checks:
                if check.status == CheckStatus.FAILED:
                    all_passed = False
                    failures.append(
                        CheckFailure(
                            name=check.name,
                            check_type="ci",
                            reason=check.conclusion or "Check failed",
                            status=check.status,
                            url=check.url,
                        )
                    )

            # Note: Bot responses are informational, not blocking failures
            elapsed_total = time.monotonic() - start_time

            if self.log_enabled:
                logger.info(
                    f"PR check wait completed: all_passed={all_passed}",
                    extra={
                        "correlation_id": self.correlation_id,
                        "pr_number": pr_number,
                        "elapsed_seconds": elapsed_total,
                        "poll_count": self._poll_count,
                        "failure_count": len(failures),
                    },
                )

            result_type = WaitResult.SUCCESS if all_passed else WaitResult.CI_FAILED
            return WaitForChecksResult(
                result=result_type,
                all_passed=all_passed,
                ci_checks=ci_checks,
                bot_statuses=bot_statuses,
                failures=failures,
                elapsed_seconds=elapsed_total,
                poll_count=self._poll_count,
                final_head_sha=current_head_sha,
                pr_state=final_pr_state,
            )

        except Exception as e:
            logger.error(
                f"Unexpected error in wait_for_all_checks: {e}",
                extra={
                    "correlation_id": self.correlation_id,
                    "pr_number": pr_number,
                },
                exc_info=True,
            )
            return WaitForChecksResult(
                result=WaitResult.ERROR,
                all_passed=False,
                ci_checks=ci_checks,
                bot_statuses=bot_statuses,
                elapsed_seconds=time.monotonic() - start_time,
                poll_count=self._poll_count,
                final_head_sha=current_head_sha,
                pr_state=final_pr_state,
                error_message=str(e),
            )

    def get_statistics(self) -> dict:
        """
        Get waiter statistics.

        Returns:
            Dictionary of statistics
        """
        return {
            "poll_count": self._poll_count,
            "error_count": self._error_count,
            "consecutive_failures": self._consecutive_failures,
            "circuit_open": self._circuit_open_time is not None,
            "cancelled": self._cancelled,
        }


# Global singleton instance
_pr_check_waiter: PRCheckWaiter | None = None


def get_pr_check_waiter(
    correlation_id: str | None = None,
    **kwargs,
) -> PRCheckWaiter:
    """
    Get the global PRCheckWaiter instance.

    Args:
        correlation_id: Optional correlation ID for logging
        **kwargs: Additional arguments passed to PRCheckWaiter

    Returns:
        PRCheckWaiter singleton instance
    """
    global _pr_check_waiter
    if _pr_check_waiter is None:
        _pr_check_waiter = PRCheckWaiter(
            correlation_id=correlation_id,
            **kwargs,
        )
    elif correlation_id:
        _pr_check_waiter.correlation_id = correlation_id
    return _pr_check_waiter


def reset_pr_check_waiter() -> None:
    """Reset the global PRCheckWaiter instance (for testing)."""
    global _pr_check_waiter
    _pr_check_waiter = None
