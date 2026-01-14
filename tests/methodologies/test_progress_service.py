"""Tests for ProgressService implementations.

Story Reference: Story 2.4 - Implement Progress Reporting for Native Runner
"""

import io
import json
from datetime import datetime
from unittest.mock import MagicMock

import pytest

from apps.backend.methodologies.progress_service import (
    CallbackProgressService,
    CompositeProgressService,
    IPCProgressService,
    LoggingProgressService,
)
from apps.backend.methodologies.protocols import ProgressEvent


@pytest.fixture
def sample_event() -> ProgressEvent:
    """Create a sample ProgressEvent for testing."""
    return ProgressEvent(
        task_id="task-123",
        phase_id="spec",
        status="in_progress",
        message="Generating specification...",
        percentage=45.0,
        artifacts=["/path/to/artifact.md"],
        timestamp=datetime(2026, 1, 15, 10, 30, 0),
    )


# =============================================================================
# IPCProgressService Tests
# =============================================================================


class TestIPCProgressService:
    """Test IPCProgressService implementation (Story 2.4 Task 4)."""

    def test_emit_writes_json_to_output(self, sample_event):
        """Test emit writes JSON-formatted event to output stream."""
        output = io.StringIO()
        service = IPCProgressService(output=output)

        service.emit(sample_event)

        output.seek(0)
        line = output.readline()
        parsed = json.loads(line)

        assert parsed["event"] == "task:executionProgress"
        assert parsed["payload"]["taskId"] == "task-123"
        assert parsed["payload"]["phaseId"] == "spec"

    def test_emit_uses_correct_ipc_event_name(self, sample_event):
        """Test emit uses the correct IPC event name."""
        output = io.StringIO()
        service = IPCProgressService(output=output)

        service.emit(sample_event)

        output.seek(0)
        parsed = json.loads(output.readline())
        assert parsed["event"] == "task:executionProgress"

    def test_emit_includes_all_payload_fields(self, sample_event):
        """Test emit includes all required payload fields."""
        output = io.StringIO()
        service = IPCProgressService(output=output)

        service.emit(sample_event)

        output.seek(0)
        parsed = json.loads(output.readline())
        payload = parsed["payload"]

        assert "taskId" in payload
        assert "phaseId" in payload
        assert "status" in payload
        assert "message" in payload
        assert "percentage" in payload
        assert "artifacts" in payload
        assert "timestamp" in payload

    def test_emit_handles_write_errors_gracefully(self, sample_event, caplog):
        """Test emit handles output errors without raising."""
        # Create a mock that raises on write
        mock_output = MagicMock()
        mock_output.write.side_effect = IOError("Write failed")

        service = IPCProgressService(output=mock_output)

        # Should not raise
        service.emit(sample_event)

        # Should log the error
        assert "Failed to emit IPC progress event" in caplog.text

    def test_update_does_not_emit_ipc(self, sample_event):
        """Test update() doesn't emit IPC events (backward compat)."""
        output = io.StringIO()
        service = IPCProgressService(output=output)

        service.update("spec", 0.5, "Test message")

        output.seek(0)
        assert output.read() == ""

    def test_emit_writes_newline_terminated_json(self, sample_event):
        """Test each emit writes newline-terminated JSON for line-based parsing."""
        output = io.StringIO()
        service = IPCProgressService(output=output)

        service.emit(sample_event)
        service.emit(sample_event)

        output.seek(0)
        lines = output.readlines()
        assert len(lines) == 2
        assert lines[0].endswith("\n")
        assert lines[1].endswith("\n")


# =============================================================================
# CallbackProgressService Tests
# =============================================================================


class TestCallbackProgressService:
    """Test CallbackProgressService implementation (Story 2.4 Task 5)."""

    def test_emit_invokes_callback(self, sample_event):
        """Test emit invokes the callback with the event."""
        captured_events = []

        def callback(event: ProgressEvent):
            captured_events.append(event)

        service = CallbackProgressService(callback=callback)
        service.emit(sample_event)

        assert len(captured_events) == 1
        assert captured_events[0] is sample_event

    def test_emit_without_callback_is_noop(self, sample_event):
        """Test emit without callback doesn't raise."""
        service = CallbackProgressService()
        # Should not raise
        service.emit(sample_event)

    def test_update_invokes_update_callback(self):
        """Test update invokes the update callback."""
        captured_updates = []

        def callback(phase_id: str, progress: float, message: str):
            captured_updates.append((phase_id, progress, message))

        service = CallbackProgressService(update_callback=callback)
        service.update("spec", 0.5, "Test message")

        assert len(captured_updates) == 1
        assert captured_updates[0] == ("spec", 0.5, "Test message")


# =============================================================================
# LoggingProgressService Tests
# =============================================================================


class TestLoggingProgressService:
    """Test LoggingProgressService implementation."""

    def test_emit_logs_event(self, sample_event, caplog):
        """Test emit logs the event."""
        import logging

        service = LoggingProgressService(level=logging.INFO)

        with caplog.at_level(logging.INFO):
            service.emit(sample_event)

        assert "spec" in caplog.text
        assert "in_progress" in caplog.text
        assert "45.0%" in caplog.text

    def test_update_logs_progress(self, caplog):
        """Test update logs progress."""
        import logging

        service = LoggingProgressService(level=logging.INFO)

        with caplog.at_level(logging.INFO):
            service.update("spec", 0.5, "Test message")

        assert "spec" in caplog.text
        assert "50%" in caplog.text
        assert "Test message" in caplog.text


# =============================================================================
# CompositeProgressService Tests
# =============================================================================


class TestCompositeProgressService:
    """Test CompositeProgressService implementation."""

    def test_emit_delegates_to_all_services(self, sample_event):
        """Test emit delegates to all services."""
        mock1 = MagicMock()
        mock2 = MagicMock()

        service = CompositeProgressService([mock1, mock2])
        service.emit(sample_event)

        mock1.emit.assert_called_once_with(sample_event)
        mock2.emit.assert_called_once_with(sample_event)

    def test_update_delegates_to_all_services(self):
        """Test update delegates to all services."""
        mock1 = MagicMock()
        mock2 = MagicMock()

        service = CompositeProgressService([mock1, mock2])
        service.update("spec", 0.5, "Test message")

        mock1.update.assert_called_once_with("spec", 0.5, "Test message")
        mock2.update.assert_called_once_with("spec", 0.5, "Test message")

    def test_emit_continues_on_service_error(self, sample_event, caplog):
        """Test emit continues to other services if one fails."""
        mock1 = MagicMock()
        mock1.emit.side_effect = Exception("Service 1 failed")
        mock2 = MagicMock()

        service = CompositeProgressService([mock1, mock2])
        service.emit(sample_event)

        # Second service should still be called
        mock2.emit.assert_called_once_with(sample_event)

    def test_empty_services_list_is_valid(self, sample_event):
        """Test composite with no services doesn't raise."""
        service = CompositeProgressService([])
        # Should not raise
        service.emit(sample_event)
        service.update("spec", 0.5, "Test")


# =============================================================================
# Protocol Compliance Tests
# =============================================================================


class TestProgressServiceProtocolCompliance:
    """Test all implementations satisfy ProgressService Protocol."""

    def test_ipc_service_is_progress_service(self):
        """Test IPCProgressService satisfies ProgressService Protocol."""
        from apps.backend.methodologies.protocols import ProgressService

        service = IPCProgressService()
        assert isinstance(service, ProgressService)

    def test_callback_service_is_progress_service(self):
        """Test CallbackProgressService satisfies ProgressService Protocol."""
        from apps.backend.methodologies.protocols import ProgressService

        service = CallbackProgressService()
        assert isinstance(service, ProgressService)

    def test_logging_service_is_progress_service(self):
        """Test LoggingProgressService satisfies ProgressService Protocol."""
        from apps.backend.methodologies.protocols import ProgressService

        service = LoggingProgressService()
        assert isinstance(service, ProgressService)

    def test_composite_service_is_progress_service(self):
        """Test CompositeProgressService satisfies ProgressService Protocol."""
        from apps.backend.methodologies.protocols import ProgressService

        service = CompositeProgressService([])
        assert isinstance(service, ProgressService)
