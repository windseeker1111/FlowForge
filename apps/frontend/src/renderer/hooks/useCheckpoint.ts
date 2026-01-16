/**
 * useCheckpoint hook for Semi-Auto execution mode.
 *
 * Story Reference: Story 5.4 - Implement Checkpoint Approval Flow
 * Architecture Source: architecture.md#Checkpoint-Service
 *
 * Provides checkpoint operations and state for the CheckpointDialog component.
 */

import { useCallback, useEffect } from 'react';
import { useCheckpointStore } from '../stores/checkpoint-store';
import type { CheckpointInfo, FeedbackAttachment, RevisionEntry } from '../components/checkpoints/types';
import { debugLog } from '../../shared/utils/debug-logger';

/**
 * Transform snake_case revision entry from backend to camelCase for frontend.
 * The backend uses Python naming conventions, frontend uses TypeScript conventions.
 */
function transformRevisionEntry(backendEntry: Record<string, unknown>): RevisionEntry {
  return {
    id: String(backendEntry.id || ''),
    checkpointId: String(backendEntry.checkpoint_id || ''),
    phaseId: String(backendEntry.phase_id || ''),
    revisionNumber: Number(backendEntry.revision_number || 0),
    feedback: String(backendEntry.feedback || ''),
    attachments: (backendEntry.attachments as FeedbackAttachment[]) || [],
    beforeArtifacts: (backendEntry.before_artifacts as string[]) || [],
    afterArtifacts: (backendEntry.after_artifacts as string[]) || [],
    status: (backendEntry.status as RevisionEntry['status']) || 'pending',
    requestedAt: String(backendEntry.requested_at || ''),
    completedAt: backendEntry.completed_at ? String(backendEntry.completed_at) : undefined,
    error: backendEntry.error ? String(backendEntry.error) : undefined,
  };
}

/**
 * Hook for managing checkpoint operations in Semi-Auto mode.
 *
 * @param taskId - The current task ID (if any)
 * @returns Checkpoint state and operations
 */
export function useCheckpoint(taskId?: string) {
  const {
    currentCheckpoint,
    isProcessing,
    feedbackHistory,
    revisionHistory,
    error,
    setCheckpoint,
    setProcessing,
    setFeedbackHistory,
    addFeedback,
    setRevisionHistory,
    setError,
    clearCheckpoint,
  } = useCheckpointStore();

  // Set up checkpoint event listeners
  useEffect(() => {
    // Listen for checkpoint reached events
    const cleanupReached = window.electronAPI.checkpoints.onCheckpointReached(
      (eventTaskId: string, checkpoint: CheckpointInfo & { revision_history?: Record<string, unknown>[] }) => {
        // Only handle events for the current task (if specified)
        if (taskId && eventTaskId !== taskId) return;

        debugLog('[useCheckpoint] Checkpoint reached:', checkpoint.checkpointId);
        setCheckpoint(checkpoint);

        // Load revision history from the checkpoint event (Story 5.5)
        // The backend sends revision_history (snake_case) in the checkpoint event
        // Transform to camelCase for frontend usage
        if (checkpoint.revision_history && Array.isArray(checkpoint.revision_history)) {
          const transformedHistory = checkpoint.revision_history.map(transformRevisionEntry);
          debugLog('[useCheckpoint] Setting revision history:', transformedHistory.length, 'entries');
          setRevisionHistory(transformedHistory);
        }

        // Load feedback history from the checkpoint event (Story 5.3)
        // The backend sends feedback_history in the checkpoint event
        // We need to map it to our frontend format
      }
    );

    // Listen for checkpoint resumed events
    const cleanupResumed = window.electronAPI.checkpoints.onCheckpointResumed(
      (eventTaskId: string, checkpointId: string, decision: string) => {
        // Only handle events for the current task (if specified)
        if (taskId && eventTaskId !== taskId) return;

        debugLog('[useCheckpoint] Checkpoint resumed:', checkpointId, decision);

        // If the current checkpoint was resumed, clear it
        if (currentCheckpoint?.checkpointId === checkpointId) {
          setProcessing(false);
          clearCheckpoint();
        }
      }
    );

    return () => {
      cleanupReached();
      cleanupResumed();
    };
  }, [taskId, currentCheckpoint, setCheckpoint, setProcessing, setRevisionHistory, clearCheckpoint]);

  /**
   * Approve the current checkpoint and continue execution.
   * Story 5.4 AC2: Approve without feedback - AI proceeds with current plan.
   * Story 5.4 AC3: Approve with feedback - feedback is incorporated into next phase.
   *
   * @param feedback - Optional guidance for the next phase
   * @param attachments - Optional attachments
   */
  const approve = useCallback(
    async (feedback?: string, attachments?: FeedbackAttachment[]) => {
      if (!currentCheckpoint || !taskId) {
        setError('No checkpoint or task to approve');
        return;
      }

      setProcessing(true);
      setError(null);

      try {
        const result = await window.electronAPI.checkpoints.approve(
          taskId,
          currentCheckpoint.checkpointId,
          feedback,
          attachments
        );

        if (!result.success) {
          setError(result.error || 'Failed to approve checkpoint');
          setProcessing(false);
        }
        // On success, the checkpoint-resumed event will clear the state
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setProcessing(false);
      }
    },
    [currentCheckpoint, taskId, setProcessing, setError]
  );

  /**
   * Request revision at the current checkpoint.
   * Story 5.4 AC4: Revision feedback is stored and AI re-executes phase.
   *
   * @param feedback - Required feedback explaining what changes are needed
   * @param attachments - Optional attachments
   */
  const revise = useCallback(
    async (feedback: string, attachments?: FeedbackAttachment[]) => {
      if (!currentCheckpoint || !taskId) {
        setError('No checkpoint or task to revise');
        return;
      }

      if (!feedback.trim()) {
        setError('Feedback is required for revision');
        return;
      }

      setProcessing(true);
      setError(null);

      try {
        const result = await window.electronAPI.checkpoints.revise(
          taskId,
          currentCheckpoint.checkpointId,
          feedback,
          attachments
        );

        if (!result.success) {
          setError(result.error || 'Failed to request revision');
          setProcessing(false);
        }
        // On success, the checkpoint-resumed event will clear the state
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setProcessing(false);
      }
    },
    [currentCheckpoint, taskId, setProcessing, setError]
  );

  /**
   * Cancel the task at the current checkpoint.
   */
  const cancel = useCallback(async () => {
    if (!currentCheckpoint || !taskId) {
      setError('No checkpoint or task to cancel');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const result = await window.electronAPI.checkpoints.cancel(
        taskId,
        currentCheckpoint.checkpointId
      );

      if (!result.success) {
        setError(result.error || 'Failed to cancel task');
        setProcessing(false);
      }
      // On success, the checkpoint-resumed event will clear the state
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setProcessing(false);
    }
  }, [currentCheckpoint, taskId, setProcessing, setError]);

  /**
   * Close the checkpoint dialog without taking action.
   * Note: This only hides the dialog, it doesn't affect the checkpoint state.
   */
  const closeDialog = useCallback(() => {
    clearCheckpoint();
  }, [clearCheckpoint]);

  return {
    // State
    checkpoint: currentCheckpoint,
    isOpen: currentCheckpoint !== null,
    isProcessing,
    feedbackHistory,
    revisionHistory,
    error,

    // Actions
    approve,
    revise,
    cancel,
    closeDialog,

    // Store actions (for advanced use cases)
    setCheckpoint,
    setFeedbackHistory,
    addFeedback,
    setRevisionHistory,
    setError,
  };
}
