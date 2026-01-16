/**
 * Checkpoint store for Semi-Auto execution mode.
 *
 * Story Reference: Story 5.4 - Implement Checkpoint Approval Flow
 * Story Reference: Story 5.5 - Implement Checkpoint Revision Flow
 * Architecture Source: architecture.md#Checkpoint-Service
 *
 * Manages checkpoint state for the UI, including the currently displayed
 * checkpoint, processing state, feedback history, and revision history.
 */

import { create } from 'zustand';
import type { CheckpointInfo, CheckpointFeedback, RevisionEntry } from '../components/checkpoints/types';

export interface CheckpointState {
  /** Currently displayed checkpoint, or null if no checkpoint dialog is open */
  currentCheckpoint: CheckpointInfo | null;
  /** Whether a checkpoint action is being processed */
  isProcessing: boolean;
  /** Feedback history for the current checkpoint */
  feedbackHistory: CheckpointFeedback[];
  /** Revision history for the current checkpoint (Story 5.5) */
  revisionHistory: RevisionEntry[];
  /** Error message from the last operation, if any */
  error: string | null;
}

export interface CheckpointActions {
  /** Set the current checkpoint to display */
  setCheckpoint: (checkpoint: CheckpointInfo | null) => void;
  /** Set the processing state */
  setProcessing: (isProcessing: boolean) => void;
  /** Set the feedback history */
  setFeedbackHistory: (history: CheckpointFeedback[]) => void;
  /** Add a feedback entry to history */
  addFeedback: (feedback: CheckpointFeedback) => void;
  /** Set the revision history (Story 5.5) */
  setRevisionHistory: (history: RevisionEntry[]) => void;
  /** Add a revision entry to history (Story 5.5) */
  addRevision: (revision: RevisionEntry) => void;
  /** Update a revision entry status (Story 5.5) */
  updateRevisionStatus: (revisionId: string, status: RevisionEntry['status'], afterArtifacts?: string[], error?: string) => void;
  /** Set error message */
  setError: (error: string | null) => void;
  /** Clear checkpoint state (e.g., after closing dialog) */
  clearCheckpoint: () => void;
}

export type CheckpointStore = CheckpointState & CheckpointActions;

export const useCheckpointStore = create<CheckpointStore>((set) => ({
  // Initial state
  currentCheckpoint: null,
  isProcessing: false,
  feedbackHistory: [],
  revisionHistory: [],
  error: null,

  // Actions
  setCheckpoint: (checkpoint) =>
    set({
      currentCheckpoint: checkpoint,
      feedbackHistory: [],
      revisionHistory: [],
      error: null,
    }),

  setProcessing: (isProcessing) =>
    set({ isProcessing }),

  setFeedbackHistory: (history) =>
    set({ feedbackHistory: history }),

  addFeedback: (feedback) =>
    set((state) => ({
      feedbackHistory: [...state.feedbackHistory, feedback],
    })),

  // Story 5.5: Revision history actions
  setRevisionHistory: (history) =>
    set({ revisionHistory: history }),

  addRevision: (revision) =>
    set((state) => ({
      revisionHistory: [...state.revisionHistory, revision],
    })),

  updateRevisionStatus: (revisionId, status, afterArtifacts, error) =>
    set((state) => ({
      revisionHistory: state.revisionHistory.map((r) =>
        r.id === revisionId
          ? {
              ...r,
              status,
              afterArtifacts: afterArtifacts ?? r.afterArtifacts,
              error: error ?? r.error,
              completedAt: status === 'completed' || status === 'failed' ? new Date().toISOString() : r.completedAt,
            }
          : r
      ),
    })),

  setError: (error) =>
    set({ error }),

  clearCheckpoint: () =>
    set({
      currentCheckpoint: null,
      isProcessing: false,
      feedbackHistory: [],
      revisionHistory: [],
      error: null,
    }),
}));
