/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for useCheckpoint hook
 *
 * Story Reference: Story 5.4 - Implement Checkpoint Approval Flow
 * Tests hook for managing checkpoint operations in Semi-Auto mode
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCheckpoint } from '../useCheckpoint';
import { useCheckpointStore } from '../../stores/checkpoint-store';
import type { CheckpointInfo, FeedbackAttachment } from '../../components/checkpoints/types';

// Mock electronAPI
const mockApprove = vi.fn();
const mockRevise = vi.fn();
const mockCancel = vi.fn();
const mockOnCheckpointReached = vi.fn();
const mockOnCheckpointResumed = vi.fn();

// Store the callbacks so we can trigger events
let checkpointReachedCallback: ((taskId: string, checkpoint: CheckpointInfo) => void) | null = null;
let checkpointResumedCallback: ((taskId: string, checkpointId: string, decision: string) => void) | null = null;

beforeEach(() => {
  // Reset callbacks
  checkpointReachedCallback = null;
  checkpointResumedCallback = null;

  // Setup mock implementation that captures callbacks
  mockOnCheckpointReached.mockImplementation((callback) => {
    checkpointReachedCallback = callback;
    return vi.fn(); // Return cleanup function
  });

  mockOnCheckpointResumed.mockImplementation((callback) => {
    checkpointResumedCallback = callback;
    return vi.fn(); // Return cleanup function
  });

  // Default success responses
  mockApprove.mockResolvedValue({ success: true, data: { success: true, message: 'Approved', resumed: true } });
  mockRevise.mockResolvedValue({ success: true, data: { success: true, message: 'Revised', resumed: true } });
  mockCancel.mockResolvedValue({ success: true, data: { success: true, message: 'Cancelled', stopped: true } });

  // Mock window.electronAPI
  Object.defineProperty(window, 'electronAPI', {
    value: {
      checkpoints: {
        approve: mockApprove,
        revise: mockRevise,
        cancel: mockCancel,
        onCheckpointReached: mockOnCheckpointReached,
        onCheckpointResumed: mockOnCheckpointResumed,
      },
    },
    writable: true,
  });

  // Reset store
  useCheckpointStore.setState({
    currentCheckpoint: null,
    isProcessing: false,
    feedbackHistory: [],
    revisionHistory: [],
    error: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// Helper to create test checkpoint
function createTestCheckpoint(overrides: Partial<CheckpointInfo> = {}): CheckpointInfo {
  return {
    checkpointId: 'after_planning',
    name: 'Planning Review',
    description: 'Review implementation plan before coding begins',
    phase: 'planning',
    taskId: 'task-123',
    pausedAt: new Date().toISOString(),
    artifacts: [],
    decisions: [],
    warnings: [],
    requiresApproval: true,
    summary: 'Test checkpoint',
    ...overrides,
  };
}

describe('useCheckpoint', () => {
  describe('initial state', () => {
    it('should return null checkpoint initially', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      expect(result.current.checkpoint).toBeNull();
      expect(result.current.isOpen).toBe(false);
    });

    it('should not be processing initially', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      expect(result.current.isProcessing).toBe(false);
    });

    it('should have empty feedback history initially', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      expect(result.current.feedbackHistory).toHaveLength(0);
    });

    it('should have no error initially', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      expect(result.current.error).toBeNull();
    });
  });

  describe('event listeners', () => {
    it('should register checkpoint-reached listener on mount', () => {
      renderHook(() => useCheckpoint('task-123'));

      expect(mockOnCheckpointReached).toHaveBeenCalledTimes(1);
      expect(mockOnCheckpointReached).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should register checkpoint-resumed listener on mount', () => {
      renderHook(() => useCheckpoint('task-123'));

      expect(mockOnCheckpointResumed).toHaveBeenCalledTimes(1);
      expect(mockOnCheckpointResumed).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should set checkpoint when checkpoint-reached event fires', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      // Simulate checkpoint-reached event
      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      expect(result.current.checkpoint).toEqual(checkpoint);
      expect(result.current.isOpen).toBe(true);
    });

    it('should ignore checkpoint-reached for different task', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint({ taskId: 'different-task' });

      // Simulate checkpoint-reached event for different task
      act(() => {
        checkpointReachedCallback?.('different-task', checkpoint);
      });

      expect(result.current.checkpoint).toBeNull();
      expect(result.current.isOpen).toBe(false);
    });

    it('should clear checkpoint when checkpoint-resumed event fires', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      // First set a checkpoint
      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      expect(result.current.checkpoint).not.toBeNull();

      // Simulate checkpoint-resumed event
      act(() => {
        checkpointResumedCallback?.('task-123', 'after_planning', 'approve');
      });

      expect(result.current.checkpoint).toBeNull();
      expect(result.current.isProcessing).toBe(false);
    });

    it('should ignore checkpoint-resumed for different task', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      // First set a checkpoint
      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      // Simulate checkpoint-resumed event for different task
      act(() => {
        checkpointResumedCallback?.('different-task', 'after_planning', 'approve');
      });

      // Checkpoint should still be there
      expect(result.current.checkpoint).not.toBeNull();
    });
  });

  describe('approve', () => {
    it('should call electronAPI.checkpoints.approve', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      // Set checkpoint first
      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      // Call approve
      await act(async () => {
        await result.current.approve();
      });

      expect(mockApprove).toHaveBeenCalledWith('task-123', 'after_planning', undefined, undefined);
    });

    it('should call approve with feedback', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      await act(async () => {
        await result.current.approve('Good work!');
      });

      expect(mockApprove).toHaveBeenCalledWith('task-123', 'after_planning', 'Good work!', undefined);
    });

    it('should call approve with attachments', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();
      const attachments: FeedbackAttachment[] = [
        { id: 'attach-1', type: 'file', path: '/path/to/file.txt', name: 'file.txt' },
      ];

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      await act(async () => {
        await result.current.approve('Feedback', attachments);
      });

      expect(mockApprove).toHaveBeenCalledWith('task-123', 'after_planning', 'Feedback', attachments);
    });

    it('should set processing state during approve', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      // Make approve hang to check processing state
      let resolveApprove: (value: unknown) => void;
      mockApprove.mockImplementation(() => new Promise((resolve) => {
        resolveApprove = resolve;
      }));

      let approvePromise: Promise<void>;
      act(() => {
        approvePromise = result.current.approve();
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(true);
      });

      // Resolve
      await act(async () => {
        resolveApprove!({ success: true, data: { success: true, resumed: true } });
        await approvePromise;
      });
    });

    it('should set error on failure', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      mockApprove.mockResolvedValue({ success: false, error: 'Approval failed' });

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.error).toBe('Approval failed');
      expect(result.current.isProcessing).toBe(false);
    });

    it('should set error without checkpoint', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.error).toBe('No checkpoint or task to approve');
    });
  });

  describe('revise', () => {
    it('should call electronAPI.checkpoints.revise with feedback', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      await act(async () => {
        await result.current.revise('Please add error handling');
      });

      expect(mockRevise).toHaveBeenCalledWith('task-123', 'after_planning', 'Please add error handling', undefined);
    });

    it('should require non-empty feedback', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      await act(async () => {
        await result.current.revise('   '); // Whitespace only
      });

      expect(mockRevise).not.toHaveBeenCalled();
      expect(result.current.error).toBe('Feedback is required for revision');
    });

    it('should call revise with attachments', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();
      const attachments: FeedbackAttachment[] = [
        { id: 'attach-1', type: 'file', path: '/path/to/screenshot.png', name: 'screenshot.png' },
      ];

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      await act(async () => {
        await result.current.revise('Check this screenshot', attachments);
      });

      expect(mockRevise).toHaveBeenCalledWith('task-123', 'after_planning', 'Check this screenshot', attachments);
    });

    it('should set error on failure', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      mockRevise.mockResolvedValue({ success: false, error: 'Revision failed' });

      await act(async () => {
        await result.current.revise('Feedback');
      });

      expect(result.current.error).toBe('Revision failed');
    });
  });

  describe('cancel', () => {
    it('should call electronAPI.checkpoints.cancel', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      await act(async () => {
        await result.current.cancel();
      });

      expect(mockCancel).toHaveBeenCalledWith('task-123', 'after_planning');
    });

    it('should set error without checkpoint', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      await act(async () => {
        await result.current.cancel();
      });

      expect(result.current.error).toBe('No checkpoint or task to cancel');
    });

    it('should set error on failure', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      mockCancel.mockResolvedValue({ success: false, error: 'Cancel failed' });

      await act(async () => {
        await result.current.cancel();
      });

      expect(result.current.error).toBe('Cancel failed');
    });
  });

  describe('closeDialog', () => {
    it('should clear checkpoint state', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      // Set checkpoint
      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      expect(result.current.isOpen).toBe(true);

      // Close dialog
      act(() => {
        result.current.closeDialog();
      });

      expect(result.current.isOpen).toBe(false);
      expect(result.current.checkpoint).toBeNull();
    });
  });

  describe('store actions exposure', () => {
    it('should expose setCheckpoint', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        result.current.setCheckpoint(checkpoint);
      });

      expect(result.current.checkpoint).toEqual(checkpoint);
    });

    it('should expose setFeedbackHistory', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      act(() => {
        result.current.setFeedbackHistory([{
          id: 'feedback-1',
          checkpointId: 'after_planning',
          feedback: 'Test',
          attachments: [],
          createdAt: new Date().toISOString(),
        }]);
      });

      expect(result.current.feedbackHistory).toHaveLength(1);
    });

    it('should expose addFeedback', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      act(() => {
        result.current.addFeedback({
          id: 'feedback-1',
          checkpointId: 'after_planning',
          feedback: 'Test',
          attachments: [],
          createdAt: new Date().toISOString(),
        });
      });

      expect(result.current.feedbackHistory).toHaveLength(1);
    });

    it('should expose setError', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      act(() => {
        result.current.setError('Custom error');
      });

      expect(result.current.error).toBe('Custom error');
    });
  });

  describe('without taskId', () => {
    it('should work without taskId (all events)', () => {
      const { result } = renderHook(() => useCheckpoint());
      const checkpoint = createTestCheckpoint({ taskId: 'any-task' });

      // Should receive events for any task
      act(() => {
        checkpointReachedCallback?.('any-task', checkpoint);
      });

      expect(result.current.checkpoint).toEqual(checkpoint);
    });

    it('should fail approve without taskId', async () => {
      const { result } = renderHook(() => useCheckpoint()); // No taskId
      const checkpoint = createTestCheckpoint();

      act(() => {
        result.current.setCheckpoint(checkpoint);
      });

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.error).toBe('No checkpoint or task to approve');
    });
  });

  describe('exception handling', () => {
    it('should handle approve throwing exception', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      mockApprove.mockRejectedValue(new Error('Network error'));

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.isProcessing).toBe(false);
    });

    it('should handle non-Error exception', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      mockApprove.mockRejectedValue('String error');

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.error).toBe('Unknown error');
    });
  });

  // Story 5.5: Revision flow integration tests
  describe('revision history integration', () => {
    it('should expose revisionHistory from store', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      expect(result.current.revisionHistory).toEqual([]);
    });

    it('should expose setRevisionHistory action', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      act(() => {
        result.current.setRevisionHistory([{
          id: 'rev-1',
          checkpointId: 'after_planning',
          phaseId: 'planning',
          revisionNumber: 1,
          feedback: 'Add error handling',
          attachments: [],
          beforeArtifacts: ['plan.md'],
          afterArtifacts: ['plan.md'],
          status: 'completed',
          requestedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }]);
      });

      expect(result.current.revisionHistory).toHaveLength(1);
      expect(result.current.revisionHistory[0].id).toBe('rev-1');
    });

    it('should transform snake_case revision_history from checkpoint event to camelCase', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      // Simulate checkpoint event with snake_case revision_history from backend
      const checkpointWithRevisionHistory = {
        ...createTestCheckpoint(),
        revision_history: [
          {
            id: 'rev-1',
            checkpoint_id: 'after_planning',
            phase_id: 'planning',
            revision_number: 1,
            feedback: 'Please add error handling',
            attachments: [],
            before_artifacts: ['spec/plan.md'],
            after_artifacts: ['spec/plan-v2.md'],
            status: 'completed',
            requested_at: '2026-01-16T10:00:00Z',
            completed_at: '2026-01-16T10:30:00Z',
          },
        ],
      };

      act(() => {
        checkpointReachedCallback?.('task-123', checkpointWithRevisionHistory as CheckpointInfo);
      });

      // Verify transformation to camelCase
      expect(result.current.revisionHistory).toHaveLength(1);
      const revision = result.current.revisionHistory[0];
      expect(revision.checkpointId).toBe('after_planning');
      expect(revision.phaseId).toBe('planning');
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeArtifacts).toEqual(['spec/plan.md']);
      expect(revision.afterArtifacts).toEqual(['spec/plan-v2.md']);
      expect(revision.requestedAt).toBe('2026-01-16T10:00:00Z');
      expect(revision.completedAt).toBe('2026-01-16T10:30:00Z');
    });

    it('should handle multiple revision entries', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      const checkpointWithRevisions = {
        ...createTestCheckpoint(),
        revision_history: [
          {
            id: 'rev-1',
            checkpoint_id: 'after_planning',
            phase_id: 'planning',
            revision_number: 1,
            feedback: 'First revision',
            attachments: [],
            before_artifacts: ['plan.md'],
            after_artifacts: ['plan-v1.md'],
            status: 'completed',
            requested_at: '2026-01-16T10:00:00Z',
            completed_at: '2026-01-16T10:30:00Z',
          },
          {
            id: 'rev-2',
            checkpoint_id: 'after_planning',
            phase_id: 'planning',
            revision_number: 2,
            feedback: 'Second revision',
            attachments: [],
            before_artifacts: ['plan-v1.md'],
            after_artifacts: ['plan-v2.md'],
            status: 'completed',
            requested_at: '2026-01-16T11:00:00Z',
            completed_at: '2026-01-16T11:30:00Z',
          },
        ],
      };

      act(() => {
        checkpointReachedCallback?.('task-123', checkpointWithRevisions as CheckpointInfo);
      });

      expect(result.current.revisionHistory).toHaveLength(2);
      expect(result.current.revisionHistory[0].revisionNumber).toBe(1);
      expect(result.current.revisionHistory[1].revisionNumber).toBe(2);
    });

    it('should handle checkpoint without revision_history', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));
      const checkpoint = createTestCheckpoint();

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint);
      });

      // Should not throw and revisionHistory should remain empty
      expect(result.current.revisionHistory).toEqual([]);
    });

    it('should handle in_progress revision status', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      const checkpointWithInProgressRevision = {
        ...createTestCheckpoint(),
        revision_history: [
          {
            id: 'rev-1',
            checkpoint_id: 'after_planning',
            phase_id: 'planning',
            revision_number: 1,
            feedback: 'Working on it',
            attachments: [],
            before_artifacts: ['plan.md'],
            after_artifacts: [],
            status: 'in_progress',
            requested_at: '2026-01-16T10:00:00Z',
          },
        ],
      };

      act(() => {
        checkpointReachedCallback?.('task-123', checkpointWithInProgressRevision as CheckpointInfo);
      });

      expect(result.current.revisionHistory[0].status).toBe('in_progress');
      expect(result.current.revisionHistory[0].completedAt).toBeUndefined();
    });

    it('should handle failed revision with error', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      const checkpointWithFailedRevision = {
        ...createTestCheckpoint(),
        revision_history: [
          {
            id: 'rev-1',
            checkpoint_id: 'after_planning',
            phase_id: 'planning',
            revision_number: 1,
            feedback: 'This failed',
            attachments: [],
            before_artifacts: ['plan.md'],
            after_artifacts: [],
            status: 'failed',
            requested_at: '2026-01-16T10:00:00Z',
            completed_at: '2026-01-16T10:30:00Z',
            error: 'Agent crashed during revision',
          },
        ],
      };

      act(() => {
        checkpointReachedCallback?.('task-123', checkpointWithFailedRevision as CheckpointInfo);
      });

      expect(result.current.revisionHistory[0].status).toBe('failed');
      expect(result.current.revisionHistory[0].error).toBe('Agent crashed during revision');
    });

    it('should clear revision history when new checkpoint is set', () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      // First checkpoint with revision history
      const checkpoint1 = {
        ...createTestCheckpoint({ checkpointId: 'cp1' }),
        revision_history: [
          {
            id: 'rev-1',
            checkpoint_id: 'cp1',
            phase_id: 'planning',
            revision_number: 1,
            feedback: 'Revision 1',
            attachments: [],
            before_artifacts: [],
            after_artifacts: [],
            status: 'completed',
            requested_at: '2026-01-16T10:00:00Z',
          },
        ],
      };

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint1 as CheckpointInfo);
      });

      expect(result.current.revisionHistory).toHaveLength(1);

      // New checkpoint without revision history - should clear
      const checkpoint2 = createTestCheckpoint({ checkpointId: 'cp2' });

      act(() => {
        checkpointReachedCallback?.('task-123', checkpoint2);
      });

      // setCheckpoint clears revisionHistory, but the new checkpoint has no revision_history
      // so it should remain empty
      expect(result.current.revisionHistory).toEqual([]);
    });

    // Full integration flow test
    it('integration: full revision flow - revise request → new checkpoint with history', async () => {
      const { result } = renderHook(() => useCheckpoint('task-123'));

      // Step 1: Initial checkpoint arrives
      const initialCheckpoint = createTestCheckpoint();
      act(() => {
        checkpointReachedCallback?.('task-123', initialCheckpoint);
      });

      expect(result.current.checkpoint).not.toBeNull();
      expect(result.current.revisionHistory).toHaveLength(0);

      // Step 2: User requests revision
      await act(async () => {
        await result.current.revise('Add better error handling');
      });

      expect(mockRevise).toHaveBeenCalledWith('task-123', 'after_planning', 'Add better error handling', undefined);

      // Step 3: Backend processes revision, emits checkpoint-resumed
      act(() => {
        checkpointResumedCallback?.('task-123', 'after_planning', 'revise');
      });

      // Checkpoint should be cleared while revision is in progress
      expect(result.current.checkpoint).toBeNull();

      // Step 4: New checkpoint arrives with revision history
      const newCheckpoint = {
        ...createTestCheckpoint({ checkpointId: 'after_planning_v2' }),
        revision_history: [
          {
            id: 'rev-1',
            checkpoint_id: 'after_planning',
            phase_id: 'planning',
            revision_number: 1,
            feedback: 'Add better error handling',
            attachments: [],
            before_artifacts: ['spec/plan.md'],
            after_artifacts: ['spec/plan-v2.md'],
            status: 'completed',
            requested_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          },
        ],
      };

      act(() => {
        checkpointReachedCallback?.('task-123', newCheckpoint as CheckpointInfo);
      });

      // Step 5: Verify UI now shows revision history
      expect(result.current.checkpoint?.checkpointId).toBe('after_planning_v2');
      expect(result.current.revisionHistory).toHaveLength(1);
      expect(result.current.revisionHistory[0].feedback).toBe('Add better error handling');
      expect(result.current.revisionHistory[0].status).toBe('completed');
    });
  });
});
