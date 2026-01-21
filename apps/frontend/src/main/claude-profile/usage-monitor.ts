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

      // Check thresholds - but only trigger proactive swap if we have accurate data
      // Estimated data from stats-cache is not reliable enough for swap decisions
      const settings = profileManager.getAutoSwitchSettings();

      if (usage.isEstimate) {
        // Don't trigger proactive swaps based on estimated data
        if (this.isDebug) {
          console.warn('[UsageMonitor:TRACE] Using estimated usage - skipping proactive swap check', {
            sessionPercent: usage.sessionPercent,
            weeklyPercent: usage.weeklyPercent,
            isEstimate: true
          });
        }
        return;
      }

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
   * Fetch usage - reads from local stats cache for estimated usage
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

    // Use stats-cache based method for estimated usage
    return await this.fetchUsageFromStatsCache(profileId, profile.name);
  }

  /**
   * Fetch usage by reading from local stats-cache.json
   * This provides estimated usage based on session activity.
   * Note: Actual rate limit percentages are only available via the interactive CLI /usage command.
   */
  private async fetchUsageFromStatsCache(
    profileId: string,
    profileName: string
  ): Promise<ClaudeUsageSnapshot | null> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');

      const statsCachePath = path.join(os.homedir(), '.claude', 'stats-cache.json');

      let statsData: {
        dailyActivity?: Array<{ date: string; messageCount: number; sessionCount: number; toolCallCount: number }>;
        dailyModelTokens?: Array<{ date: string; tokensByModel: Record<string, number> }>;
        modelUsage?: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>;
        totalSessions?: number;
        totalMessages?: number;
      };

      try {
        const content = await fs.readFile(statsCachePath, 'utf-8');
        statsData = JSON.parse(content);
      } catch (readError) {
        console.warn('[UsageMonitor] Could not read stats-cache.json:', readError);
        return this.createDefaultUsageSnapshot(profileId, profileName);
      }

      // Get today's date and calculate the week start (last Monday)
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      // Calculate the date 7 days ago
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = weekAgo.toISOString().split('T')[0];

      // Sum up activity for the last 7 days for weekly usage
      const weeklyActivity = (statsData.dailyActivity || [])
        .filter(d => d.date >= weekAgoStr && d.date <= todayStr);

      const weeklyTokens = (statsData.dailyModelTokens || [])
        .filter(d => d.date >= weekAgoStr && d.date <= todayStr);

      // Get today's activity for session estimate (or most recent day if no today)
      const todayActivity = statsData.dailyActivity?.find(d => d.date === todayStr);
      const mostRecentActivity = todayActivity ||
        (statsData.dailyActivity?.length ? statsData.dailyActivity[statsData.dailyActivity.length - 1] : null);

      // Calculate estimated session usage based on message count
      // Claude Pro typically allows ~45 messages per 5-hour session window
      // This is a rough estimate - actual limits vary
      const messagesUsedRecent = mostRecentActivity?.messageCount || 0;
      const sessionEstimatedLimit = 45;
      const sessionPercent = Math.min(100, Math.round((messagesUsedRecent / sessionEstimatedLimit) * 100));

      // Calculate weekly token total
      const totalWeeklyTokens = weeklyTokens.reduce((sum, day) => {
        const dayTotal = day.tokensByModel
          ? Object.values(day.tokensByModel).reduce((s, t) => s + t, 0)
          : 0;
        return sum + dayTotal;
      }, 0);

      // Calculate weekly message total 
      const totalWeeklyMessages = weeklyActivity.reduce((sum, d) => sum + (d.messageCount || 0), 0);

      // Rough estimate: assume 50M tokens per week limit for Max plan (Pro is ~5M)
      // This is just for display purposes - actual limits vary by plan and aren't publicly documented
      const weeklyTokenLimit = 50_000_000;
      const weeklyPercent = Math.min(100, Math.round((totalWeeklyTokens / weeklyTokenLimit) * 100));

      // Calculate reset times
      const now = new Date();
      const sessionResetTime = this.calculateSessionResetTime(now);
      const weeklyResetTime = this.calculateWeeklyResetTime(now);

      console.warn('[UsageMonitor] Estimated usage from stats-cache:', {
        messagesUsedRecent,
        sessionPercent,
        totalWeeklyTokens,
        totalWeeklyMessages,
        weeklyPercent,
        dataFromDate: mostRecentActivity?.date || 'none',
        isEstimate: true
      });

      return {
        sessionPercent,
        weeklyPercent,
        sessionResetTime,
        weeklyResetTime,
        weeklyAllModelsPercent: weeklyPercent,
        weeklySonnetPercent: undefined,
        extraUsageEnabled: false,
        extraUsageSpent: undefined,
        extraUsagePercent: undefined,
        extraUsageResetTime: undefined,
        profileId,
        profileName,
        fetchedAt: new Date(),
        limitType: weeklyPercent > sessionPercent ? 'weekly' : 'session',
        isEstimate: true // Flag to indicate this is an estimate
      };
    } catch (error) {
      console.warn('[UsageMonitor] Stats cache read failed:', error);
      return this.createDefaultUsageSnapshot(profileId, profileName);
    }
  }

  /**
   * Create a default usage snapshot when we can't fetch real data
   */
  private createDefaultUsageSnapshot(
    profileId: string,
    profileName: string
  ): ClaudeUsageSnapshot {
    return {
      sessionPercent: 0,
      weeklyPercent: 0,
      sessionResetTime: 'Unknown',
      weeklyResetTime: 'Unknown',
      weeklyAllModelsPercent: 0,
      weeklySonnetPercent: undefined,
      extraUsageEnabled: false,
      extraUsageSpent: undefined,
      extraUsagePercent: undefined,
      extraUsageResetTime: undefined,
      profileId,
      profileName,
      fetchedAt: new Date(),
      limitType: 'session',
      isEstimate: true
    };
  }

  /**
   * Calculate session reset time (sessions reset every 5 hours from first message)
   */
  private calculateSessionResetTime(now: Date): string {
    // Session windows are typically 5 hours
    // We don't know exactly when the session started, so estimate based on current hour
    const hoursIntoWindow = now.getHours() % 5;
    const hoursRemaining = 5 - hoursIntoWindow;
    const resetTime = new Date(now.getTime() + hoursRemaining * 60 * 60 * 1000);
    return `~${hoursRemaining}h (${resetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
  }

  /**
   * Calculate weekly reset time (typically Monday midnight UTC)
   */
  private calculateWeeklyResetTime(now: Date): string {
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    nextMonday.setHours(0, 0, 0, 0);
    return `${daysUntilMonday}d (${nextMonday.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })})`;
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
