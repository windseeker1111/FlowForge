import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Users, Globe, Sparkles, CheckCircle2, AlertCircle, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import type { PersonaGenerationProgressProps } from './types';
import type { PersonaGenerationPhase } from '../../../shared/types';

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return reducedMotion;
}

type ActivePhase = Exclude<PersonaGenerationPhase, 'idle'>;

const PHASE_CONFIG: Record<
  ActivePhase,
  {
    labelKey: string;
    descriptionKey: string;
    icon: typeof Search;
    color: string;
    bgColor: string;
  }
> = {
  analyzing: {
    labelKey: 'personas:generation.phases.analyzing.label',
    descriptionKey: 'personas:generation.phases.analyzing.description',
    icon: Search,
    color: 'bg-amber-500',
    bgColor: 'bg-amber-500/20',
  },
  discovering: {
    labelKey: 'personas:generation.phases.discovering.label',
    descriptionKey: 'personas:generation.phases.discovering.description',
    icon: Users,
    color: 'bg-info',
    bgColor: 'bg-info/20',
  },
  researching: {
    labelKey: 'personas:generation.phases.researching.label',
    descriptionKey: 'personas:generation.phases.researching.description',
    icon: Globe,
    color: 'bg-purple-500',
    bgColor: 'bg-purple-500/20',
  },
  generating: {
    labelKey: 'personas:generation.phases.generating.label',
    descriptionKey: 'personas:generation.phases.generating.description',
    icon: Sparkles,
    color: 'bg-primary',
    bgColor: 'bg-primary/20',
  },
  complete: {
    labelKey: 'personas:generation.phases.complete.label',
    descriptionKey: 'personas:generation.phases.complete.description',
    icon: CheckCircle2,
    color: 'bg-success',
    bgColor: 'bg-success/20',
  },
  error: {
    labelKey: 'personas:generation.phases.error.label',
    descriptionKey: 'personas:generation.phases.error.description',
    icon: AlertCircle,
    color: 'bg-destructive',
    bgColor: 'bg-destructive/20',
  },
};

const STEP_PHASES: { key: ActivePhase; labelKey: string }[] = [
  { key: 'analyzing', labelKey: 'personas:generation.steps.analyze' },
  { key: 'discovering', labelKey: 'personas:generation.steps.discover' },
  { key: 'researching', labelKey: 'personas:generation.steps.research' },
  { key: 'generating', labelKey: 'personas:generation.steps.generate' },
];

function PhaseStepsIndicator({
  currentPhase,
  reducedMotion,
}: {
  currentPhase: PersonaGenerationPhase;
  reducedMotion: boolean;
}) {
  const { t } = useTranslation(['personas']);

  const getPhaseState = (
    phaseKey: ActivePhase
  ): 'pending' | 'active' | 'complete' | 'error' => {
    const phaseOrder: ActivePhase[] = ['analyzing', 'discovering', 'researching', 'generating', 'complete'];
    const currentIndex = phaseOrder.indexOf(currentPhase as ActivePhase);
    const phaseIndex = phaseOrder.indexOf(phaseKey);

    if (currentPhase === 'error') return 'error';
    if (currentPhase === 'complete') return 'complete';
    if (phaseKey === currentPhase) return 'active';
    if (phaseIndex < currentIndex) return 'complete';
    return 'pending';
  };

  const getStepAnimation = (state: string) => {
    if (state !== 'active') return { opacity: 1 };
    return reducedMotion ? { opacity: 1 } : { opacity: [1, 0.6, 1] };
  };

  const getStepTransition = (state: string) => {
    if (state !== 'active' || reducedMotion) return undefined;
    return { duration: 1.5, repeat: Infinity, ease: 'easeInOut' as const };
  };

  return (
    <div className="flex items-center justify-center gap-1 mt-4 flex-wrap">
      {STEP_PHASES.map((phase, index) => {
        const state = getPhaseState(phase.key);
        return (
          <div key={phase.key} className="flex items-center">
            <motion.div
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
                state === 'complete' && 'bg-success/10 text-success',
                state === 'active' && 'bg-primary/10 text-primary',
                state === 'error' && 'bg-destructive/10 text-destructive',
                state === 'pending' && 'bg-muted text-muted-foreground'
              )}
              animate={getStepAnimation(state)}
              transition={getStepTransition(state)}
            >
              {state === 'complete' && (
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )}
              {t(phase.labelKey)}
            </motion.div>
            {index < STEP_PHASES.length - 1 && (
              <div
                className={cn(
                  'w-4 h-px mx-1',
                  getPhaseState(STEP_PHASES[index + 1].key) !== 'pending'
                    ? 'bg-success/50'
                    : 'bg-border'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PersonaGenerationProgress({
  generationStatus,
  className,
  onStop
}: PersonaGenerationProgressProps) {
  const { t } = useTranslation(['personas', 'common']);
  const { phase, progress, message, error } = generationStatus;
  const reducedMotion = useReducedMotion();
  const [isStopping, setIsStopping] = useState(false);

  const handleStopClick = async () => {
    if (!onStop || isStopping) return;
    setIsStopping(true);
    try {
      await onStop();
    } catch (err) {
      console.error('Failed to stop generation:', err);
    } finally {
      setIsStopping(false);
    }
  };

  if (phase === 'idle') {
    return null;
  }

  const config = PHASE_CONFIG[phase];
  const Icon = config.icon;
  const isActivePhase = phase !== 'complete' && phase !== 'error';

  const pulseAnimation = reducedMotion
    ? {}
    : { scale: [1, 1.1, 1], opacity: [1, 0.8, 1] };

  const pulseTransition = reducedMotion
    ? { duration: 0 }
    : { duration: 1.5, repeat: isActivePhase ? Infinity : 0, ease: 'easeInOut' as const };

  const dotAnimation = reducedMotion
    ? { scale: 1, opacity: 1 }
    : { scale: [1, 1.5, 1], opacity: [1, 0.5, 1] };

  const dotTransition = reducedMotion
    ? { duration: 0 }
    : { duration: 1, repeat: Infinity, ease: 'easeInOut' as const };

  const indeterminateAnimation = reducedMotion
    ? { x: '150%' }
    : { x: ['-100%', '400%'] };

  const indeterminateTransition = reducedMotion
    ? { duration: 0 }
    : { duration: 1.5, repeat: Infinity, ease: 'easeInOut' as const };

  return (
    <div className={cn('space-y-4 p-6 rounded-xl bg-card border', className)}>
      {isActivePhase && onStop && (
        <div className="flex justify-end mb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStopClick}
                disabled={isStopping}
              >
                <Square className="h-4 w-4 mr-1" />
                {isStopping ? t('common:stopping') : t('common:stop')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('personas:generation.stopTooltip')}</TooltipContent>
          </Tooltip>
        </div>
      )}

      <div className="flex flex-col items-center text-center space-y-3">
        <div className="relative">
          <motion.div
            className={cn('p-4 rounded-full', config.bgColor)}
            animate={isActivePhase ? pulseAnimation : {}}
            transition={pulseTransition}
          >
            <Icon className={cn('h-8 w-8', config.color.replace('bg-', 'text-'))} />
          </motion.div>
          {isActivePhase && (
            <motion.div
              className={cn('absolute top-0 right-0 h-3 w-3 rounded-full', config.color)}
              animate={dotAnimation}
              transition={dotTransition}
            />
          )}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-1"
          >
            <h3 className="text-lg font-semibold">{t(config.labelKey)}</h3>
            <p className="text-sm text-muted-foreground">{t(config.descriptionKey)}</p>
            {message && message !== t(config.descriptionKey) && (
              <p className="text-xs text-muted-foreground mt-1">{message}</p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {isActivePhase && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('common:progress')}</span>
            <span className="text-xs font-medium">{progress}%</span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-border">
            {progress > 0 ? (
              <motion.div
                className={cn('h-full rounded-full', config.color)}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            ) : (
              <motion.div
                className={cn('absolute h-full w-1/3 rounded-full', config.color)}
                animate={indeterminateAnimation}
                transition={indeterminateTransition}
              />
            )}
          </div>
        </div>
      )}

      <PhaseStepsIndicator currentPhase={phase} reducedMotion={reducedMotion} />

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error-display"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="p-3 bg-destructive/10 rounded-md"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
