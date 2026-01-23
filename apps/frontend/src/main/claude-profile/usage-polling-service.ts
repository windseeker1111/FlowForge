/**
 * Usage Polling Service - Background terminals for real-time usage monitoring
 * 
 * Creates hidden terminals for each Claude profile with OAuth token and
 * polls `/usage` every 30 seconds to get real usage data.
 */

import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as pty from '@lydell/node-pty';
import { getClaudeProfileManager } from '../claude-profile-manager';
import { parseUsageOutput } from './usage-parser';
import { getClaudeCliInvocationAsync } from '../claude-cli-utils';
import { ClaudeUsageSnapshot, ClaudeProfile } from '../../shared/types/agent';

interface PollingTerminal {
    profileId: string;
    profileName: string;
    process: ChildProcess | null;
    outputBuffer: string;
    lastUsage: ClaudeUsageSnapshot | null;
    isReady: boolean;
    pendingUsageRequest: boolean;
}

export class UsagePollingService extends EventEmitter {
    private static instance: UsagePollingService;
    private terminals: Map<string, PollingTerminal> = new Map();
    private pollIntervalId: NodeJS.Timeout | null = null;
    private isStarting = false;
    private readonly pollInterval = 30000; // 30 seconds

    private constructor() {
        super();
        console.warn('[UsagePollingService] Initialized');
    }

    static getInstance(): UsagePollingService {
        if (!UsagePollingService.instance) {
            UsagePollingService.instance = new UsagePollingService();
        }
        return UsagePollingService.instance;
    }

    /**
     * Start the polling service - creates background terminals for each profile
     */
    async start(): Promise<void> {
        if (this.isStarting) {
            console.warn('[UsagePollingService] Already starting');
            return;
        }

        if (this.pollIntervalId) {
            console.warn('[UsagePollingService] Already running');
            return;
        }

        this.isStarting = true;
        console.warn('[UsagePollingService] Starting background usage polling');

        try {
            const profileManager = getClaudeProfileManager();
            const settings = profileManager.getSettings();

            // Create terminals for all profiles with OAuth tokens
            for (const profile of settings.profiles) {
                if (profile.oauthToken) {
                    await this.createPollingTerminal(profile);
                } else {
                    console.warn('[UsagePollingService] Skipping profile without OAuth token:', profile.name);
                }
            }

            // Start polling interval
            this.pollIntervalId = setInterval(() => {
                this.pollAllTerminals();
            }, this.pollInterval);

            // Do initial poll after terminals are ready (must be after Enter is pressed at 3s and ready at 6s)
            setTimeout(() => {
                this.pollAllTerminals();
            }, 10000); // Wait 10s for Claude to fully initialize

            console.warn('[UsagePollingService] Started with', this.terminals.size, 'terminals');
        } catch (error) {
            console.error('[UsagePollingService] Failed to start:', error);
        } finally {
            this.isStarting = false;
        }
    }

    /**
     * Stop the polling service and clean up terminals
     */
    async stop(): Promise<void> {
        console.warn('[UsagePollingService] Stopping');

        if (this.pollIntervalId) {
            clearInterval(this.pollIntervalId);
            this.pollIntervalId = null;
        }

        // Kill all terminal processes
        for (const [profileId, terminal] of this.terminals) {
            const ptyRef = (terminal as any).pty as pty.IPty | null;
            if (ptyRef) {
                console.warn('[UsagePollingService] Killing terminal for:', profileId);
                ptyRef.kill();
            }
        }

        this.terminals.clear();
        console.warn('[UsagePollingService] Stopped');
    }

    /**
     * Get current usage for a specific profile
     */
    getProfileUsage(profileId: string): ClaudeUsageSnapshot | null {
        const terminal = this.terminals.get(profileId);
        return terminal?.lastUsage || null;
    }

    /**
     * Get usage for all profiles
     */
    getAllUsage(): Map<string, ClaudeUsageSnapshot | null> {
        const result = new Map<string, ClaudeUsageSnapshot | null>();
        for (const [profileId, terminal] of this.terminals) {
            result.set(profileId, terminal.lastUsage);
        }
        return result;
    }

    /**
     * Create a background terminal for a profile
     */
    private async createPollingTerminal(profile: ClaudeProfile): Promise<void> {
        const profileManager = getClaudeProfileManager();
        const token = profileManager.getProfileToken(profile.id);

        if (!token) {
            console.warn('[UsagePollingService] No token available for profile:', profile.name);
            return;
        }

        try {
            const { command: claudeCmd } = await getClaudeCliInvocationAsync();

            // Create a temporary file for the token (same approach as claude-integration-handler.ts)
            const nonce = crypto.randomBytes(8).toString('hex');
            const tempTokenFile = path.join(os.tmpdir(), `.claude-usage-token-${profile.id}-${nonce}`);

            fs.writeFileSync(
                tempTokenFile,
                `export CLAUDE_CODE_OAUTH_TOKEN='${token}'\n`,
                { mode: 0o600 }
            );

            // Use node-pty for proper pseudo-terminal support
            // This is required because Claude Code expects an interactive terminal
            const shellCommand = `source "${tempTokenFile}" && rm -f "${tempTokenFile}" && "${claudeCmd}"`;

            const proc = pty.spawn('bash', ['-c', shellCommand], {
                name: 'xterm-256color',
                cols: 120,
                rows: 30,
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    FORCE_COLOR: '1'
                } as Record<string, string>
            });

            const pollingTerminal: PollingTerminal = {
                profileId: profile.id,
                profileName: profile.name,
                process: proc as unknown as ChildProcess, // Cast for type compatibility
                outputBuffer: '',
                lastUsage: null,
                isReady: false,
                pendingUsageRequest: false
            };

            // Store reference to pty for write access
            (pollingTerminal as any).pty = proc;

            // Handle output from PTY
            proc.onData((data: string) => {
                pollingTerminal.outputBuffer += data;

                // Strip ANSI codes for cleaner logging
                const cleanData = data.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[\?[0-9]*[hl]/g, '');

                // Debug: log output (truncated) - but always show if pending usage request
                if (cleanData.trim().length > 0) {
                    if (pollingTerminal.pendingUsageRequest) {
                        console.warn(`[UsagePollingService] [${profile.name}] PENDING output:`, cleanData.substring(0, 300));
                    } else {
                        console.warn(`[UsagePollingService] [${profile.name}] output:`, cleanData.substring(0, 150));
                    }
                }

                // Check if Claude is ready (Look for various prompt indicators)
                if (!pollingTerminal.isReady && (
                    data.includes('>') ||
                    data.includes('Claude') ||
                    data.includes('Tips')
                )) {
                    pollingTerminal.isReady = true;
                    console.warn('[UsagePollingService] Terminal ready for:', profile.name);
                }

                // Check for /usage output and parse it
                if (pollingTerminal.pendingUsageRequest) {
                    this.tryParseUsageOutput(pollingTerminal);
                }
            });

            // Handle exit
            proc.onExit(({ exitCode, signal }) => {
                console.warn('[UsagePollingService] Terminal exited for:', profile.name, { exitCode, signal });
                pollingTerminal.process = null;
                pollingTerminal.isReady = false;
                (pollingTerminal as any).pty = null;

                // Attempt restart after delay (only if service is still running)
                setTimeout(() => {
                    if (this.pollIntervalId) {
                        console.warn('[UsagePollingService] Restarting terminal for:', profile.name);
                        this.createPollingTerminal(profile);
                    }
                }, 10000); // Wait 10s before restart
            });

            this.terminals.set(profile.id, pollingTerminal);
            console.warn('[UsagePollingService] Created terminal for:', profile.name);

            // Auto-mark as ready after 5 seconds if not already ready
            // Claude Code needs time to initialize, and we need to press Enter to dismiss the initial prompt
            setTimeout(() => {
                if (pollingTerminal.process) {
                    const ptyRef = (pollingTerminal as any).pty as pty.IPty | null;
                    if (ptyRef) {
                        // Press Enter to dismiss the "Press Enter to continue" prompt
                        console.warn('[UsagePollingService] Sending Enter to dismiss initial prompt for:', profile.name);
                        ptyRef.write('\n');
                    }
                }
            }, 3000); // Press Enter after 3s

            // Mark as fully ready after 6 seconds (after Enter has been processed)
            setTimeout(() => {
                if (!pollingTerminal.isReady && pollingTerminal.process) {
                    pollingTerminal.isReady = true;
                    console.warn('[UsagePollingService] Auto-marking terminal as ready for:', profile.name);
                }
            }, 6000);

        } catch (error) {
            console.error('[UsagePollingService] Failed to create terminal for:', profile.name, error);
        }
    }

    /**
     * Poll all terminals for usage
     */
    private pollAllTerminals(): void {
        for (const [profileId, terminal] of this.terminals) {
            if (terminal.isReady && terminal.process && !terminal.pendingUsageRequest) {
                this.sendUsageCommand(terminal);
            }
        }
    }

    /**
     * Send /usage command to a terminal
     */
    private sendUsageCommand(terminal: PollingTerminal): void {
        const ptyRef = (terminal as any).pty as pty.IPty | null;
        if (!ptyRef) {
            return;
        }

        // Clear buffer and mark as pending
        terminal.outputBuffer = '';
        terminal.pendingUsageRequest = true;

        console.warn('[UsagePollingService] Sending /usage to:', terminal.profileName);

        // Send /usage command via PTY
        ptyRef.write('/usage\n');

        // Timeout: if no response in 10s, cancel pending request
        setTimeout(() => {
            if (terminal.pendingUsageRequest) {
                console.warn('[UsagePollingService] Usage request timeout for:', terminal.profileName);
                terminal.pendingUsageRequest = false;
            }
        }, 10000);
    }

    /**
     * Try to parse /usage output from terminal buffer
     */
    private tryParseUsageOutput(terminal: PollingTerminal): void {
        const buffer = terminal.outputBuffer;

        // Look for usage output patterns
        // Claude /usage output looks like:
        // Current session  ████████▌ 42% used  Resets 5:30am
        // Current week (all models)  ███████░░ 71% used  Resets Jan 27

        // Check if we have enough output (contains percentage patterns)
        const hasSessionPercent = /session.*?(\d+)%/i.test(buffer);
        const hasWeeklyPercent = /week.*?(\d+)%/i.test(buffer);

        if (hasSessionPercent || hasWeeklyPercent) {
            try {
                const parsed = parseUsageOutput(buffer);

                const snapshot: ClaudeUsageSnapshot = {
                    sessionPercent: parsed.sessionUsagePercent || 0,
                    weeklyPercent: parsed.weeklyUsagePercent || 0,
                    sessionResetTime: parsed.sessionResetTime || undefined,
                    weeklyResetTime: parsed.weeklyResetTime || undefined,
                    weeklyAllModelsPercent: parsed.weeklyUsagePercent,
                    weeklySonnetPercent: undefined,
                    extraUsageEnabled: false,
                    profileId: terminal.profileId,
                    profileName: terminal.profileName,
                    fetchedAt: new Date(),
                    limitType: (parsed.weeklyUsagePercent || 0) > (parsed.sessionUsagePercent || 0) ? 'weekly' : 'session',
                    isEstimate: false  // This is REAL data from /usage!
                };

                terminal.lastUsage = snapshot;
                terminal.pendingUsageRequest = false;

                console.warn('[UsagePollingService] Parsed usage for:', terminal.profileName, {
                    session: snapshot.sessionPercent,
                    weekly: snapshot.weeklyPercent
                });

                // Update profile manager with usage data
                const profileManager = getClaudeProfileManager();
                profileManager.updateProfileUsage(terminal.profileId, {
                    sessionUsagePercent: parsed.sessionUsagePercent,
                    weeklyUsagePercent: parsed.weeklyUsagePercent,
                    sessionResetTime: parsed.sessionResetTime || '',
                    weeklyResetTime: parsed.weeklyResetTime || '',
                    lastUpdated: new Date()
                });

                // Emit usage update event
                this.emit('usage-updated', snapshot);

            } catch (error) {
                console.error('[UsagePollingService] Failed to parse usage output:', error);
                terminal.pendingUsageRequest = false;
            }
        }
    }

    /**
     * Refresh profiles - call when profiles are added/removed
     */
    async refreshProfiles(): Promise<void> {
        console.warn('[UsagePollingService] Refreshing profiles');
        await this.stop();
        await this.start();
    }
}

/**
 * Get the singleton UsagePollingService instance
 */
export function getUsagePollingService(): UsagePollingService {
    return UsagePollingService.getInstance();
}
