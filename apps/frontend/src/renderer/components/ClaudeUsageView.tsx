import { useState, useEffect } from 'react';
import { Zap, RefreshCw, Settings, Clock, AlertCircle, Activity } from 'lucide-react';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Separator } from './ui/separator';
import { Switch } from './ui/switch';
import { cn } from '../lib/utils';
import { useClaudeUsage, type ProfileUsage } from '../contexts/ClaudeUsageContext';

/**
 * Get progress bar color based on usage percentage
 */
function getUsageColor(percent: number): string {
    if (percent >= 80) return 'bg-red-500';
    if (percent >= 50) return 'bg-yellow-500';
    return 'bg-emerald-500';
}

/**
 * Get text color class based on usage percentage
 */
function getUsageTextColor(percent: number): string {
    if (percent >= 80) return 'text-red-500';
    if (percent >= 50) return 'text-yellow-500';
    return 'text-emerald-500';
}

/**
 * Format reset time for display
 */
function formatResetTime(resetTime: string | null | undefined): string {
    if (!resetTime) return 'Unknown';

    try {
        const reset = new Date(resetTime);

        // Check if date is valid - if not, the resetTime might already be a formatted string
        if (isNaN(reset.getTime())) {
            // It's not a valid ISO date - might be pre-formatted like "~3h (5:30am)"
            return resetTime;
        }

        const now = new Date();
        const diff = reset.getTime() - now.getTime();

        if (diff <= 0) return 'Resetting...';

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        // Sanity check for NaN
        if (isNaN(hours) || isNaN(minutes)) {
            return resetTime; // Return original string
        }

        if (hours > 24) {
            const days = Math.floor(hours / 24);
            const remainingHours = hours % 24;
            return `${days}d ${remainingHours}h`;
        }

        return `${hours}h ${minutes}m`;
    } catch {
        // If parsing fails, just return the original string
        return resetTime;
    }
}

/**
 * Profile usage card component
 */
function ProfileCard({ profile }: { profile: ProfileUsage }) {
    const isEstimate = profile.isEstimate === true;

    return (
        <Card className="bg-card/50 border-border">
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                    <span className="truncate">{profile.name}</span>
                    {profile.isActive && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500" title="Active Profile" />
                    )}
                </CardTitle>
                {isEstimate && (
                    <p className="text-[10px] text-amber-500/80 mt-1">
                        Estimated data • Enable Auto-Poll for accurate usage
                    </p>
                )}
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Session Usage */}
                <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Plan Usage Limits
                    </h4>
                    <Separator className="mb-3" />

                    <div className="space-y-3">
                        {/* Current Session */}
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span>Current session</span>
                                <span className={cn('font-medium', isEstimate ? 'text-muted-foreground' : getUsageTextColor(profile.sessionPercent))}>
                                    {isEstimate && '~'}{profile.sessionPercent}%
                                </span>
                            </div>
                            <Progress
                                value={profile.sessionPercent}
                                className="h-2"
                                indicatorClassName={isEstimate ? 'bg-muted-foreground/50' : getUsageColor(profile.sessionPercent)}
                            />
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                <Clock className="h-3 w-3" />
                                Resets in {formatResetTime(profile.sessionResetTime)}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Weekly Limits */}
                <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Weekly Limits
                    </h4>
                    <Separator className="mb-3" />

                    <div className="space-y-3">
                        {/* All Models */}
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span>All models</span>
                                <span className={cn('font-medium', isEstimate ? 'text-muted-foreground' : getUsageTextColor(profile.weeklyPercent))}>
                                    {isEstimate && '~'}{profile.weeklyPercent}%
                                </span>
                            </div>
                            <Progress
                                value={profile.weeklyPercent}
                                className="h-2"
                                indicatorClassName={isEstimate ? 'bg-muted-foreground/50' : getUsageColor(profile.weeklyPercent)}
                            />
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                <Clock className="h-3 w-3" />
                                Resets {formatResetTime(profile.weeklyResetTime)}
                            </div>
                        </div>

                        {/* Sonnet Only (if available) */}
                        {profile.weeklySonnetPercent !== undefined && (
                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="flex items-center gap-1">
                                        Sonnet only
                                        <span className="text-xs text-muted-foreground" title="Higher limit for Sonnet models">ⓘ</span>
                                    </span>
                                    <span className={cn('font-medium', getUsageTextColor(profile.weeklySonnetPercent))}>
                                        {profile.weeklySonnetPercent}%
                                    </span>
                                </div>
                                <Progress
                                    value={profile.weeklySonnetPercent}
                                    className="h-2"
                                    indicatorClassName={getUsageColor(profile.weeklySonnetPercent)}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Extra Usage (if enabled) */}
                {profile.extraUsageEnabled && (
                    <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
                            Extra Usage
                            <span className="text-emerald-500 text-[10px] font-normal">●</span>
                        </h4>
                        <Separator className="mb-3" />

                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span>${profile.extraUsageSpent?.toFixed(2) ?? '0.00'} spent</span>
                                <span className={cn('font-medium', getUsageTextColor(profile.extraUsagePercent ?? 0))}>
                                    {profile.extraUsagePercent ?? 0}%
                                </span>
                            </div>
                            <Progress
                                value={profile.extraUsagePercent ?? 0}
                                className="h-2"
                                indicatorClassName={getUsageColor(profile.extraUsagePercent ?? 0)}
                            />
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                <Clock className="h-3 w-3" />
                                Resets {formatResetTime(profile.extraUsageResetTime ?? null)}
                            </div>
                        </div>
                    </div>
                )}

                {/* Last Updated */}
                <div className="pt-2 border-t border-border">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                            Last updated: {profile.lastUpdated ? format(profile.lastUpdated) : 'Never'}
                        </span>
                        <RefreshCw className="h-3 w-3 opacity-50" />
                    </div>
                </div>

                {/* Error State */}
                {profile.error && (
                    <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 p-2 rounded">
                        <AlertCircle className="h-4 w-4" />
                        {profile.error}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * Format date for "Last updated" display
 */
function format(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 5000) return 'just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;

    return date.toLocaleTimeString();
}

/**
 * Add Account placeholder card
 */
function AddAccountCard({ onClick }: { onClick: () => void }) {
    return (
        <Card
            className="bg-card/30 border-dashed border-border cursor-pointer hover:bg-card/50 transition-colors min-h-[200px] flex items-center justify-center"
            onClick={onClick}
        >
            <CardContent className="text-center py-8">
                <Zap className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                <p className="font-medium text-muted-foreground">Add Account</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                    Configure in Settings → Claude Accounts
                </p>
            </CardContent>
        </Card>
    );
}

/**
 * Claude Usage View - Full page view showing all profile usage
 */
export function ClaudeUsageView({ onSettingsClick }: { onSettingsClick?: () => void }) {
    const { profiles, loading, lastUpdated, refreshUsage } = useClaudeUsage();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [pollingEnabled, setPollingEnabled] = useState(false);
    const [pollingLoading, setPollingLoading] = useState(false);

    // Check polling status on mount
    useEffect(() => {
        const checkPollingStatus = async () => {
            try {
                const result = await window.electronAPI?.getUsagePollingStatus?.();
                if (result.success && result.data) {
                    setPollingEnabled(result.data.isRunning);
                }
            } catch (error) {
                console.error('Failed to check polling status:', error);
            }
        };
        checkPollingStatus();
    }, []);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await refreshUsage();
        } finally {
            setTimeout(() => setIsRefreshing(false), 500);
        }
    };

    const handlePollingToggle = async (enabled: boolean) => {
        setPollingLoading(true);
        try {
            if (enabled) {
                const result = await window.electronAPI?.startUsagePolling?.();
                if (result.success) {
                    setPollingEnabled(true);
                }
            } else {
                const result = await window.electronAPI?.stopUsagePolling?.();
                if (result.success) {
                    setPollingEnabled(false);
                }
            }
        } catch (error) {
            console.error('Failed to toggle polling:', error);
        } finally {
            setPollingLoading(false);
        }
    };

    const handleAddAccount = () => {
        onSettingsClick?.();
    };

    const accountCount = profiles.length;

    return (
        <div className="flex flex-col h-full p-6 overflow-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Zap className="h-6 w-6 text-primary" />
                        Claude Usage
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Real-time subscription tracking for your Claude accounts
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    {/* Background Polling Toggle */}
                    <div className="flex items-center gap-2">
                        <Activity className={cn(
                            "h-4 w-4",
                            pollingEnabled ? "text-emerald-500" : "text-muted-foreground"
                        )} />
                        <span className="text-sm text-muted-foreground">Auto-Poll</span>
                        <Switch
                            checked={pollingEnabled}
                            onCheckedChange={handlePollingToggle}
                            disabled={pollingLoading}
                        />
                        {pollingEnabled && (
                            <span className="text-xs text-emerald-500 ml-1">●</span>
                        )}
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefresh}
                        disabled={isRefreshing || loading}
                    >
                        <RefreshCw className={cn('h-4 w-4 mr-2', (isRefreshing || loading) && 'animate-spin')} />
                        Sync
                    </Button>
                </div>
            </div>

            {/* Profile Cards Grid */}
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 flex-1">
                {profiles.map((profile) => (
                    <ProfileCard key={profile.profileId} profile={profile} />
                ))}

                {/* Always show Add Account card */}
                <AddAccountCard onClick={handleAddAccount} />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-6 pt-4 border-t border-border">
                <span>
                    Last updated: {lastUpdated ? format(lastUpdated) : 'Never'}
                </span>
                <span>
                    {accountCount} account{accountCount !== 1 ? 's' : ''} configured
                </span>
            </div>
        </div>
    );
}
