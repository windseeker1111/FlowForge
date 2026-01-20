import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useClaudeProfileStore } from '../stores/claude-profile-store';

/**
 * Profile usage data structure
 */
export interface ProfileUsage {
    profileId: string;
    name: string;
    isActive: boolean;
    sessionPercent: number;
    sessionResetTime: string | null;
    weeklyPercent: number;
    weeklyResetTime: string | null;
    weeklyAllModelsPercent?: number;
    weeklySonnetPercent?: number;
    extraUsageEnabled?: boolean;
    extraUsageSpent?: number;
    extraUsagePercent?: number;
    extraUsageResetTime?: string | null;
    lastUpdated: Date | null;
    error?: string;
}

/**
 * Claude Usage Context value
 */
interface ClaudeUsageContextValue {
    profiles: ProfileUsage[];
    loading: boolean;
    lastUpdated: Date | null;
    refreshUsage: () => Promise<void>;
    refreshInterval: number;
}

const ClaudeUsageContext = createContext<ClaudeUsageContextValue | null>(null);

/**
 * Hook to access Claude usage data
 */
export function useClaudeUsage() {
    const context = useContext(ClaudeUsageContext);
    if (!context) {
        throw new Error('useClaudeUsage must be used within a ClaudeUsageProvider');
    }
    return context;
}

/**
 * Default refresh interval: 30 seconds
 */
const DEFAULT_REFRESH_INTERVAL = 30000;

interface ClaudeUsageProviderProps {
    children: ReactNode;
    refreshInterval?: number;
}

/**
 * Provider component for Claude usage data
 * Polls all Claude profiles for usage data
 */
export function ClaudeUsageProvider({
    children,
    refreshInterval = DEFAULT_REFRESH_INTERVAL
}: ClaudeUsageProviderProps) {
    const claudeProfiles = useClaudeProfileStore((state) => state.profiles);
    const activeProfileId = useClaudeProfileStore((state) => state.activeProfileId);

    const [profileUsages, setProfileUsages] = useState<ProfileUsage[]>([]);
    const [loading, setLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    /**
     * Fetch usage data for all profiles
     */
    const refreshUsage = useCallback(async () => {
        if (claudeProfiles.length === 0) {
            setProfileUsages([]);
            return;
        }

        setLoading(true);

        try {
            // Listen for usage updates from the usage monitor
            const usages: ProfileUsage[] = [];

            for (const profile of claudeProfiles) {
                try {
                    // Get cached usage data from the usage monitor
                    const usageData = await window.electronAPI?.getProfileUsage?.(profile.id);

                    if (usageData) {
                        usages.push({
                            profileId: profile.id,
                            name: profile.name,
                            isActive: profile.id === activeProfileId,
                            sessionPercent: usageData.sessionPercent ?? 0,
                            sessionResetTime: usageData.sessionResetTime ?? null,
                            weeklyPercent: usageData.weeklyPercent ?? 0,
                            weeklyResetTime: usageData.weeklyResetTime ?? null,
                            weeklyAllModelsPercent: usageData.weeklyAllModelsPercent,
                            weeklySonnetPercent: usageData.weeklySonnetPercent,
                            extraUsageEnabled: usageData.extraUsageEnabled,
                            extraUsageSpent: usageData.extraUsageSpent,
                            extraUsagePercent: usageData.extraUsagePercent,
                            extraUsageResetTime: usageData.extraUsageResetTime,
                            lastUpdated: usageData.lastUpdated ? new Date(usageData.lastUpdated) : null,
                            error: undefined
                        });
                    } else {
                        // Profile exists but no usage data yet
                        usages.push({
                            profileId: profile.id,
                            name: profile.name,
                            isActive: profile.id === activeProfileId,
                            sessionPercent: 0,
                            sessionResetTime: null,
                            weeklyPercent: 0,
                            weeklyResetTime: null,
                            lastUpdated: null,
                            error: undefined
                        });
                    }
                } catch (err) {
                    // Individual profile fetch failure
                    usages.push({
                        profileId: profile.id,
                        name: profile.name,
                        isActive: profile.id === activeProfileId,
                        sessionPercent: 0,
                        sessionResetTime: null,
                        weeklyPercent: 0,
                        weeklyResetTime: null,
                        lastUpdated: null,
                        error: err instanceof Error ? err.message : 'Failed to fetch usage'
                    });
                }
            }

            setProfileUsages(usages);
            setLastUpdated(new Date());
        } catch (err) {
            console.error('[ClaudeUsageContext] Failed to refresh usage:', err);
        } finally {
            setLoading(false);
        }
    }, [claudeProfiles, activeProfileId]);

    // Initial load and periodic refresh
    useEffect(() => {
        refreshUsage();

        const intervalId = setInterval(refreshUsage, refreshInterval);
        return () => clearInterval(intervalId);
    }, [refreshUsage, refreshInterval]);

    // Listen for usage updates from the main process
    useEffect(() => {
        const cleanup = window.electronAPI?.onUsageUpdated?.((data) => {
            // Update the matching profile's usage data
            setProfileUsages((prev) =>
                prev.map((p) =>
                    p.profileId === data.profileId
                        ? {
                            ...p,
                            sessionPercent: data.sessionPercent ?? p.sessionPercent,
                            sessionResetTime: data.sessionResetTime ?? p.sessionResetTime,
                            weeklyPercent: data.weeklyPercent ?? p.weeklyPercent,
                            weeklyResetTime: data.weeklyResetTime ?? p.weeklyResetTime,
                            weeklyAllModelsPercent: data.weeklyAllModelsPercent ?? p.weeklyAllModelsPercent,
                            weeklySonnetPercent: data.weeklySonnetPercent ?? p.weeklySonnetPercent,
                            extraUsageEnabled: data.extraUsageEnabled ?? p.extraUsageEnabled,
                            extraUsageSpent: data.extraUsageSpent ?? p.extraUsageSpent,
                            extraUsagePercent: data.extraUsagePercent ?? p.extraUsagePercent,
                            extraUsageResetTime: data.extraUsageResetTime ?? p.extraUsageResetTime,
                            lastUpdated: new Date(),
                            error: undefined
                        }
                        : p
                )
            );
            setLastUpdated(new Date());
        });

        return () => {
            cleanup?.();
        };
    }, []);

    const value: ClaudeUsageContextValue = {
        profiles: profileUsages,
        loading,
        lastUpdated,
        refreshUsage,
        refreshInterval
    };

    return (
        <ClaudeUsageContext.Provider value={value}>
            {children}
        </ClaudeUsageContext.Provider>
    );
}
