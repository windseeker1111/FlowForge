"""
Autofix Processor
=================

Full pipeline processor for automatic issue fixing:
  Issue → Spec Creation → Build → QA → PR Creation → Auto-PR-Review Loop

Also connects the Auto-PR-Review workflow to QA pass events.

When QA passes on a PR, this processor triggers the AutoPRReviewOrchestrator
to automatically review and fix any remaining issues before human approval.

Key Features:
- Full Issue → PR pipeline
- Triggers auto PR review after QA passes
- Respects authorization checks
- Supports async and sync invocation
- NEVER auto-merges (human approval always required)

Usage:
    # Process an issue through the full pipeline
    processor = AutoFixProcessor(
        github_dir=Path(".auto-claude/github"),
        config=config,
    )
    state = await processor.process_issue(
        issue_number=123,
        issue=issue_data,
    )

    # Async usage for QA pass trigger
    result = await trigger_auto_pr_review_on_qa_pass(
        pr_number=123,
        repo="owner/repo",
        pr_url="https://github.com/owner/repo/pull/123",
        branch_name="feature-branch",
        triggered_by="qa-agent",
    )

    # Check if auto PR review is enabled
    if is_auto_pr_review_enabled():
        # Proceed with auto review
        pass
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import structlog

    logger = structlog.get_logger(__name__)
    STRUCTLOG_AVAILABLE = True
except ImportError:
    logger = logging.getLogger(__name__)
    STRUCTLOG_AVAILABLE = False

from .auto_pr_review_orchestrator import (
    OrchestratorResult,
    OrchestratorRunResult,
    get_auto_pr_review_orchestrator,
)

# =============================================================================
# AutoFixProcessor Class - Full Issue → PR Pipeline
# =============================================================================


class AutoFixProcessor:
    """
    Full pipeline processor for automatic issue fixing.

    Orchestrates the complete flow:
    1. Issue analysis
    2. Spec creation
    3. Build execution
    4. QA validation
    5. PR creation
    6. Auto-PR-Review trigger

    CRITICAL: NEVER auto-merges. Human approval is always required.
    """

    def __init__(
        self,
        github_dir: Path | None = None,
        config: Any = None,
        permission_checker: Any = None,
        progress_callback: Callable | None = None,
    ):
        """Initialize the AutoFixProcessor."""
        self.github_dir = Path(github_dir) if github_dir else DEFAULT_GITHUB_DIR
        self.config = config
        self.permission_checker = permission_checker
        self.progress_callback = progress_callback

    def _emit_progress(self, phase: str, progress: int, message: str, **extra) -> None:
        """Emit progress update."""
        if self.progress_callback:
            from dataclasses import dataclass

            @dataclass
            class ProgressCallback:
                phase: str
                progress: int
                message: str
                issue_number: int | None = None
                pr_number: int | None = None

            callback = ProgressCallback(
                phase=phase,
                progress=progress,
                message=message,
                issue_number=extra.get("issue_number"),
                pr_number=extra.get("pr_number"),
            )
            self.progress_callback(callback)
        _log_info(f"[{phase}] {message}", **extra)

    async def process_issue(
        self,
        issue_number: int,
        issue: dict | None = None,
        trigger_label: str | None = None,
        **kwargs,
    ) -> Any:
        """
        Process an issue through the full auto-fix pipeline.

        Pipeline:
        1. Analyze issue and create spec
        2. Run build
        3. Run QA validation
        4. If QA passes, create PR
        5. Trigger Auto-PR-Review loop

        Args:
            issue_number: The issue number to fix
            issue: Issue data (title, body, labels, etc.)
            trigger_label: Label that triggered this auto-fix

        Returns:
            AutoFixState tracking the progress
        """
        # Import here to avoid circular imports
        try:
            from ..models import AutoFixState, AutoFixStatus
        except ImportError:
            from models import AutoFixState, AutoFixStatus

        repo = self.config.repo if self.config else ""

        # Create initial state
        state = AutoFixState(
            issue_number=issue_number,
            issue_url=issue.get("html_url", "")
            if issue
            else f"https://github.com/{repo}/issues/{issue_number}",
            repo=repo,
            status=AutoFixStatus.PENDING,
        )

        try:
            # Save initial state
            await state.save(self.github_dir)

            # Phase 1: Analyze and create spec
            self._emit_progress(
                "analyzing",
                10,
                f"Analyzing issue #{issue_number}",
                issue_number=issue_number,
            )
            state.update_status(AutoFixStatus.ANALYZING)
            await state.save(self.github_dir)

            # Create spec from issue
            spec_result = await self._create_spec_from_issue(issue_number, issue, state)
            if not spec_result.get("success"):
                state.update_status(AutoFixStatus.FAILED)
                state.error = spec_result.get("error", "Failed to create spec")
                await state.save(self.github_dir)
                return state

            state.spec_id = spec_result.get("spec_id")
            state.spec_dir = spec_result.get("spec_dir")
            state.update_status(AutoFixStatus.CREATING_SPEC)
            await state.save(self.github_dir)

            # Phase 2: Run build
            self._emit_progress(
                "building",
                30,
                f"Building spec {state.spec_id}",
                issue_number=issue_number,
            )
            state.update_status(AutoFixStatus.BUILDING)
            await state.save(self.github_dir)

            build_result = await self._run_build(state)
            if not build_result.get("success"):
                state.update_status(AutoFixStatus.FAILED)
                state.error = build_result.get("error", "Build failed")
                await state.save(self.github_dir)
                return state

            # Phase 3: Run QA
            self._emit_progress(
                "qa_review", 60, "Running QA validation", issue_number=issue_number
            )
            state.update_status(AutoFixStatus.QA_REVIEW)
            await state.save(self.github_dir)

            qa_result = await self._run_qa(state)
            if not qa_result.get("passed"):
                # QA failed - keep in QA_REVIEW state for potential retry
                state.error = qa_result.get("error", "QA validation failed")
                await state.save(self.github_dir)
                return state

            # Phase 4: Create PR
            self._emit_progress(
                "creating_pr", 80, "Creating pull request", issue_number=issue_number
            )

            pr_result = await self._create_pr(state, issue_number, issue)
            if not pr_result.get("success"):
                state.update_status(AutoFixStatus.FAILED)
                state.error = pr_result.get("error", "Failed to create PR")
                await state.save(self.github_dir)
                return state

            state.pr_number = pr_result.get("pr_number")
            state.pr_url = pr_result.get("pr_url")
            state.update_status(AutoFixStatus.PR_CREATED)
            await state.save(self.github_dir)

            # Phase 5: Trigger Auto-PR-Review
            self._emit_progress(
                "auto_pr_review",
                90,
                f"Triggering Auto-PR-Review for PR #{state.pr_number}",
                issue_number=issue_number,
                pr_number=state.pr_number,
            )

            # Trigger the Auto-PR-Review loop
            await self._trigger_auto_pr_review(state, issue_number)

            self._emit_progress(
                "complete", 100, "Auto-fix pipeline complete", issue_number=issue_number
            )

            return state

        except Exception as e:
            _log_error(f"Auto-fix failed for issue #{issue_number}", error=str(e))
            try:
                state.update_status(AutoFixStatus.FAILED)
            except ValueError:
                # Already in a terminal state
                pass
            state.error = str(e)
            await state.save(self.github_dir)
            return state

    async def _create_spec_from_issue(
        self,
        issue_number: int,
        issue: dict | None,
        state: Any,
    ) -> dict:
        """Create a spec from the issue."""
        project_dir = self.github_dir.parent.parent if self.github_dir else Path.cwd()
        specs_dir = project_dir / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True, exist_ok=True)

        # Generate spec ID
        existing_specs = list(specs_dir.glob("*"))
        spec_num = len(existing_specs) + 1
        issue_title = (issue.get("title", "") if issue else f"Issue {issue_number}")[
            :40
        ]
        safe_title = "".join(
            c if c.isalnum() or c in "-_" else "-" for c in issue_title.lower()
        )
        spec_id = f"{spec_num:03d}-autofix-{issue_number}-{safe_title}"

        spec_dir = specs_dir / spec_id
        spec_dir.mkdir(parents=True, exist_ok=True)

        # Create spec.md from issue
        issue_body = issue.get("body", "") if issue else ""
        issue_labels = (
            [lbl.get("name", "") for lbl in issue.get("labels", [])] if issue else []
        )
        issue_url = (
            issue.get("html_url", "")
            if issue
            else f"https://github.com/{self.config.repo}/issues/{issue_number}"
        )

        spec_content = f"""# Auto-Fix: Issue #{issue_number}

## Source Issue
- **Issue**: [{issue_title}]({issue_url})
- **Labels**: {", ".join(issue_labels) if issue_labels else "None"}

## Problem Description
{issue_body or "No description provided."}

## Acceptance Criteria
1. The issue described above is resolved
2. All existing tests pass
3. Code follows project conventions
4. Changes are documented if needed

## Implementation Notes
This spec was automatically generated from GitHub issue #{issue_number}.
"""

        (spec_dir / "spec.md").write_text(spec_content)

        # Create task metadata
        metadata = {
            "source": "github_autofix",
            "issue_number": issue_number,
            "issue_url": issue_url,
            "created_at": datetime.now().isoformat(),
            "auto_approve": True,  # Auto-approve for automated flow
        }
        (spec_dir / "task_metadata.json").write_text(json.dumps(metadata, indent=2))

        return {
            "success": True,
            "spec_id": spec_id,
            "spec_dir": str(spec_dir),
        }

    async def _run_build(self, state: Any) -> dict:
        """Run the build for the spec."""
        if not state.spec_dir:
            return {"success": False, "error": "No spec directory"}

        spec_dir = Path(state.spec_dir)
        project_dir = spec_dir.parent.parent.parent  # .auto-claude/specs/XXX -> project

        # Find the backend directory
        backend_dir = self._find_backend_dir()
        if not backend_dir:
            return {"success": False, "error": "Could not find backend directory"}

        run_py = backend_dir / "run.py"
        if not run_py.exists():
            return {"success": False, "error": f"run.py not found at {run_py}"}

        # Get Python interpreter
        python_path = self._get_python_path(backend_dir)

        # Run the build
        cmd = [
            python_path,
            str(run_py),
            "--spec",
            spec_dir.name,
            "--project-dir",
            str(project_dir),
            "--auto-continue",
            "--force",
            "--skip-qa",  # QA will be run separately
        ]

        _log_info("Running build", cmd=" ".join(cmd))

        try:
            result = subprocess.run(
                cmd,
                cwd=str(backend_dir),
                capture_output=True,
                text=True,
                timeout=3600,  # 1 hour timeout
            )

            if result.returncode != 0:
                _log_error(
                    "Build failed", stderr=result.stderr[:500] if result.stderr else ""
                )
                return {
                    "success": False,
                    "error": f"Build failed: {result.stderr[:200] if result.stderr else 'Unknown error'}",
                }

            return {"success": True}

        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Build timed out after 1 hour"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _run_qa(self, state: Any) -> dict:
        """Run QA validation for the spec."""
        if not state.spec_dir:
            return {"passed": False, "error": "No spec directory"}

        spec_dir = Path(state.spec_dir)
        project_dir = spec_dir.parent.parent.parent

        # Find the backend directory
        backend_dir = self._find_backend_dir()
        if not backend_dir:
            return {"passed": False, "error": "Could not find backend directory"}

        run_py = backend_dir / "run.py"
        python_path = self._get_python_path(backend_dir)

        # Run QA
        cmd = [
            python_path,
            str(run_py),
            "--spec",
            spec_dir.name,
            "--project-dir",
            str(project_dir),
            "--qa",
        ]

        _log_info("Running QA", cmd=" ".join(cmd))

        try:
            result = subprocess.run(
                cmd,
                cwd=str(backend_dir),
                capture_output=True,
                text=True,
                timeout=1800,  # 30 minute timeout
            )

            # Check for QA pass indicators
            output = result.stdout + result.stderr
            if "QA VALIDATION PASSED" in output or result.returncode == 0:
                return {"passed": True}

            return {"passed": False, "error": "QA validation failed"}

        except subprocess.TimeoutExpired:
            return {"passed": False, "error": "QA timed out after 30 minutes"}
        except Exception as e:
            return {"passed": False, "error": str(e)}

    async def _create_pr(
        self, state: Any, issue_number: int, issue: dict | None
    ) -> dict:
        """Create a PR from the spec worktree."""
        if not state.spec_dir:
            return {"success": False, "error": "No spec directory"}

        spec_dir = Path(state.spec_dir)
        project_dir = spec_dir.parent.parent.parent
        spec_name = spec_dir.name

        # Use gh CLI to create PR
        issue_title = issue.get("title", "") if issue else f"Issue {issue_number}"
        pr_title = f"fix: Auto-fix for #{issue_number} - {issue_title[:50]}"
        pr_body = f"""## Summary
Automated fix for issue #{issue_number}.

## Source Issue
Closes #{issue_number}

## Changes
This PR was automatically generated by the Auto-Fix system.

---
🤖 Generated by Auto-Claude
"""

        try:
            # Push the branch
            branch_name = f"auto-claude/{spec_name}"

            # Create PR using gh CLI
            cmd = [
                "gh",
                "pr",
                "create",
                "--title",
                pr_title,
                "--body",
                pr_body,
                "--base",
                self.config.main_branch
                if hasattr(self.config, "main_branch")
                else "main",
                "--head",
                branch_name,
            ]

            result = subprocess.run(
                cmd,
                cwd=str(project_dir),
                capture_output=True,
                text=True,
                timeout=60,
            )

            if result.returncode != 0:
                # Check if PR already exists
                if "already exists" in result.stderr.lower():
                    # Get existing PR URL
                    pr_url = self._get_existing_pr_url(project_dir, branch_name)
                    if pr_url:
                        pr_number = int(pr_url.split("/")[-1])
                        return {
                            "success": True,
                            "pr_url": pr_url,
                            "pr_number": pr_number,
                        }

                return {
                    "success": False,
                    "error": f"Failed to create PR: {result.stderr}",
                }

            # Parse PR URL from output
            pr_url = result.stdout.strip()
            pr_number = int(pr_url.split("/")[-1]) if pr_url else None

            return {"success": True, "pr_url": pr_url, "pr_number": pr_number}

        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_existing_pr_url(self, project_dir: Path, branch_name: str) -> str | None:
        """Get URL of existing PR for branch."""
        try:
            result = subprocess.run(
                ["gh", "pr", "view", branch_name, "--json", "url", "-q", ".url"],
                cwd=str(project_dir),
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return None

    async def _trigger_auto_pr_review(self, state: Any, issue_number: int) -> None:
        """Trigger Auto-PR-Review after PR is created."""
        if not state.pr_number or not state.pr_url:
            _log_warning("Cannot trigger Auto-PR-Review: no PR number or URL")
            return

        spec_dir = Path(state.spec_dir) if state.spec_dir else None
        project_dir = spec_dir.parent.parent.parent if spec_dir else Path.cwd()

        # Get branch name from spec directory
        branch_name = f"auto-claude/{spec_dir.name}" if spec_dir else "unknown"

        result = await trigger_auto_pr_review_on_qa_pass(
            pr_number=state.pr_number,
            repo=state.repo,
            pr_url=state.pr_url,
            branch_name=branch_name,
            triggered_by="auto-fix",
            github_dir=self.github_dir,
            project_dir=project_dir,
            spec_dir=spec_dir,
            force=True,  # Force because we know QA just passed
        )

        if result.success:
            _log_info(
                "Auto-PR-Review triggered successfully",
                pr_number=state.pr_number,
                triggered=result.triggered,
            )
        else:
            _log_warning(
                "Auto-PR-Review trigger failed",
                pr_number=state.pr_number,
                error=result.error_message,
            )

    def _find_backend_dir(self) -> Path | None:
        """Find the backend directory."""
        # Try relative to github_dir
        if self.github_dir:
            # .auto-claude/github -> .auto-claude -> project -> apps/backend
            potential = self.github_dir.parent.parent / "apps" / "backend"
            if potential.exists():
                return potential

        # Try from current file
        current = Path(__file__).parent.parent.parent.parent
        if (current / "run.py").exists():
            return current

        return None

    def _get_python_path(self, backend_dir: Path) -> str:
        """Get the Python interpreter path."""
        venv = backend_dir / ".venv"
        if venv.exists():
            if sys.platform == "win32":
                return str(venv / "Scripts" / "python.exe")
            return str(venv / "bin" / "python")
        return sys.executable

    async def get_queue(self) -> list:
        """Get all issues in the auto-fix queue."""
        try:
            from ..models import AutoFixState
        except ImportError:
            from models import AutoFixState

        queue = []
        issues_dir = self.github_dir / "issues"

        if not issues_dir.exists():
            return []

        for file in issues_dir.glob("autofix_*.json"):
            try:
                data = json.loads(file.read_text())
                state = AutoFixState.from_dict(data)
                queue.append(state)
            except Exception:
                continue

        return sorted(queue, key=lambda s: s.created_at, reverse=True)

    async def check_labeled_issues(
        self,
        all_issues: list[dict] | None = None,
        labels: list[str] | None = None,
        verify_permissions: bool = True,
    ) -> list[dict]:
        """Check for issues with auto-fix labels."""
        if not all_issues:
            return []

        auto_fix_labels = labels or (
            self.config.auto_fix_labels if self.config else ["auto-fix"]
        )
        matching_issues = []

        for issue in all_issues:
            issue_labels = [
                lbl.get("name", "").lower() for lbl in issue.get("labels", [])
            ]
            has_trigger_label = any(
                label.lower() in issue_labels for label in auto_fix_labels
            )
            if has_trigger_label:
                matching_issues.append(
                    {
                        "issue_number": issue["number"],
                        "trigger_label": next(
                            (
                                lbl
                                for lbl in auto_fix_labels
                                if lbl.lower() in issue_labels
                            ),
                            None,
                        ),
                        "authorized": True,  # Default to authorized for now
                    }
                )

        return matching_issues


# =============================================================================
# Configuration
# =============================================================================

# Environment variable to enable/disable auto PR review
AUTO_PR_REVIEW_ENABLED_ENV = "GITHUB_AUTO_PR_REVIEW_ENABLED"

# Default settings
DEFAULT_GITHUB_DIR = Path(".auto-claude/github")
DEFAULT_SPEC_DIR = Path(".auto-claude/specs")


# =============================================================================
# Result Types
# =============================================================================


@dataclass
class AutofixProcessorResult:
    """Result of the autofix processor."""

    success: bool
    triggered: bool
    pr_number: int
    repo: str
    orchestrator_result: OrchestratorRunResult | None = None
    error_message: str | None = None
    skipped_reason: str | None = None

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        result = {
            "success": self.success,
            "triggered": self.triggered,
            "pr_number": self.pr_number,
            "repo": self.repo,
            "error_message": self.error_message,
            "skipped_reason": self.skipped_reason,
        }
        if self.orchestrator_result:
            result["orchestrator_result"] = self.orchestrator_result.to_dict()
        return result


# =============================================================================
# Configuration Helpers
# =============================================================================


def is_auto_pr_review_enabled() -> bool:
    """
    Check if auto PR review is enabled via environment variable.

    Returns:
        True if GITHUB_AUTO_PR_REVIEW_ENABLED is set to "true", "1", or "yes"
    """
    value = os.environ.get(AUTO_PR_REVIEW_ENABLED_ENV, "").lower().strip()
    return value in ("true", "1", "yes", "on")


def get_auto_pr_review_config() -> dict[str, Any]:
    """
    Get the current auto PR review configuration.

    Returns:
        Dictionary with configuration settings
    """
    return {
        "enabled": is_auto_pr_review_enabled(),
        "allowed_users_env": os.environ.get("GITHUB_AUTO_PR_REVIEW_ALLOWED_USERS", ""),
        "expected_bots_env": os.environ.get("GITHUB_EXPECTED_BOTS", ""),
        "max_iterations": int(
            os.environ.get("GITHUB_AUTO_PR_REVIEW_MAX_ITERATIONS", "5")
        ),
    }


# =============================================================================
# Logging Helpers
# =============================================================================


def _log_info(message: str, **kwargs: Any) -> None:
    """Log an info message with context."""
    if STRUCTLOG_AVAILABLE:
        logger.info(message, **kwargs)
    else:
        logger.info(f"{message} {kwargs}")


def _log_warning(message: str, **kwargs: Any) -> None:
    """Log a warning message with context."""
    if STRUCTLOG_AVAILABLE:
        logger.warning(message, **kwargs)
    else:
        logger.warning(f"{message} {kwargs}")


def _log_error(message: str, **kwargs: Any) -> None:
    """Log an error message with context."""
    if STRUCTLOG_AVAILABLE:
        logger.error(message, **kwargs)
    else:
        logger.error(f"{message} {kwargs}")


# =============================================================================
# Main Entry Point
# =============================================================================


async def trigger_auto_pr_review_on_qa_pass(
    pr_number: int,
    repo: str,
    pr_url: str,
    branch_name: str,
    triggered_by: str,
    github_dir: Path | None = None,
    project_dir: Path | None = None,
    spec_dir: Path | None = None,
    on_progress: Callable[[str, Any], None] | None = None,
    force: bool = False,
) -> AutofixProcessorResult:
    """
    Trigger auto PR review after QA passes.

    This is the main entry point for connecting QA pass events to the
    AutoPRReviewOrchestrator. Call this function when QA passes on a PR
    to initiate the automatic review and fix workflow.

    Args:
        pr_number: PR number to review
        repo: Repository in owner/repo format
        pr_url: Full URL to the PR
        branch_name: PR branch name
        triggered_by: Username who triggered the review (usually "qa-agent")
        github_dir: Directory for GitHub state files (default: .auto-claude/github)
        project_dir: Project root directory (default: current directory)
        spec_dir: Spec directory for this task (default: .auto-claude/specs)
        on_progress: Optional callback for progress updates
        force: If True, skip the enabled check

    Returns:
        AutofixProcessorResult with status and optional orchestrator result

    Notes:
        - This function NEVER auto-merges. Human approval is always required.
        - The orchestrator result will indicate READY_TO_MERGE when all checks pass,
          but a human must explicitly approve and merge the PR.
    """
    _log_info(
        "QA passed - checking if auto PR review should trigger",
        pr_number=pr_number,
        repo=repo,
        triggered_by=triggered_by,
    )

    # Check if auto PR review is enabled
    if not force and not is_auto_pr_review_enabled():
        _log_info(
            "Auto PR review is disabled, skipping",
            pr_number=pr_number,
            repo=repo,
        )
        return AutofixProcessorResult(
            success=True,
            triggered=False,
            pr_number=pr_number,
            repo=repo,
            skipped_reason="Auto PR review is disabled (set GITHUB_AUTO_PR_REVIEW_ENABLED=true to enable)",
        )

    # Resolve directories
    resolved_github_dir = github_dir or Path.cwd() / DEFAULT_GITHUB_DIR
    resolved_project_dir = project_dir or Path.cwd()
    resolved_spec_dir = spec_dir or Path.cwd() / DEFAULT_SPEC_DIR

    try:
        # Get or create orchestrator instance
        orchestrator = get_auto_pr_review_orchestrator(
            github_dir=resolved_github_dir,
            project_dir=resolved_project_dir,
            spec_dir=resolved_spec_dir,
        )

        # Run the review workflow
        _log_info(
            "Triggering auto PR review",
            pr_number=pr_number,
            repo=repo,
            triggered_by=triggered_by,
        )

        result = await orchestrator.run(
            pr_number=pr_number,
            repo=repo,
            pr_url=pr_url,
            branch_name=branch_name,
            triggered_by=triggered_by,
            on_progress=on_progress,
        )

        # Determine success based on result
        success = result.result in (
            OrchestratorResult.READY_TO_MERGE,
            OrchestratorResult.NO_FINDINGS,
            OrchestratorResult.PR_MERGED,  # Merged externally is OK
        )

        if result.result == OrchestratorResult.READY_TO_MERGE:
            _log_info(
                "Auto PR review completed - ready for human review",
                pr_number=pr_number,
                repo=repo,
                iterations=result.iterations_completed,
                findings_fixed=result.findings_fixed,
            )
        elif result.result == OrchestratorResult.UNAUTHORIZED:
            _log_warning(
                "Auto PR review unauthorized",
                pr_number=pr_number,
                repo=repo,
                triggered_by=triggered_by,
            )
        else:
            _log_info(
                "Auto PR review completed",
                pr_number=pr_number,
                repo=repo,
                result=result.result.value,
            )

        return AutofixProcessorResult(
            success=success,
            triggered=True,
            pr_number=pr_number,
            repo=repo,
            orchestrator_result=result,
            error_message=result.error_message if not success else None,
        )

    except Exception as e:
        _log_error(
            f"Auto PR review failed: {e}",
            pr_number=pr_number,
            repo=repo,
        )
        return AutofixProcessorResult(
            success=False,
            triggered=True,
            pr_number=pr_number,
            repo=repo,
            error_message=str(e),
        )


def trigger_auto_pr_review_on_qa_pass_sync(
    pr_number: int,
    repo: str,
    pr_url: str,
    branch_name: str,
    triggered_by: str,
    **kwargs,
) -> AutofixProcessorResult:
    """
    Synchronous wrapper for trigger_auto_pr_review_on_qa_pass.

    Use this when calling from synchronous code that cannot use async/await.

    Args:
        Same as trigger_auto_pr_review_on_qa_pass

    Returns:
        AutofixProcessorResult with status and optional orchestrator result
    """
    return asyncio.run(
        trigger_auto_pr_review_on_qa_pass(
            pr_number=pr_number,
            repo=repo,
            pr_url=pr_url,
            branch_name=branch_name,
            triggered_by=triggered_by,
            **kwargs,
        )
    )


# =============================================================================
# Cancellation Support
# =============================================================================


def cancel_auto_pr_review(pr_number: int) -> bool:
    """
    Cancel an in-progress auto PR review.

    Args:
        pr_number: PR number to cancel

    Returns:
        True if cancellation was requested, False if no active review found
    """
    try:
        orchestrator = get_auto_pr_review_orchestrator()
        return orchestrator.cancel(pr_number)
    except ValueError:
        # Orchestrator not initialized
        return False


# =============================================================================
# Status Queries
# =============================================================================


def get_auto_pr_review_status(pr_number: int) -> dict | None:
    """
    Get the status of an auto PR review.

    Args:
        pr_number: PR number to check

    Returns:
        Status dictionary or None if no active review
    """
    try:
        orchestrator = get_auto_pr_review_orchestrator()
        active_reviews = orchestrator.get_active_reviews()
        if pr_number in active_reviews:
            state = active_reviews[pr_number]
            return {
                "pr_number": state.pr_number,
                "repo": state.repo,
                "status": state.status.value,
                "current_iteration": state.current_iteration,
                "max_iterations": state.max_iterations,
                "ci_all_passed": state.ci_all_passed,
                "started_at": state.started_at,
            }
        return None
    except ValueError:
        # Orchestrator not initialized
        return None


def get_all_active_reviews() -> list[dict]:
    """
    Get all active auto PR reviews.

    Returns:
        List of status dictionaries for all active reviews
    """
    try:
        orchestrator = get_auto_pr_review_orchestrator()
        active_reviews = orchestrator.get_active_reviews()
        return [
            {
                "pr_number": state.pr_number,
                "repo": state.repo,
                "status": state.status.value,
                "current_iteration": state.current_iteration,
                "max_iterations": state.max_iterations,
            }
            for state in active_reviews.values()
        ]
    except ValueError:
        return []


# =============================================================================
# Module Exports
# =============================================================================

__all__ = [
    # Main entry points
    "trigger_auto_pr_review_on_qa_pass",
    "trigger_auto_pr_review_on_qa_pass_sync",
    # Configuration
    "is_auto_pr_review_enabled",
    "get_auto_pr_review_config",
    # Cancellation
    "cancel_auto_pr_review",
    # Status queries
    "get_auto_pr_review_status",
    "get_all_active_reviews",
    # Result type
    "AutofixProcessorResult",
]
