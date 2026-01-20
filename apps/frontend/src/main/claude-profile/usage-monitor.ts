/**
 * Usage Monitor - Proactive usage monitoring and account switching
 *
 * Monitors Claude account usage at configured intervals and automatically
 * switches to alternative accounts before hitting rate limits.
 *
 * Uses hybrid approach:
 * 1. Primary: Direct OAuth API (https://api.anthropic.com/api/oauth/usage)
 * 2. Fallback: CLI /usage command parsing
 */

import { EventEmitter } from 'events';
import { getClaudeProfileManager } from '../claude-profile-manager';
import { ClaudeUsageSnapshot } from '../../shared/types/agent';

export class UsageMonitor extends EventEmitter {
  private static instance: UsageMonitor;
  private intervalId: NodeJS.Timeout | null = null;
  private currentUsage: ClaudeUsageSnapshot | null = null;
  private isChecking = false;

  // Swap loop protection: track profiles that recently failed auth
  private authFailedProfiles: Map<string, number> = new Map(); // profileId -> timestamp
  private static AUTH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown

  // Debug flag for verbose logging
  private readonly isDebug = process.env.DEBUG === 'true';

  private constructor() {
    super();
    console.warn('[UsageMonitor] Initialized');
  }

  static getInstance(): UsageMonitor {
    if (!UsageMonitor.instance) {
      UsageMonitor.instance = new UsageMonitor();
    }
    return UsageMonitor.instance;
  }

  /**
   * Start monitoring usage at configured interval
   * Always polls for usage data (for UI), but only performs proactive swaps when enabled
   */
  start(): void {
    if (this.intervalId) {
      console.warn('[UsageMonitor] Already running');
      return;
    }

    const profileManager = getClaudeProfileManager();
    const settings = profileManager.getAutoSwitchSettings();
    const interval = settings.usageCheckInterval || 30000;

    const proactiveSwapEnabled = settings.enabled && settings.proactiveSwapEnabled;
    console.warn('[UsageMonitor] Starting with interval:', interval, 'ms, proactiveSwap:', proactiveSwapEnabled);

    // Check immediately
    this.checkUsageAndSwap();

    // Then check periodically
    this.intervalId = setInterval(() => {
      this.checkUsageAndSwap();
    }, interval);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.warn('[UsageMonitor] Stopped');
    }
  }

  /**
   * Get current usage snapshot (for UI indicator)
   */
  getCurrentUsage(): ClaudeUsageSnapshot | null {
    return this.currentUsage;
  }

  /**
   * Check usage and trigger swap if thresholds exceeded
   */
  private async checkUsageAndSwap(): Promise<void> {
    if (this.isChecking) {
      return; // Prevent concurrent checks
    }

    this.isChecking = true;

    try {
      const profileManager = getClaudeProfileManager();
      const activeProfile = profileManager.getActiveProfile();

      if (!activeProfile) {
        console.warn('[UsageMonitor] No active profile');
        return;
      }

      // Fetch current usage (hybrid approach)
      // Get decrypted token from ProfileManager (activeProfile.oauthToken is encrypted)
      const decryptedToken = profileManager.getProfileToken(activeProfile.id);
      const usage = await this.fetchUsage(activeProfile.id, decryptedToken ?? undefined);
      if (!usage) {
        console.warn('[UsageMonitor] Failed to fetch usage');
        return;
      }

      this.currentUsage = usage;

      // Emit usage update for UI
      this.emit('usage-updated', usage);

      // Check thresholds
      const settings = profileManager.getAutoSwitchSettings();
      const sessionExceeded = usage.sessionPercent >= settings.sessionThreshold;
      const weeklyExceeded = usage.weeklyPercent >= settings.weeklyThreshold;

      if (sessionExceeded || weeklyExceeded) {
        if (this.isDebug) {
          console.warn('[UsageMonitor:TRACE] Threshold exceeded', {
            sessionPercent: usage.sessionPercent,
            weekPercent: usage.weeklyPercent,
            activeProfile: activeProfile.id,
            hasToken: !!decryptedToken
          });
        }

        console.warn('[UsageMonitor] Threshold exceeded:', {
          sessionPercent: usage.sessionPercent,
          sessionThreshold: settings.sessionThreshold,
          weeklyPercent: usage.weeklyPercent,
          weeklyThreshold: settings.weeklyThreshold
        });

        // Attempt proactive swap
        await this.performProactiveSwap(
          activeProfile.id,
          sessionExceeded ? 'session' : 'weekly'
        );
      } else {
        if (this.isDebug) {
          console.warn('[UsageMonitor:TRACE] Usage OK', {
            sessionPercent: usage.sessionPercent,
            weekPercent: usage.weeklyPercent
          });
        }
      }
    } catch (error) {
      console.error('[UsageMonitor] Check failed:', error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Fetch usage - CLI-based approach using local stats cache
   */
  private async fetchUsage(
    profileId: string,
    _oauthToken?: string
  ): Promise<ClaudeUsageSnapshot | null> {
    const profileManager = getClaudeProfileManager();
    const profile = profileManager.getProfile(profileId);
    if (!profile) {
      return null;
    }

    // Use CLI/stats-cache based method
    return await this.fetchUsageViaCLI(profileId, profile.name);
  }

  /**
   * Fetch usage from Claude's local stats cache
   * Uses ~/.claude/stats-cache.json to estimate current usage
   */
  private async fetchUsageViaCLI(
    profileId: string,
    profileName: string
  ): Promise<ClaudeUsageSnapshot | null> {
    // Read usage from Claude's local stats cache

    try {
      const fs = await import('fs').then(m => m.promises);
      const path = await import('path');
      const os = await import('os');

      const statsCachePath = path.join(os.homedir(), '.claude', 'stats-cache.json');
      const statsContent = await fs.readFile(statsCachePath, 'utf-8').catch(() => '{}');
      const stats = JSON.parse(statsContent);

      // Calculate rough session usage from today's tokens
      const today = new Date().toISOString().split('T')[0];
      const todayTokens = stats.dailyModelTokens?.find((d: { date: string }) => d.date === today);

      let sessionTokens = 0;
      if (todayTokens?.tokensByModel) {
        sessionTokens = Object.values(todayTokens.tokensByModel as Record<string, number>)
          .reduce((sum: number, v: number) => sum + v, 0);
      }

      // Rough estimate: 5-hour session limit ~2M tokens, weekly ~10M
      const sessionLimit = 2_000_000;
      const weeklyLimit = 10_000_000;

      // Get last 7 days of tokens
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      let weeklyTokens = 0;
      for (const day of (stats.dailyModelTokens || [])) {
        if (day.date >= sevenDaysAgo && day.tokensByModel) {
          weeklyTokens += Object.values(day.tokensByModel as Record<string, number>)
            .reduce((sum: number, v: number) => sum + v, 0);
        }
      }

      const sessionPercent = Math.min(100, Math.round((sessionTokens / sessionLimit) * 100));
      const weeklyPercent = Math.min(100, Math.round((weeklyTokens / weeklyLimit) * 100));

      // Calculate reset times
      const now = new Date();
      const fiveHoursFromNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
      const nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() + ((7 - now.getDay() + 1) % 7 || 7));
      nextMonday.setHours(0, 0, 0, 0);

      return {
        sessionPercent,
        weeklyPercent,
        sessionResetTime: this.formatResetTime(fiveHoursFromNow.toISOString()),
        weeklyResetTime: this.formatResetTime(nextMonday.toISOString()),
        profileId,
        profileName,
        fetchedAt: new Date(),
        limitType: weeklyPercent > sessionPercent ? 'weekly' : 'session'
      };
    } catch (error) {
      console.warn('[UsageMonitor] CLI fallback failed:', error);
      return null;
    }
  }

  /**
   * Format ISO timestamp to human-readable reset time
   */
  private formatResetTime(isoTimestamp?: string): string {
    if (!isoTimestamp) return 'Unknown';

    try {
      const date = new Date(isoTimestamp);
      const now = new Date();
      const diffMs = date.getTime() - now.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      if (diffHours < 24) {
        return `${diffHours}h ${diffMins}m`;
      }

      const diffDays = Math.floor(diffHours / 24);
      const remainingHours = diffHours % 24;
      return `${diffDays}d ${remainingHours}h`;
    } catch (_error) {
      return isoTimestamp;
    }
  }

  /**
   * Perform proactive profile swap
   * @param currentProfileId - The profile to switch from
   * @param limitType - The type of limit that triggered the swap
   * @param additionalExclusions - Additional profile IDs to exclude (e.g., auth-failed profiles)
   */
  private async performProactiveSwap(
    currentProfileId: string,
    limitType: 'session' | 'weekly',
    additionalExclusions: string[] = []
  ): Promise<void> {
    const profileManager = getClaudeProfileManager();

    // Get all profiles to swap to, excluding current and any additional exclusions
    const allProfiles = profileManager.getProfilesSortedByAvailability();
    const excludeIds = new Set([currentProfileId, ...additionalExclusions]);
    const eligibleProfiles = allProfiles.filter(p => !excludeIds.has(p.id));

    if (eligibleProfiles.length === 0) {
      console.warn('[UsageMonitor] No alternative profile for proactive swap (excluded:', Array.from(excludeIds), ')');
      this.emit('proactive-swap-failed', {
        reason: additionalExclusions.length > 0 ? 'all_alternatives_failed_auth' : 'no_alternative',
        currentProfile: currentProfileId,
        excludedProfiles: Array.from(excludeIds)
      });
      return;
    }

    // Use the best available from eligible profiles
    const bestProfile = eligibleProfiles[0];

    console.warn('[UsageMonitor] Proactive swap:', {
      from: currentProfileId,
      to: bestProfile.id,
      reason: limitType
    });

    // Switch profile
    profileManager.setActiveProfile(bestProfile.id);

    // Emit swap event
    this.emit('proactive-swap-completed', {
      fromProfile: { id: currentProfileId, name: profileManager.getProfile(currentProfileId)?.name },
      toProfile: { id: bestProfile.id, name: bestProfile.name },
      limitType,
      timestamp: new Date()
    });

    // Notify UI
    this.emit('show-swap-notification', {
      fromProfile: profileManager.getProfile(currentProfileId)?.name,
      toProfile: bestProfile.name,
      reason: 'proactive',
      limitType
    });

    // Note: Don't immediately check new profile - let normal interval handle it
    // This prevents cascading swaps if multiple profiles are near limits
  }
}

/**
 * Get the singleton UsageMonitor instance
 */
export function getUsageMonitor(): UsageMonitor {
  return UsageMonitor.getInstance();
}
