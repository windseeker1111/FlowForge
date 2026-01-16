/**
 * RevisionHistory component for displaying checkpoint revision history.
 *
 * Shows all revision entries for a checkpoint, including before/after state,
 * feedback, timestamps, and revision status.
 *
 * Story Reference: Story 5.5 - Implement Checkpoint Revision Flow
 * Task 7: Build revision history viewer
 */

import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  GitCompareArrows,
  History,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

import type { RevisionHistoryProps, RevisionEntry, FeedbackAttachment } from './types';

/**
 * Format a date string to a human-readable format.
 *
 * Uses `'default'` locale which respects the browser/system locale preferences,
 * ensuring dates are displayed in the user's preferred format.
 *
 * @param dateString - ISO 8601 date string to format
 * @returns Formatted date string (e.g., "Jan 16, 2026, 1:05 PM" for en-US)
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('default', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Get icon and color for revision status.
 */
function getStatusInfo(status: RevisionEntry['status']) {
  switch (status) {
    case 'pending':
      return {
        Icon: AlertCircle,
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-500/10',
      };
    case 'in_progress':
      return {
        Icon: Loader2,
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/10',
        animate: true,
      };
    case 'completed':
      return {
        Icon: CheckCircle2,
        color: 'text-green-500',
        bgColor: 'bg-green-500/10',
      };
    case 'failed':
      return {
        Icon: XCircle,
        color: 'text-red-500',
        bgColor: 'bg-red-500/10',
      };
    default:
      return {
        Icon: AlertCircle,
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
      };
  }
}

/**
 * Internal component for displaying a list of artifact paths.
 *
 * Shows artifact file names as clickable buttons with truncated display.
 * Full path is shown in tooltip on hover. Displays "No artifacts" message
 * when list is empty.
 *
 * @param artifacts - Array of file paths to display
 * @param label - Section label (e.g., "Before", "After")
 * @param onViewArtifact - Optional callback when user clicks an artifact
 */
function ArtifactList({
  artifacts,
  label,
  onViewArtifact,
}: {
  artifacts: string[];
  label: string;
  onViewArtifact?: (path: string) => void;
}) {
  const { t } = useTranslation(['checkpoints']);

  if (!artifacts || artifacts.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        {t('checkpoints:revision.noArtifacts')}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <div className="flex flex-wrap gap-1">
        {artifacts.map((path, idx) => (
          <button
            key={`${path}-${idx}`}
            onClick={() => onViewArtifact?.(path)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs',
              'bg-muted/50 hover:bg-muted transition-colors',
              'max-w-full truncate'
            )}
            title={path}
          >
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate">{path.split('/').pop()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Internal component for displaying a single revision entry.
 *
 * Renders a collapsible card showing:
 * - Revision number badge
 * - Status indicator (pending/in_progress/completed/failed)
 * - Request timestamp
 * - When expanded:
 *   - User's revision feedback
 *   - Before/after artifact comparison
 *   - Error message (if failed)
 *   - Completion timestamp
 *
 * @param entry - The revision entry data to display
 * @param onViewArtifact - Optional callback when user clicks an artifact path
 * @param defaultExpanded - Whether the entry is expanded by default (default: false)
 */
function RevisionEntryDisplay({
  entry,
  onViewArtifact,
  defaultExpanded = false,
}: {
  entry: RevisionEntry;
  onViewArtifact?: (path: string) => void;
  defaultExpanded?: boolean;
}) {
  const { t } = useTranslation(['checkpoints']);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const statusInfo = getStatusInfo(entry.status);
  const StatusIcon = statusInfo.Icon;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full p-3 flex items-center justify-between',
          'hover:bg-muted/30 transition-colors',
          'text-left'
        )}
      >
        <div className="flex items-center gap-3">
          {/* Revision number badge */}
          <div
            className={cn(
              'flex items-center justify-center',
              'w-6 h-6 rounded-full text-xs font-medium',
              'bg-primary/10 text-primary'
            )}
          >
            {entry.revisionNumber}
          </div>

          {/* Status indicator */}
          <div
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded text-xs',
              statusInfo.bgColor,
              statusInfo.color
            )}
          >
            <StatusIcon
              className={cn('h-3 w-3', statusInfo.animate && 'animate-spin')}
            />
            <span>{t(`checkpoints:revision.status.${entry.status}`)}</span>
          </div>

          {/* Timestamp */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{formatDate(entry.requestedAt)}</span>
          </div>
        </div>

        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Content - expanded */}
      {expanded && (
        <div className="px-3 pb-3 space-y-4 border-t border-border/50">
          {/* Feedback */}
          <div className="pt-3">
            <p className="text-xs text-muted-foreground font-medium mb-1">
              {t('checkpoints:revision.feedback')}
            </p>
            <p className="text-sm whitespace-pre-wrap bg-muted/30 p-2 rounded">
              {entry.feedback}
            </p>
          </div>

          {/* Before/After artifacts comparison */}
          <div className="grid grid-cols-2 gap-3">
            <ArtifactList
              artifacts={entry.beforeArtifacts}
              label={t('checkpoints:revision.beforeArtifacts')}
              onViewArtifact={onViewArtifact}
            />
            <ArtifactList
              artifacts={entry.afterArtifacts}
              label={t('checkpoints:revision.afterArtifacts')}
              onViewArtifact={onViewArtifact}
            />
          </div>

          {/* Error message if failed */}
          {entry.status === 'failed' && entry.error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded p-2">
              <p className="text-xs text-red-500 font-medium">
                {t('checkpoints:revision.error')}
              </p>
              <p className="text-sm text-red-400 mt-1">{entry.error}</p>
            </div>
          )}

          {/* Completion time if completed */}
          {entry.completedAt && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>
                {t('checkpoints:revision.completedAt', {
                  time: formatDate(entry.completedAt),
                })}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * RevisionHistory component.
 *
 * Displays the history of revisions requested at a checkpoint.
 * Shows before/after artifact comparison and revision status.
 */
export function RevisionHistory({
  revisionHistory,
  onViewArtifact,
  defaultCollapsed = true,
}: RevisionHistoryProps) {
  const { t } = useTranslation(['checkpoints']);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (!revisionHistory || revisionHistory.length === 0) {
    return null;
  }

  // Sort by revision number (most recent first)
  const sortedHistory = [...revisionHistory].sort(
    (a, b) => b.revisionNumber - a.revisionNumber
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={cn(
          'flex items-center justify-between w-full',
          'hover:opacity-80 transition-opacity'
        )}
      >
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">
            {t('checkpoints:revision.historyTitle')}
          </h4>
          <span className="text-xs text-muted-foreground">
            ({revisionHistory.length})
          </span>
        </div>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="space-y-2">
          {sortedHistory.map((entry, index) => (
            <RevisionEntryDisplay
              key={entry.id}
              entry={entry}
              onViewArtifact={onViewArtifact}
              defaultExpanded={index === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default RevisionHistory;
