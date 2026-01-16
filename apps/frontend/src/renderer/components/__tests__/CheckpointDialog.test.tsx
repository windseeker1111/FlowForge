/**
 * @vitest-environment jsdom
 */
/**
 * Tests for CheckpointDialog component
 *
 * Story Reference: Story 5.2 - Implement Checkpoint Dialog Component
 */
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckpointDialog } from '../checkpoints/CheckpointDialog';
import type { CheckpointInfo } from '../checkpoints/types';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const translations: Record<string, string> = {
        'checkpoints:dialog.title': `${params?.phase || ''} Complete`,
        'checkpoints:dialog.phaseComplete': 'phase complete',
        'checkpoints:dialog.expand': 'Show details',
        'checkpoints:dialog.collapse': 'Hide details',
        'checkpoints:dialog.keyDecisions': 'Key Decisions',
        'checkpoints:dialog.warnings': 'Warnings',
        'checkpoints:dialog.artifacts': 'Artifacts Produced',
        'checkpoints:dialog.feedbackTitle': 'Revision Feedback',
        'checkpoints:dialog.feedbackPlaceholder': 'Describe what changes you\'d like to see...',
        'checkpoints:dialog.submitting': 'Submitting...',
        'checkpoints:dialog.submitRevision': 'Submit Revision',
        'checkpoints:dialog.processing': 'Processing...',
        'checkpoints:dialog.approve': 'Approve & Continue',
        'checkpoints:dialog.revision': 'Request Revision',
        'checkpoints:dialog.cancel': 'Cancel Task',
        'checkpoints:phases.planning': 'Planning',
        'checkpoints:phases.coding': 'Coding',
        'checkpoints:phases.validation': 'Validation',
        'common:buttons.cancel': 'Cancel',
      };
      return translations[key] || key;
    },
  }),
}));

// Sample checkpoint data for tests
const createMockCheckpoint = (overrides?: Partial<CheckpointInfo>): CheckpointInfo => ({
  checkpointId: 'after_planning',
  name: 'Planning Review',
  description: 'Review implementation plan before coding begins',
  phase: 'planning',
  taskId: 'task-123',
  pausedAt: '2026-01-16T10:00:00Z',
  artifacts: [
    { path: 'spec/plan.md', name: 'Implementation Plan', type: 'plan' },
    { path: 'spec/context.json', name: 'Context Analysis', type: 'file' },
  ],
  decisions: [
    { description: 'Using React hooks for state management', severity: 'info' },
    { description: 'Added error boundary for crash protection', severity: 'warning', relatedTo: 'ErrorBoundary.tsx' },
  ],
  warnings: ['Large file detected: may need refactoring'],
  requiresApproval: true,
  summary: 'Implementation plan created with 5 subtasks',
  ...overrides,
});

describe('CheckpointDialog', () => {
  const defaultProps = {
    open: true,
    checkpoint: createMockCheckpoint(),
    onApprove: vi.fn(),
    onRevision: vi.fn(),
    onCancel: vi.fn(),
    onOpenChange: vi.fn(),
    onViewArtifact: vi.fn(),
    isProcessing: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders dialog with checkpoint title', () => {
      render(<CheckpointDialog {...defaultProps} />);

      expect(screen.getByText('Planning Complete')).toBeInTheDocument();
    });

    it('renders checkpoint description', () => {
      render(<CheckpointDialog {...defaultProps} />);

      expect(screen.getByText('Review implementation plan before coding begins')).toBeInTheDocument();
    });

    it('renders phase complete indicator', () => {
      render(<CheckpointDialog {...defaultProps} />);

      expect(screen.getByText('phase complete')).toBeInTheDocument();
    });

    it('renders summary when provided', () => {
      render(<CheckpointDialog {...defaultProps} />);

      expect(screen.getByText('Implementation plan created with 5 subtasks')).toBeInTheDocument();
    });

    it('does not render when checkpoint is null', () => {
      render(<CheckpointDialog {...defaultProps} checkpoint={null} />);

      expect(screen.queryByText('Planning Complete')).not.toBeInTheDocument();
    });

    it('does not render when dialog is closed', () => {
      render(<CheckpointDialog {...defaultProps} open={false} />);

      expect(screen.queryByText('Planning Complete')).not.toBeInTheDocument();
    });
  });

  describe('decision buttons', () => {
    it('renders approve button', () => {
      render(<CheckpointDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: /approve & continue/i })).toBeInTheDocument();
    });

    it('renders revision button', () => {
      render(<CheckpointDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: /request revision/i })).toBeInTheDocument();
    });

    it('renders cancel button', () => {
      render(<CheckpointDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: /cancel task/i })).toBeInTheDocument();
    });

    it('calls onApprove when approve button is clicked', () => {
      render(<CheckpointDialog {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /approve & continue/i }));

      expect(defaultProps.onApprove).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when cancel button is clicked', () => {
      render(<CheckpointDialog {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /cancel task/i }));

      expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    });

    it('buttons have minimum 44px touch target', () => {
      render(<CheckpointDialog {...defaultProps} />);

      const approveButton = screen.getByRole('button', { name: /approve & continue/i });
      const revisionButton = screen.getByRole('button', { name: /request revision/i });
      const cancelButton = screen.getByRole('button', { name: /cancel task/i });

      // Check for min-h-[44px] class (min-height for touch targets)
      expect(approveButton).toHaveClass('min-h-[44px]');
      expect(revisionButton).toHaveClass('min-h-[44px]');
      expect(cancelButton).toHaveClass('min-h-[44px]');
    });
  });

  describe('revision feedback', () => {
    it('shows feedback input when revision button is clicked', () => {
      render(<CheckpointDialog {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /request revision/i }));

      expect(screen.getByText('Revision Feedback')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/describe what changes/i)).toBeInTheDocument();
    });

    it('calls onRevision with feedback when submitted', () => {
      render(<CheckpointDialog {...defaultProps} />);

      // Open feedback input
      fireEvent.click(screen.getByRole('button', { name: /request revision/i }));

      // Type feedback
      const textarea = screen.getByPlaceholderText(/describe what changes/i);
      fireEvent.change(textarea, { target: { value: 'Please add more error handling' } });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /submit revision/i }));

      expect(defaultProps.onRevision).toHaveBeenCalledWith('Please add more error handling');
    });

    it('disables submit button when feedback is empty', () => {
      render(<CheckpointDialog {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /request revision/i }));

      const submitButton = screen.getByRole('button', { name: /submit revision/i });
      expect(submitButton).toBeDisabled();
    });

    it('can cancel feedback input', () => {
      render(<CheckpointDialog {...defaultProps} />);

      // Open feedback
      fireEvent.click(screen.getByRole('button', { name: /request revision/i }));
      expect(screen.getByText('Revision Feedback')).toBeInTheDocument();

      // Cancel
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

      // Should show decision buttons again
      expect(screen.getByRole('button', { name: /approve & continue/i })).toBeInTheDocument();
    });
  });

  describe('artifacts display', () => {
    it('renders artifacts section when artifacts exist', () => {
      render(<CheckpointDialog {...defaultProps} />);

      expect(screen.getByText('Artifacts Produced')).toBeInTheDocument();
    });

    it('renders each artifact with name', () => {
      render(<CheckpointDialog {...defaultProps} />);

      expect(screen.getByText('Implementation Plan')).toBeInTheDocument();
      expect(screen.getByText('Context Analysis')).toBeInTheDocument();
    });

    it('renders artifact paths', () => {
      render(<CheckpointDialog {...defaultProps} />);

      expect(screen.getByText('spec/plan.md')).toBeInTheDocument();
      expect(screen.getByText('spec/context.json')).toBeInTheDocument();
    });

    it('does not render artifacts section when empty', () => {
      const checkpoint = createMockCheckpoint({ artifacts: [] });
      render(<CheckpointDialog {...defaultProps} checkpoint={checkpoint} />);

      expect(screen.queryByText('Artifacts Produced')).not.toBeInTheDocument();
    });

    it('calls onViewArtifact when artifact is clicked', () => {
      render(<CheckpointDialog {...defaultProps} />);

      // Click first artifact
      fireEvent.click(screen.getByText('Implementation Plan'));

      expect(defaultProps.onViewArtifact).toHaveBeenCalledTimes(1);
      expect(defaultProps.onViewArtifact).toHaveBeenCalledWith({
        path: 'spec/plan.md',
        name: 'Implementation Plan',
        type: 'plan',
      });
    });

    it('handles invalid artifacts defensively', () => {
      const checkpoint = createMockCheckpoint({
        artifacts: [
          { path: 'valid.md', name: 'Valid', type: 'file' },
          { path: '', name: 'Invalid Path', type: 'file' }, // Invalid - empty path
          { path: 'no-name.md', name: '', type: 'file' }, // Invalid - empty name
        ] as CheckpointInfo['artifacts'],
      });
      render(<CheckpointDialog {...defaultProps} checkpoint={checkpoint} />);

      // Only valid artifact should render
      expect(screen.getByText('Valid')).toBeInTheDocument();
      expect(screen.queryByText('Invalid Path')).not.toBeInTheDocument();
    });
  });

  describe('expandable details', () => {
    it('shows expand button', () => {
      render(<CheckpointDialog {...defaultProps} />);

      expect(screen.getByLabelText('Show details')).toBeInTheDocument();
    });

    it('shows key decisions when expanded', () => {
      render(<CheckpointDialog {...defaultProps} />);

      // Expand
      fireEvent.click(screen.getByLabelText('Show details'));

      expect(screen.getByText('Key Decisions')).toBeInTheDocument();
      expect(screen.getByText('Using React hooks for state management')).toBeInTheDocument();
    });

    it('shows warnings when expanded', () => {
      render(<CheckpointDialog {...defaultProps} />);

      fireEvent.click(screen.getByLabelText('Show details'));

      expect(screen.getByText('Warnings')).toBeInTheDocument();
      expect(screen.getByText('Large file detected: may need refactoring')).toBeInTheDocument();
    });

    it('can collapse details', () => {
      render(<CheckpointDialog {...defaultProps} />);

      // Expand
      fireEvent.click(screen.getByLabelText('Show details'));
      expect(screen.getByText('Key Decisions')).toBeInTheDocument();

      // Collapse
      fireEvent.click(screen.getByLabelText('Hide details'));

      // Key decisions should not be visible (collapsed)
      expect(screen.queryByText('Key Decisions')).not.toBeInTheDocument();
    });
  });

  describe('processing state', () => {
    it('shows processing state on approve button', () => {
      render(<CheckpointDialog {...defaultProps} isProcessing={true} />);

      expect(screen.getByText('Processing...')).toBeInTheDocument();
    });

    it('disables buttons when processing', () => {
      render(<CheckpointDialog {...defaultProps} isProcessing={true} />);

      expect(screen.getByRole('button', { name: /processing/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /request revision/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /cancel task/i })).toBeDisabled();
    });

    it('shows processing state during feedback submission', () => {
      const { rerender } = render(<CheckpointDialog {...defaultProps} />);

      // Open feedback and type
      fireEvent.click(screen.getByRole('button', { name: /request revision/i }));
      fireEvent.change(screen.getByPlaceholderText(/describe/i), { target: { value: 'feedback' } });

      // Rerender with processing
      rerender(<CheckpointDialog {...defaultProps} isProcessing={true} />);

      // Note: feedback mode should show submitting state
      expect(screen.getByText('Submitting...')).toBeInTheDocument();
    });
  });

  describe('different phases', () => {
    it('renders coding phase checkpoint', () => {
      const checkpoint = createMockCheckpoint({
        checkpointId: 'after_coding',
        phase: 'coding',
        name: 'Code Review',
        description: 'Review implemented code before validation',
      });
      render(<CheckpointDialog {...defaultProps} checkpoint={checkpoint} />);

      expect(screen.getByText('Coding Complete')).toBeInTheDocument();
    });

    it('renders validation phase checkpoint', () => {
      const checkpoint = createMockCheckpoint({
        checkpointId: 'after_validation',
        phase: 'validation',
        name: 'Validation Review',
        description: 'Review QA results before completion',
      });
      render(<CheckpointDialog {...defaultProps} checkpoint={checkpoint} />);

      expect(screen.getByText('Validation Complete')).toBeInTheDocument();
    });

    it('handles backend phase naming (plan instead of planning)', () => {
      const checkpoint = createMockCheckpoint({
        checkpointId: 'after_plan',
        phase: 'plan', // Backend uses 'plan' instead of 'planning'
        name: 'Plan Review',
        description: 'Review plan before coding',
      });
      render(<CheckpointDialog {...defaultProps} checkpoint={checkpoint} />);

      // Should normalize 'plan' to 'Planning' via i18n
      expect(screen.getByText('Planning Complete')).toBeInTheDocument();
    });

    it('handles backend phase naming (validate instead of validation)', () => {
      const checkpoint = createMockCheckpoint({
        checkpointId: 'after_validate',
        phase: 'validate', // Backend uses 'validate' instead of 'validation'
        name: 'Validate Review',
        description: 'Review validation results',
      });
      render(<CheckpointDialog {...defaultProps} checkpoint={checkpoint} />);

      // Should normalize 'validate' to 'Validation' via i18n
      expect(screen.getByText('Validation Complete')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has accessible expand/collapse button', () => {
      render(<CheckpointDialog {...defaultProps} />);

      const expandButton = screen.getByLabelText('Show details');
      expect(expandButton).toBeInTheDocument();
    });

    it('buttons are keyboard accessible', () => {
      render(<CheckpointDialog {...defaultProps} />);

      // Buttons with role="button" are natively keyboard accessible
      // Verify buttons can be found by role and are focusable
      const approveButton = screen.getByRole('button', { name: /approve & continue/i });
      const revisionButton = screen.getByRole('button', { name: /request revision/i });
      const cancelButton = screen.getByRole('button', { name: /cancel task/i });

      // All buttons should be accessible by role
      expect(approveButton).toBeInTheDocument();
      expect(revisionButton).toBeInTheDocument();
      expect(cancelButton).toBeInTheDocument();

      // Buttons should not be disabled
      expect(approveButton).not.toBeDisabled();
      expect(revisionButton).not.toBeDisabled();
      expect(cancelButton).not.toBeDisabled();
    });
  });
});
