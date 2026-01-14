"""Concrete implementations of the ProgressService Protocol.

Story Reference: Story 2.4 - Implement Progress Reporting for Native Runner

This module provides concrete implementations of the ProgressService Protocol
that can emit progress events via various mechanisms (IPC, callbacks, logging).
"""

import json
import logging
import sys
from collections.abc import Callable
from typing import TextIO

from .protocols import ProgressEvent, ProgressService

logger = logging.getLogger(__name__)


class IPCProgressService:
    """Progress service that emits events via stdout for IPC consumption.

    This implementation writes JSON-formatted progress events to stdout
    which can be captured by the Electron main process for IPC forwarding
    to the renderer.

    The event format follows the IPC convention:
    {"event": "task:executionProgress", "payload": {...}}

    Story Reference: Story 2.4 Task 4 - Implement IPC event emission

    Example:
        service = IPCProgressService()
        event = ProgressEvent(
            task_id="task-123",
            phase_id="spec",
            status="in_progress",
            message="Generating spec...",
            percentage=45.0,
            artifacts=[],
            timestamp=datetime.now(),
        )
        service.emit(event)  # Writes JSON to stdout
    """

    IPC_EVENT_NAME = "task:executionProgress"

    def __init__(self, output: TextIO | None = None) -> None:
        """Initialize the IPC progress service.

        Args:
            output: Output stream for IPC events. Defaults to sys.stdout.
        """
        self._output = output or sys.stdout

    def update(self, phase_id: str, progress: float, message: str) -> None:
        """Update progress for a phase (simple interface).

        This method exists for backward compatibility with code that
        uses the simple update interface.

        Args:
            phase_id: ID of the phase being executed
            progress: Progress percentage (0.0 to 1.0)
            message: Human-readable progress message
        """
        # Simple updates are logged but not sent via IPC
        # Full ProgressEvents should be used for IPC communication
        logger.debug(f"Progress update [{phase_id}]: {progress:.0%} - {message}")

    def emit(self, event: ProgressEvent) -> None:
        """Emit a detailed progress event via IPC.

        Writes a JSON-formatted event to the output stream in the format
        expected by the Electron IPC bridge.

        Args:
            event: ProgressEvent with full progress details
        """
        ipc_message = {
            "event": self.IPC_EVENT_NAME,
            "payload": event.to_ipc_dict(),
        }

        try:
            json_str = json.dumps(ipc_message)
            self._output.write(f"{json_str}\n")
            self._output.flush()
        except Exception as e:
            logger.error(f"Failed to emit IPC progress event: {e}")


class CallbackProgressService:
    """Progress service that invokes callbacks for progress events.

    This implementation is useful for testing and for scenarios where
    progress should be handled by a custom callback function.

    Story Reference: Story 2.4 Task 5 - Add progress callbacks to existing agents

    Example:
        def handle_progress(event: ProgressEvent):
            print(f"Progress: {event.percentage}% - {event.message}")

        service = CallbackProgressService(callback=handle_progress)
        service.emit(event)  # Invokes handle_progress
    """

    def __init__(
        self,
        callback: Callable[[ProgressEvent], None] | None = None,
        update_callback: Callable[[str, float, str], None] | None = None,
    ) -> None:
        """Initialize the callback progress service.

        Args:
            callback: Function to call for emit() events
            update_callback: Function to call for update() events
        """
        self._callback = callback
        self._update_callback = update_callback

    def update(self, phase_id: str, progress: float, message: str) -> None:
        """Update progress for a phase.

        Args:
            phase_id: ID of the phase being executed
            progress: Progress percentage (0.0 to 1.0)
            message: Human-readable progress message
        """
        if self._update_callback:
            self._update_callback(phase_id, progress, message)

    def emit(self, event: ProgressEvent) -> None:
        """Emit a detailed progress event via callback.

        Args:
            event: ProgressEvent with full progress details
        """
        if self._callback:
            self._callback(event)


class LoggingProgressService:
    """Progress service that logs events for debugging.

    This implementation is useful during development and debugging
    when you want to see progress events in the log output.

    Example:
        service = LoggingProgressService(level=logging.INFO)
        service.emit(event)  # Logs to configured logger
    """

    def __init__(self, level: int = logging.DEBUG) -> None:
        """Initialize the logging progress service.

        Args:
            level: Logging level to use for progress events
        """
        self._level = level

    def update(self, phase_id: str, progress: float, message: str) -> None:
        """Update progress for a phase.

        Args:
            phase_id: ID of the phase being executed
            progress: Progress percentage (0.0 to 1.0)
            message: Human-readable progress message
        """
        logger.log(self._level, f"[{phase_id}] {progress:.0%}: {message}")

    def emit(self, event: ProgressEvent) -> None:
        """Emit a detailed progress event to the logger.

        Args:
            event: ProgressEvent with full progress details
        """
        logger.log(
            self._level,
            f"[{event.phase_id}] {event.status}: {event.percentage:.1f}% - {event.message}",
        )


class CompositeProgressService:
    """Progress service that delegates to multiple services.

    This allows combining multiple progress services, for example
    sending events via IPC while also logging them.

    Example:
        service = CompositeProgressService([
            IPCProgressService(),
            LoggingProgressService(),
        ])
        service.emit(event)  # Both IPC and logging
    """

    def __init__(self, services: list[ProgressService]) -> None:
        """Initialize the composite progress service.

        Args:
            services: List of progress services to delegate to
        """
        self._services = services

    def update(self, phase_id: str, progress: float, message: str) -> None:
        """Update progress for a phase on all services.

        Args:
            phase_id: ID of the phase being executed
            progress: Progress percentage (0.0 to 1.0)
            message: Human-readable progress message
        """
        for service in self._services:
            try:
                service.update(phase_id, progress, message)
            except Exception as e:
                logger.error(f"Progress service update failed: {e}")

    def emit(self, event: ProgressEvent) -> None:
        """Emit a progress event to all services.

        Args:
            event: ProgressEvent with full progress details
        """
        for service in self._services:
            try:
                service.emit(event)
            except Exception as e:
                logger.error(f"Progress service emit failed: {e}")
