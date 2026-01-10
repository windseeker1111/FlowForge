/**
 * useAutoPRReview Hook
 *
 * React hook for managing the Auto-PR-Review feature, which autonomously
 * reviews PRs, waits for CI checks and external bot reviews, and applies
 * fixes iteratively until the PR is ready for human approval.
 *
 * CRITICAL: This system NEVER auto-merges. Human approval is always required.
 *
 * Features:
 * - Config state management (max iterations, timeouts, allowed users)
 * - Queue management for active PR reviews
 * - IPC listeners for progress updates
 * - Cancellation support with graceful cleanup
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  AutoPRReviewConfig,
  AutoPRReviewProgress,
  AutoPRReviewStartRequest,
  AutoPRReviewStartResponse,
  AutoPRReviewStopResponse,
  AutoPRReviewStatusResponse,
} from '../types';
import {
  DEFAULT_AUTO_PR_REVIEW_CONFIG,
  isTerminalStatus,
  isInProgressStatus,
} from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Hook return type for useAutoPRReview
 */
export interface UseAutoPRReviewReturn {
  /** Whether the Auto-PR-Review feature is globally enabled */
  isEnabled: boolean;

  /** Current configuration for Auto-PR-Review */
  config: AutoPRReviewConfig;

  /** List of active PR reviews being processed */
  activeReviews: AutoPRReviewProgress[];

  /** Whether the hook is currently loading initial state */
  isLoading: boolean;

  /** Error message if any operation failed */
  error: string | null;

  /** Enable or disable the Auto-PR-Review feature */
  setEnabled: (enabled: boolean) => Promise<void>;

  /** Update Auto-PR-Review configuration */
  updateConfig: (config: Partial<AutoPRReviewConfig>) => Promise<void>;

  /** Start Auto-PR-Review for a specific PR */
  startReview: (request: Omit<AutoPRReviewStartRequest, 'configOverrides'>) => Promise<AutoPRReviewStartResponse>;

  /** Cancel an active Auto-PR-Review */
  cancelReview: (repository: string, prNumber: number, reason?: string) => Promise<AutoPRReviewStopResponse>;

  /** Check if a specific PR is currently being reviewed */
  isReviewActive: (repository: string, prNumber: number) => boolean;

  /** Get progress for a specific PR review */
  getReviewProgress: (repository: string, prNumber: number) => AutoPRReviewProgress | undefined;

  /** Refresh the status of all active reviews */
  refreshStatus: () => Promise<void>;

  /** Clear any error state */
  clearError: () => void;
}

/**
 * Generate a unique key for tracking a PR review
 */
function getReviewKey(repository: string, prNumber: number): string {
  return `${repository}#${prNumber}`;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for managing Auto-PR-Review operations.
 *
 * @param options - Hook configuration options
 * @param options.pollInterval - Interval in ms to poll for status updates (default: 5000)
 * @param options.autoRefresh - Whether to automatically refresh status (default: true)
 * @returns Hook state and actions
 */
export function useAutoPRReview(options?: {
  pollInterval?: number;
  autoRefresh?: boolean;
}): UseAutoPRReviewReturn {
  const { pollInterval = 5000, autoRefresh = true } = options ?? {};

  // State
  const [isEnabled, setIsEnabledState] = useState<boolean>(false);
  const [config, setConfig] = useState<AutoPRReviewConfig>(DEFAULT_AUTO_PR_REVIEW_CONFIG);
  const [activeReviews, setActiveReviews] = useState<AutoPRReviewProgress[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Refs for tracking mounted state and intervals
  const isMountedRef = useRef<boolean>(true);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const trackedReviewsRef = useRef<Set<string>>(new Set());

  // Check if we have the API available
  const hasAPI = typeof window !== 'undefined' && window.electronAPI?.github;

  // ==========================================================================
  // Load Initial State
  // ==========================================================================

  const loadConfig = useCallback(async () => {
    if (!hasAPI) return;

    try {
      const result = await window.electronAPI.github.getAutoPRReviewConfig();

      if (isMountedRef.current && result) {
        setConfig(result.config);
        setIsEnabledState(result.enabled);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const message = err instanceof Error ? err.message : 'Failed to load config';
        setError(message);
      }
    }
  }, [hasAPI]);

  // ==========================================================================
  // Status Refresh
  // ==========================================================================

  const refreshStatus = useCallback(async () => {
    if (!hasAPI) return;

    const reviewsToCheck = Array.from(trackedReviewsRef.current);
    console.log('[useAutoPRReview] refreshStatus called, trackedReviews:', reviewsToCheck);
    if (reviewsToCheck.length === 0) return;

    const updatedReviews: AutoPRReviewProgress[] = [];
    const reviewsToRemove: string[] = [];

    for (const key of reviewsToCheck) {
      const [repository, prNumberStr] = key.split('#');
      const prNumber = parseInt(prNumberStr, 10);

      if (isNaN(prNumber)) {
        reviewsToRemove.push(key);
        continue;
      }

      try {
        const result = await window.electronAPI.github.getAutoPRReviewStatus({
          repository,
          prNumber,
        });
        console.log('[useAutoPRReview] getAutoPRReviewStatus result for', key, ':', result);

        if (result.progress) {
          console.log('[useAutoPRReview] Adding progress to updatedReviews:', result.progress.status);
          updatedReviews.push(result.progress);

          // Only stop polling if in terminal state, but keep in UI for display
          if (isTerminalStatus(result.progress.status)) {
            console.log('[useAutoPRReview] Terminal status, will stop polling but keep in UI');
            reviewsToRemove.push(key);
          }
        } else if (!result.isActive) {
          // Review is no longer active and no progress - remove from tracking
          console.log('[useAutoPRReview] Review not active and no progress, removing from tracking');
          reviewsToRemove.push(key);
        }
      } catch {
        // Don't remove on error - might be temporary network issue
        // Keep tracking and try again on next poll
      }
    }

    // Update tracked reviews - stop polling for terminal states
    for (const key of reviewsToRemove) {
      trackedReviewsRef.current.delete(key);
    }

    console.log('[useAutoPRReview] updatedReviews length:', updatedReviews.length, 'isMounted:', isMountedRef.current);
    if (isMountedRef.current) {
      // Merge with existing completed reviews to preserve them
      // Only update reviews we actually fetched, keep others as-is
      setActiveReviews(prev => {
        // Create a map of new reviews by key
        const newReviewsMap = new Map<string, AutoPRReviewProgress>();
        for (const review of updatedReviews) {
          const key = getReviewKey(review.repository, review.prNumber);
          newReviewsMap.set(key, review);
        }

        // Keep existing completed reviews that weren't re-fetched
        const merged: AutoPRReviewProgress[] = [];
        for (const existing of prev) {
          const key = getReviewKey(existing.repository, existing.prNumber);
          if (newReviewsMap.has(key)) {
            // Update with new data
            merged.push(newReviewsMap.get(key)!);
            newReviewsMap.delete(key);
          } else if (isTerminalStatus(existing.status)) {
            // Keep completed reviews that weren't re-fetched
            merged.push(existing);
          }
          // In-progress reviews that weren't re-fetched are dropped (review ended)
        }

        // Add any new reviews
        for (const review of newReviewsMap.values()) {
          merged.push(review);
        }

        console.log('[useAutoPRReview] Merged activeReviews:', merged.length);
        return merged;
      });
    } else {
      console.log('[useAutoPRReview] Component not mounted, skipping state update');
    }
  }, [hasAPI]);

  // ==========================================================================
  // Actions
  // ==========================================================================

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!hasAPI) {
      setError('API not available');
      return;
    }

    try {
      const result = await window.electronAPI.github.saveAutoPRReviewConfig({
        config: {},
        enabled,
      });

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update enabled state');
      }

      if (isMountedRef.current) {
        setIsEnabledState(enabled);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const message = err instanceof Error ? err.message : 'Failed to update enabled state';
        setError(message);
      }
    }
  }, [hasAPI]);

  const updateConfig = useCallback(async (configUpdate: Partial<AutoPRReviewConfig>) => {
    if (!hasAPI) {
      setError('API not available');
      return;
    }

    try {
      // CRITICAL: Never allow disabling human approval
      const safeUpdate = {
        ...configUpdate,
        requireHumanApproval: true as const,
      };

      const result = await window.electronAPI.github.saveAutoPRReviewConfig({
        config: safeUpdate,
      });

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update config');
      }

      if (isMountedRef.current) {
        setConfig(prev => ({
          ...prev,
          ...safeUpdate,
          requireHumanApproval: true, // Always enforce
        }));
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const message = err instanceof Error ? err.message : 'Failed to update config';
        setError(message);
      }
    }
  }, [hasAPI]);

  const startReview = useCallback(async (
    request: Omit<AutoPRReviewStartRequest, 'configOverrides'>
  ): Promise<AutoPRReviewStartResponse> => {
    if (!hasAPI) {
      return {
        success: false,
        message: 'API not available',
        error: 'IPC communication not available',
      };
    }

    try {
      const fullRequest: AutoPRReviewStartRequest = {
        ...request,
      };

      const result = await window.electronAPI.github.startAutoPRReview(fullRequest);

      // Track this review for status polling (even if "already running" - we want to show UI)
      const key = getReviewKey(request.repository, request.prNumber);
      console.log('[useAutoPRReview] Adding to tracked reviews:', key);
      trackedReviewsRef.current.add(key);
      console.log('[useAutoPRReview] trackedReviewsRef after add:', Array.from(trackedReviewsRef.current));

      // Immediately refresh to get initial state
      console.log('[useAutoPRReview] Calling refreshStatus...');
      await refreshStatus();
      console.log('[useAutoPRReview] refreshStatus completed');

      if (isMountedRef.current && result.error) {
        setError(result.error);
      } else if (isMountedRef.current) {
        setError(null);
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start review';
      if (isMountedRef.current) {
        setError(message);
      }
      return {
        success: false,
        message: 'Failed to start review',
        error: message,
      };
    }
  }, [hasAPI, refreshStatus]);

  const cancelReview = useCallback(async (
    repository: string,
    prNumber: number,
    reason?: string
  ): Promise<AutoPRReviewStopResponse> => {
    if (!hasAPI) {
      return {
        success: false,
        message: 'API not available',
        error: 'IPC communication not available',
      };
    }

    try {
      const result = await window.electronAPI.github.stopAutoPRReview({
        repository,
        prNumber,
        reason,
      });

      if (result.success) {
        // Refresh to update the cancelled state in UI
        await refreshStatus();
      }

      if (isMountedRef.current && result.error) {
        setError(result.error);
      } else if (isMountedRef.current) {
        setError(null);
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel review';
      if (isMountedRef.current) {
        setError(message);
      }
      return {
        success: false,
        message: 'Failed to cancel review',
        error: message,
      };
    }
  }, [hasAPI, refreshStatus]);

  const isReviewActive = useCallback((repository: string, prNumber: number): boolean => {
    const key = getReviewKey(repository, prNumber);
    return activeReviews.some(
      review => getReviewKey(review.repository, review.prNumber) === key &&
                isInProgressStatus(review.status)
    );
  }, [activeReviews]);

  const getReviewProgress = useCallback((
    repository: string,
    prNumber: number
  ): AutoPRReviewProgress | undefined => {
    return activeReviews.find(
      review => review.repository === repository && review.prNumber === prNumber
    );
  }, [activeReviews]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ==========================================================================
  // Effects
  // ==========================================================================

  // Load initial config
  useEffect(() => {
    // Reset mounted flag when effect runs (in case it was cleared by previous cleanup)
    isMountedRef.current = true;

    const initialize = async () => {
      setIsLoading(true);
      await loadConfig();
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    };

    initialize();

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;
    };
  }, [loadConfig]);

  // Set up status polling
  useEffect(() => {
    if (!autoRefresh || !hasAPI) return;

    // Initial refresh
    refreshStatus();

    // Set up polling interval
    pollIntervalRef.current = setInterval(() => {
      if (trackedReviewsRef.current.size > 0) {
        refreshStatus();
      }
    }, pollInterval);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [autoRefresh, pollInterval, refreshStatus, hasAPI]);

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    isEnabled,
    config,
    activeReviews,
    isLoading,
    error,
    setEnabled,
    updateConfig,
    startReview,
    cancelReview,
    isReviewActive,
    getReviewProgress,
    refreshStatus,
    clearError,
  };
}

// =============================================================================
// Exports
// =============================================================================

export type {
  AutoPRReviewConfig,
  AutoPRReviewProgress,
  AutoPRReviewStartRequest,
  AutoPRReviewStartResponse,
  AutoPRReviewStopResponse,
  AutoPRReviewStatusResponse,
};

export { DEFAULT_AUTO_PR_REVIEW_CONFIG, isTerminalStatus, isInProgressStatus };
