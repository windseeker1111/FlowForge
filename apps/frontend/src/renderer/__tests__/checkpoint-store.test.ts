/**
 * Unit tests for Checkpoint Store
 *
 * Story Reference: Story 5.4 - Implement Checkpoint Approval Flow
 * Story Reference: Story 5.5 - Implement Checkpoint Revision Flow
 * Tests Zustand store for checkpoint state management in Semi-Auto mode
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useCheckpointStore } from '../stores/checkpoint-store';
import type { CheckpointInfo, CheckpointFeedback, RevisionEntry } from '../components/checkpoints/types';

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

// Helper to create test feedback
function createTestFeedback(overrides: Partial<CheckpointFeedback> = {}): CheckpointFeedback {
  return {
    id: `feedback-${Date.now()}`,
    checkpointId: 'after_planning',
    feedback: 'Please add more error handling',
    attachments: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create test revision entry (Story 5.5)
function createTestRevision(overrides: Partial<RevisionEntry> = {}): RevisionEntry {
  return {
    id: `revision-${Date.now()}`,
    checkpointId: 'after_planning',
    phaseId: 'planning',
    revisionNumber: 1,
    feedback: 'Please add more error handling',
    attachments: [],
    beforeArtifacts: ['spec/plan.md'],
    afterArtifacts: [],
    status: 'pending',
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Checkpoint Store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useCheckpointStore.setState({
      currentCheckpoint: null,
      isProcessing: false,
      feedbackHistory: [],
      revisionHistory: [],
      error: null,
    });
  });

  describe('initial state', () => {
    it('should have null checkpoint initially', () => {
      expect(useCheckpointStore.getState().currentCheckpoint).toBeNull();
    });

    it('should not be processing initially', () => {
      expect(useCheckpointStore.getState().isProcessing).toBe(false);
    });

    it('should have empty feedback history initially', () => {
      expect(useCheckpointStore.getState().feedbackHistory).toHaveLength(0);
    });

    it('should have empty revision history initially', () => {
      expect(useCheckpointStore.getState().revisionHistory).toHaveLength(0);
    });

    it('should have no error initially', () => {
      expect(useCheckpointStore.getState().error).toBeNull();
    });
  });

  describe('setCheckpoint', () => {
    it('should set the current checkpoint', () => {
      const checkpoint = createTestCheckpoint();

      useCheckpointStore.getState().setCheckpoint(checkpoint);

      expect(useCheckpointStore.getState().currentCheckpoint).toEqual(checkpoint);
    });

    it('should clear feedback history when setting new checkpoint', () => {
      // First add some feedback
      useCheckpointStore.setState({ feedbackHistory: [createTestFeedback()] });

      // Set new checkpoint
      useCheckpointStore.getState().setCheckpoint(createTestCheckpoint());

      expect(useCheckpointStore.getState().feedbackHistory).toHaveLength(0);
    });

    it('should clear revision history when setting new checkpoint', () => {
      // First add some revisions
      useCheckpointStore.setState({ revisionHistory: [createTestRevision()] });

      // Set new checkpoint
      useCheckpointStore.getState().setCheckpoint(createTestCheckpoint());

      expect(useCheckpointStore.getState().revisionHistory).toHaveLength(0);
    });

    it('should clear error when setting new checkpoint', () => {
      // First set an error
      useCheckpointStore.setState({ error: 'Previous error' });

      // Set new checkpoint
      useCheckpointStore.getState().setCheckpoint(createTestCheckpoint());

      expect(useCheckpointStore.getState().error).toBeNull();
    });

    it('should allow setting checkpoint to null', () => {
      useCheckpointStore.getState().setCheckpoint(createTestCheckpoint());
      useCheckpointStore.getState().setCheckpoint(null);

      expect(useCheckpointStore.getState().currentCheckpoint).toBeNull();
    });
  });

  describe('setProcessing', () => {
    it('should set processing to true', () => {
      useCheckpointStore.getState().setProcessing(true);

      expect(useCheckpointStore.getState().isProcessing).toBe(true);
    });

    it('should set processing to false', () => {
      useCheckpointStore.setState({ isProcessing: true });
      useCheckpointStore.getState().setProcessing(false);

      expect(useCheckpointStore.getState().isProcessing).toBe(false);
    });
  });

  describe('setFeedbackHistory', () => {
    it('should set feedback history', () => {
      const feedback = [createTestFeedback({ id: 'feedback-1' }), createTestFeedback({ id: 'feedback-2' })];

      useCheckpointStore.getState().setFeedbackHistory(feedback);

      expect(useCheckpointStore.getState().feedbackHistory).toHaveLength(2);
      expect(useCheckpointStore.getState().feedbackHistory[0].id).toBe('feedback-1');
    });

    it('should replace existing feedback history', () => {
      useCheckpointStore.setState({ feedbackHistory: [createTestFeedback({ id: 'old' })] });

      useCheckpointStore.getState().setFeedbackHistory([createTestFeedback({ id: 'new' })]);

      expect(useCheckpointStore.getState().feedbackHistory).toHaveLength(1);
      expect(useCheckpointStore.getState().feedbackHistory[0].id).toBe('new');
    });

    it('should handle empty array', () => {
      useCheckpointStore.setState({ feedbackHistory: [createTestFeedback()] });

      useCheckpointStore.getState().setFeedbackHistory([]);

      expect(useCheckpointStore.getState().feedbackHistory).toHaveLength(0);
    });
  });

  describe('addFeedback', () => {
    it('should add feedback to empty history', () => {
      const feedback = createTestFeedback();

      useCheckpointStore.getState().addFeedback(feedback);

      expect(useCheckpointStore.getState().feedbackHistory).toHaveLength(1);
      expect(useCheckpointStore.getState().feedbackHistory[0]).toEqual(feedback);
    });

    it('should append feedback to existing history', () => {
      useCheckpointStore.setState({
        feedbackHistory: [createTestFeedback({ id: 'first' })],
      });

      useCheckpointStore.getState().addFeedback(createTestFeedback({ id: 'second' }));

      expect(useCheckpointStore.getState().feedbackHistory).toHaveLength(2);
      expect(useCheckpointStore.getState().feedbackHistory[1].id).toBe('second');
    });

    it('should preserve existing feedback when adding', () => {
      const firstFeedback = createTestFeedback({ id: 'first', feedback: 'First feedback' });
      const secondFeedback = createTestFeedback({ id: 'second', feedback: 'Second feedback' });

      useCheckpointStore.getState().addFeedback(firstFeedback);
      useCheckpointStore.getState().addFeedback(secondFeedback);

      expect(useCheckpointStore.getState().feedbackHistory[0].feedback).toBe('First feedback');
      expect(useCheckpointStore.getState().feedbackHistory[1].feedback).toBe('Second feedback');
    });
  });

  // Story 5.5: Revision history tests
  describe('setRevisionHistory', () => {
    it('should set revision history', () => {
      const revisions = [createTestRevision({ id: 'rev-1' }), createTestRevision({ id: 'rev-2' })];

      useCheckpointStore.getState().setRevisionHistory(revisions);

      expect(useCheckpointStore.getState().revisionHistory).toHaveLength(2);
      expect(useCheckpointStore.getState().revisionHistory[0].id).toBe('rev-1');
    });

    it('should replace existing revision history', () => {
      useCheckpointStore.setState({ revisionHistory: [createTestRevision({ id: 'old' })] });

      useCheckpointStore.getState().setRevisionHistory([createTestRevision({ id: 'new' })]);

      expect(useCheckpointStore.getState().revisionHistory).toHaveLength(1);
      expect(useCheckpointStore.getState().revisionHistory[0].id).toBe('new');
    });

    it('should handle empty array', () => {
      useCheckpointStore.setState({ revisionHistory: [createTestRevision()] });

      useCheckpointStore.getState().setRevisionHistory([]);

      expect(useCheckpointStore.getState().revisionHistory).toHaveLength(0);
    });
  });

  describe('addRevision', () => {
    it('should add revision to empty history', () => {
      const revision = createTestRevision();

      useCheckpointStore.getState().addRevision(revision);

      expect(useCheckpointStore.getState().revisionHistory).toHaveLength(1);
      expect(useCheckpointStore.getState().revisionHistory[0]).toEqual(revision);
    });

    it('should append revision to existing history', () => {
      useCheckpointStore.setState({
        revisionHistory: [createTestRevision({ id: 'first' })],
      });

      useCheckpointStore.getState().addRevision(createTestRevision({ id: 'second' }));

      expect(useCheckpointStore.getState().revisionHistory).toHaveLength(2);
      expect(useCheckpointStore.getState().revisionHistory[1].id).toBe('second');
    });

    it('should preserve existing revisions when adding', () => {
      const firstRevision = createTestRevision({ id: 'first', revisionNumber: 1 });
      const secondRevision = createTestRevision({ id: 'second', revisionNumber: 2 });

      useCheckpointStore.getState().addRevision(firstRevision);
      useCheckpointStore.getState().addRevision(secondRevision);

      expect(useCheckpointStore.getState().revisionHistory[0].revisionNumber).toBe(1);
      expect(useCheckpointStore.getState().revisionHistory[1].revisionNumber).toBe(2);
    });
  });

  describe('updateRevisionStatus', () => {
    it('should update revision status to in_progress', () => {
      const revision = createTestRevision({ id: 'rev-1', status: 'pending' });
      useCheckpointStore.setState({ revisionHistory: [revision] });

      useCheckpointStore.getState().updateRevisionStatus('rev-1', 'in_progress');

      expect(useCheckpointStore.getState().revisionHistory[0].status).toBe('in_progress');
    });

    it('should update revision status to completed with afterArtifacts', () => {
      const revision = createTestRevision({ id: 'rev-1', status: 'in_progress' });
      useCheckpointStore.setState({ revisionHistory: [revision] });

      useCheckpointStore.getState().updateRevisionStatus('rev-1', 'completed', ['spec/plan-v2.md']);

      const updated = useCheckpointStore.getState().revisionHistory[0];
      expect(updated.status).toBe('completed');
      expect(updated.afterArtifacts).toEqual(['spec/plan-v2.md']);
      expect(updated.completedAt).toBeDefined();
    });

    it('should update revision status to failed with error', () => {
      const revision = createTestRevision({ id: 'rev-1', status: 'in_progress' });
      useCheckpointStore.setState({ revisionHistory: [revision] });

      useCheckpointStore.getState().updateRevisionStatus('rev-1', 'failed', undefined, 'Something went wrong');

      const updated = useCheckpointStore.getState().revisionHistory[0];
      expect(updated.status).toBe('failed');
      expect(updated.error).toBe('Something went wrong');
      expect(updated.completedAt).toBeDefined();
    });

    it('should not update other revisions', () => {
      const rev1 = createTestRevision({ id: 'rev-1', status: 'completed' });
      const rev2 = createTestRevision({ id: 'rev-2', status: 'pending' });
      useCheckpointStore.setState({ revisionHistory: [rev1, rev2] });

      useCheckpointStore.getState().updateRevisionStatus('rev-2', 'in_progress');

      expect(useCheckpointStore.getState().revisionHistory[0].status).toBe('completed');
      expect(useCheckpointStore.getState().revisionHistory[1].status).toBe('in_progress');
    });

    it('should not set completedAt for pending or in_progress status', () => {
      const revision = createTestRevision({ id: 'rev-1', status: 'pending' });
      useCheckpointStore.setState({ revisionHistory: [revision] });

      useCheckpointStore.getState().updateRevisionStatus('rev-1', 'in_progress');

      expect(useCheckpointStore.getState().revisionHistory[0].completedAt).toBeUndefined();
    });

    it('should preserve existing afterArtifacts if not provided', () => {
      const revision = createTestRevision({
        id: 'rev-1',
        status: 'in_progress',
        afterArtifacts: ['existing.md'],
      });
      useCheckpointStore.setState({ revisionHistory: [revision] });

      useCheckpointStore.getState().updateRevisionStatus('rev-1', 'completed');

      expect(useCheckpointStore.getState().revisionHistory[0].afterArtifacts).toEqual(['existing.md']);
    });
  });

  describe('setError', () => {
    it('should set error message', () => {
      useCheckpointStore.getState().setError('Something went wrong');

      expect(useCheckpointStore.getState().error).toBe('Something went wrong');
    });

    it('should clear error when set to null', () => {
      useCheckpointStore.setState({ error: 'Previous error' });

      useCheckpointStore.getState().setError(null);

      expect(useCheckpointStore.getState().error).toBeNull();
    });
  });

  describe('clearCheckpoint', () => {
    it('should clear current checkpoint', () => {
      useCheckpointStore.setState({ currentCheckpoint: createTestCheckpoint() });

      useCheckpointStore.getState().clearCheckpoint();

      expect(useCheckpointStore.getState().currentCheckpoint).toBeNull();
    });

    it('should reset processing state', () => {
      useCheckpointStore.setState({ isProcessing: true });

      useCheckpointStore.getState().clearCheckpoint();

      expect(useCheckpointStore.getState().isProcessing).toBe(false);
    });

    it('should clear feedback history', () => {
      useCheckpointStore.setState({ feedbackHistory: [createTestFeedback()] });

      useCheckpointStore.getState().clearCheckpoint();

      expect(useCheckpointStore.getState().feedbackHistory).toHaveLength(0);
    });

    it('should clear revision history', () => {
      useCheckpointStore.setState({ revisionHistory: [createTestRevision()] });

      useCheckpointStore.getState().clearCheckpoint();

      expect(useCheckpointStore.getState().revisionHistory).toHaveLength(0);
    });

    it('should clear error', () => {
      useCheckpointStore.setState({ error: 'Some error' });

      useCheckpointStore.getState().clearCheckpoint();

      expect(useCheckpointStore.getState().error).toBeNull();
    });

    it('should reset all state at once', () => {
      // Set up full state
      useCheckpointStore.setState({
        currentCheckpoint: createTestCheckpoint(),
        isProcessing: true,
        feedbackHistory: [createTestFeedback()],
        revisionHistory: [createTestRevision()],
        error: 'Error message',
      });

      // Clear everything
      useCheckpointStore.getState().clearCheckpoint();

      // Verify all cleared
      const state = useCheckpointStore.getState();
      expect(state.currentCheckpoint).toBeNull();
      expect(state.isProcessing).toBe(false);
      expect(state.feedbackHistory).toHaveLength(0);
      expect(state.revisionHistory).toHaveLength(0);
      expect(state.error).toBeNull();
    });
  });

  describe('store isolation', () => {
    it('should not affect other state when setting checkpoint', () => {
      useCheckpointStore.setState({
        isProcessing: true,
        error: 'Existing error',
      });

      useCheckpointStore.getState().setCheckpoint(createTestCheckpoint());

      // isProcessing should be unchanged (only error and feedbackHistory are reset)
      expect(useCheckpointStore.getState().isProcessing).toBe(true);
    });

    it('should not affect checkpoint when setting error', () => {
      const checkpoint = createTestCheckpoint();
      useCheckpointStore.setState({ currentCheckpoint: checkpoint });

      useCheckpointStore.getState().setError('New error');

      expect(useCheckpointStore.getState().currentCheckpoint).toEqual(checkpoint);
    });
  });
});
