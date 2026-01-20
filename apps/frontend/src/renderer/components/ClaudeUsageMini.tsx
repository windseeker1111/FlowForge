import { Zap, ChevronRight } from 'lucide-react';
import { Progress } from './ui/progress';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';
import { useClaudeUsage } from '../contexts/ClaudeUsageContext';

/**
 * Get progress bar color based on usage percentage
 */
function getUsageColor(percent: number): string {
    if (percent >= 80) return 'bg-red-500';
    if (percent >= 50) return 'bg-yellow-500';
    return 'bg-emerald-500';
}

/**
 * Format reset time for compact display
 */
function formatResetTimeCompact(resetTime: string | null): string {
    if (!resetTime) return '--';

    try {
        const reset = new Date(resetTime);
        const now = new Date();
        const diff = reset.getTime() - now.getTime();

        if (diff <= 0) return 'now';

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return `${days}d`;
        }

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }

        return `${minutes}m`;
    } catch {
        return '--';
    }
}

interface ClaudeUsageMiniProps {
    onViewDetails: () => void;
}

/**
 * Compact Claude usage widget for the sidebar
 * Shows session usage for each profile with progress bars
 * Always visible per PRD specification
 */
export function ClaudeUsageMini({ onViewDetails }: ClaudeUsageMiniProps) {
    const { profiles, loading } = useClaudeUsage();

    return (
        <div className="px-3 py-3">
            {/* Section Header */}
            <h3 className="flex items-center gap-2 px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Zap className="h-3.5 w-3.5 text-primary" />
                Claude Usage
            </h3>

            <Separator className="mb-3" />

            {/* Profile Usage Bars */}
            <div className="space-y-3 min-h-[40px]">
                {profiles.length > 0 ? (
                    profiles.map((profile) => (
                        <div key={profile.profileId} className="px-3">
                            {/* Profile Name + Active Indicator */}
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-sm truncate max-w-[140px]">{profile.name}</span>
                                {profile.isActive && (
                                    <span
                                        className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                                        title="Active Profile"
                                    />
                                )}
                            </div>

                            {/* Progress Bar */}
                            <Progress
                                value={profile.sessionPercent}
                                className="h-1.5"
                                indicatorClassName={getUsageColor(profile.sessionPercent)}
                            />

                            {/* Stats Row */}
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
                                <span>Session: {profile.sessionPercent}%</span>
                                <span className="flex items-center gap-1">
                                    ↻ {formatResetTimeCompact(profile.sessionResetTime)}
                                </span>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                        {loading ? 'Loading...' : 'No accounts configured'}
                    </div>
                )}
            </div>

            {/* View Details Link */}
            <button
                onClick={onViewDetails}
                className={cn(
                    'flex items-center justify-center gap-1 w-full mt-3 py-2',
                    'text-xs text-muted-foreground hover:text-foreground',
                    'transition-colors rounded-md hover:bg-accent',
                    'border border-dashed border-border'
                )}
            >
                <span>📊 View Details</span>
                <ChevronRight className="h-3 w-3" />
            </button>
        </div>
    );
}
