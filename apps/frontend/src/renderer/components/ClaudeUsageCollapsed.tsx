import { Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import { useClaudeUsage } from '../contexts/ClaudeUsageContext';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from './ui/tooltip';

/**
 * Get text color based on usage percentage
 */
function getUsageTextColor(percent: number): string {
    if (percent >= 80) return 'text-red-500';
    if (percent >= 50) return 'text-yellow-500';
    return 'text-emerald-500';
}

interface ClaudeUsageCollapsedProps {
    onViewDetails: () => void;
}

/**
 * Ultra-compact Claude usage widget for collapsed sidebar
 * Shows percentage and reset time for each profile
 */
export function ClaudeUsageCollapsed({ onViewDetails }: ClaudeUsageCollapsedProps) {
    const { profiles, loading } = useClaudeUsage();

    return (
        <div className="py-2 px-1">
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        onClick={onViewDetails}
                        className="flex flex-col items-center gap-1.5 w-full py-2 px-1 rounded-md hover:bg-accent transition-colors"
                    >
                        {/* Zap icon header */}
                        <Zap className="h-4 w-4 text-primary" />

                        {/* Usage percentages per account */}
                        {profiles.length > 0 ? (
                            <div className="flex flex-col items-center gap-1 w-full">
                                {profiles.slice(0, 2).map((profile) => (
                                    <div
                                        key={profile.profileId}
                                        className="flex flex-col items-center"
                                    >
                                        {/* Percentage */}
                                        <span className={cn(
                                            "text-[10px] font-bold leading-none",
                                            getUsageTextColor(profile.sessionPercent)
                                        )}>
                                            {profile.sessionPercent}%
                                        </span>
                                        {/* Reset time */}
                                        {profile.sessionResetTime && (
                                            <span className="text-[8px] text-muted-foreground leading-tight">
                                                {formatResetTime(profile.sessionResetTime)}
                                            </span>
                                        )}
                                    </div>
                                ))}
                                {profiles.length > 2 && (
                                    <span className="text-[8px] text-muted-foreground">
                                        +{profiles.length - 2}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <span className="text-[9px] text-muted-foreground">
                                {loading ? '...' : '—'}
                            </span>
                        )}
                    </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                    {profiles.length > 0 ? (
                        <div className="space-y-1.5">
                            <div className="font-medium text-xs">Claude Usage</div>
                            {profiles.map((profile) => (
                                <div key={profile.profileId} className="text-xs">
                                    <div className="flex justify-between gap-2">
                                        <span className="truncate">{profile.name}</span>
                                        <span className={cn("font-medium", getUsageTextColor(profile.sessionPercent))}>
                                            {profile.sessionPercent}%
                                        </span>
                                    </div>
                                    {profile.sessionResetTime && (
                                        <div className="text-muted-foreground text-[10px]">
                                            Resets in {profile.sessionResetTime}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : loading ? (
                        'Loading usage...'
                    ) : (
                        'No accounts configured'
                    )}
                </TooltipContent>
            </Tooltip>
        </div>
    );
}

/**
 * Format reset time for collapsed display (e.g., "2h 30m" -> "2h")
 */
function formatResetTime(resetTime: string): string {
    // If it contains hours, show just the hours
    const hoursMatch = resetTime.match(/(\d+)h/);
    if (hoursMatch) {
        return `${hoursMatch[1]}h`;
    }
    // If only minutes, show minutes
    const minsMatch = resetTime.match(/(\d+)m/);
    if (minsMatch) {
        return `${minsMatch[1]}m`;
    }
    // Fallback to original
    return resetTime;
}
