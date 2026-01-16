/**
 * @vitest-environment jsdom
 */
/**
 * Tests for RevisionHistory component
 *
 * Story Reference: Story 5.5 - Implement Checkpoint Revision Flow
 * Task 7: Build revision history viewer
 */
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RevisionHistory } from '../checkpoints/RevisionHistory';
import type { RevisionEntry } from '../checkpoints/types';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'checkpoints:revision.historyTitle': 'Revision History',
        'checkpoints:revision.feedback': 'Revision Feedback',
        'checkpoints:revision.beforeArtifacts': 'Before',
        'checkpoints:revision.afterArtifacts': 'After',
        'checkpoints:revision.noArtifacts': 'No artifacts',
        'checkpoints:revision.error': 'Error',
        'checkpoints:revision.completedAt': `Completed at ${params?.time || ''}`,
        'checkpoints:revision.status.pending': 'Pending',
        'checkpoints:revision.status.in_progress': 'In Progress',
        'checkpoints:revision.status.completed': 'Completed',
        'checkpoints:revision.status.failed': 'Failed',
      };
      return translations[key] || key;
    },
  }),
}));

// Helper to create test revision entry
function createTestRevision(overrides: Partial<RevisionEntry> = {}): RevisionEntry {
  return {
    id: `revision-${Date.now()}`,
    checkpointId: 'after_planning',
    phaseId: 'planning',
    revisionNumber: 1,
    feedback: 'Please add more error handling',
    attachments: [],
    beforeArtifacts: ['spec/plan.md'],
    afterArtifacts: ['spec/plan.md'],
    status: 'completed',
    requestedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('RevisionHistory', () => {
  const defaultProps = {
    revisionHistory: [createTestRevision()],
    onViewArtifact: vi.fn(),
    defaultCollapsed: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders nothing when revision history is empty', () => {
      const { container } = render(<RevisionHistory {...defaultProps} revisionHistory={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when revision history is undefined', () => {
      const { container } = render(
        <RevisionHistory {...defaultProps} revisionHistory={undefined as unknown as RevisionEntry[]} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders revision history title', () => {
      render(<RevisionHistory {...defaultProps} />);
      expect(screen.getByText('Revision History')).toBeInTheDocument();
    });

    it('renders revision count badge', () => {
      render(<RevisionHistory {...defaultProps} />);
      expect(screen.getByText('(1)')).toBeInTheDocument();
    });

    it('renders multiple revisions with count', () => {
      const revisions = [
        createTestRevision({ revisionNumber: 1 }),
        createTestRevision({ revisionNumber: 2, id: 'revision-2' }),
      ];
      render(<RevisionHistory {...defaultProps} revisionHistory={revisions} />);
      expect(screen.getByText('(2)')).toBeInTheDocument();
    });
  });

  describe('revision entry display', () => {
    it('renders revision number badge', () => {
      render(<RevisionHistory {...defaultProps} />);
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('renders completed status', () => {
      render(<RevisionHistory {...defaultProps} />);
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('renders pending status', () => {
      const revision = createTestRevision({ status: 'pending', completedAt: undefined });
      render(<RevisionHistory {...defaultProps} revisionHistory={[revision]} />);
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('renders in_progress status with spinner', () => {
      const revision = createTestRevision({ status: 'in_progress', completedAt: undefined });
      render(<RevisionHistory {...defaultProps} revisionHistory={[revision]} />);
      expect(screen.getByText('In Progress')).toBeInTheDocument();
    });

    it('renders failed status', () => {
      const revision = createTestRevision({ status: 'failed', error: 'Something went wrong' });
      render(<RevisionHistory {...defaultProps} revisionHistory={[revision]} />);
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });
  });

  describe('expanded content', () => {
    it('shows feedback when revision is expanded', () => {
      render(<RevisionHistory {...defaultProps} />);
      expect(screen.getByText('Please add more error handling')).toBeInTheDocument();
    });

    it('shows before artifacts', () => {
      render(<RevisionHistory {...defaultProps} />);
      expect(screen.getByText('Before')).toBeInTheDocument();
      // plan.md appears in both before and after, so use getAllByText
      expect(screen.getAllByText('plan.md').length).toBeGreaterThanOrEqual(1);
    });

    it('shows after artifacts', () => {
      render(<RevisionHistory {...defaultProps} />);
      expect(screen.getByText('After')).toBeInTheDocument();
    });

    it('shows "No artifacts" when before artifacts is empty', () => {
      const revision = createTestRevision({ beforeArtifacts: [] });
      render(<RevisionHistory {...defaultProps} revisionHistory={[revision]} />);
      // Should have at least one "No artifacts" for the empty before list
      expect(screen.getAllByText('No artifacts').length).toBeGreaterThan(0);
    });

    it('shows error message when revision failed', () => {
      const revision = createTestRevision({ status: 'failed', error: 'Test error message' });
      render(<RevisionHistory {...defaultProps} revisionHistory={[revision]} />);
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('Test error message')).toBeInTheDocument();
    });
  });

  describe('collapsibility', () => {
    it('renders collapsed by default when defaultCollapsed is true', () => {
      render(<RevisionHistory {...defaultProps} defaultCollapsed={true} />);
      // The revision content should not be visible
      expect(screen.queryByText('Please add more error handling')).not.toBeInTheDocument();
    });

    it('can toggle collapsed state', () => {
      render(<RevisionHistory {...defaultProps} defaultCollapsed={true} />);

      // Click to expand
      fireEvent.click(screen.getByText('Revision History'));
      expect(screen.getByText('Please add more error handling')).toBeInTheDocument();

      // Click to collapse
      fireEvent.click(screen.getByText('Revision History'));
      expect(screen.queryByText('Please add more error handling')).not.toBeInTheDocument();
    });
  });

  describe('artifact interaction', () => {
    it('calls onViewArtifact when clicking an artifact', () => {
      const onViewArtifact = vi.fn();
      // Use different artifacts for before and after to avoid duplicate text
      const revision = createTestRevision({
        beforeArtifacts: ['spec/original-plan.md'],
        afterArtifacts: ['spec/revised-plan.md'],
      });
      render(<RevisionHistory {...defaultProps} revisionHistory={[revision]} onViewArtifact={onViewArtifact} />);

      // Click the before artifact button
      fireEvent.click(screen.getByText('original-plan.md'));

      expect(onViewArtifact).toHaveBeenCalledWith('spec/original-plan.md');
    });
  });

  describe('sorting', () => {
    it('sorts revisions by revision number descending', () => {
      const revisions = [
        createTestRevision({ revisionNumber: 1, id: 'rev-1', feedback: 'First revision' }),
        createTestRevision({ revisionNumber: 3, id: 'rev-3', feedback: 'Third revision' }),
        createTestRevision({ revisionNumber: 2, id: 'rev-2', feedback: 'Second revision' }),
      ];
      render(<RevisionHistory {...defaultProps} revisionHistory={revisions} />);

      const badges = screen.getAllByText(/^[123]$/);
      // Should be sorted: 3, 2, 1
      expect(badges[0]).toHaveTextContent('3');
      expect(badges[1]).toHaveTextContent('2');
      expect(badges[2]).toHaveTextContent('1');
    });
  });
});
