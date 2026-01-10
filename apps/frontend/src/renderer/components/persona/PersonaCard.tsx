import { Users, Target, AlertTriangle, Star, Briefcase, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import type { PersonaCardProps } from './types';

const TYPE_STYLES = {
  primary: {
    border: 'border-primary/30',
    badge: 'bg-primary/10 text-primary border-primary/30',
    icon: Star,
  },
  secondary: {
    border: 'border-info/30',
    badge: 'bg-info/10 text-info border-info/30',
    icon: Users,
  },
  'edge-case': {
    border: 'border-warning/30',
    badge: 'bg-warning/10 text-warning border-warning/30',
    icon: AlertTriangle,
  },
};

const CONFIDENCE_STYLES = {
  high: 'bg-success/10 text-success border-success/30',
  medium: 'bg-warning/10 text-warning border-warning/30',
  low: 'bg-muted text-muted-foreground border-muted',
};

export function PersonaCard({ persona, onSelect, isSelected }: PersonaCardProps) {
  const { t } = useTranslation(['personas']);

  const typeStyle = TYPE_STYLES[persona.type];
  const TypeIcon = typeStyle.icon;
  const confidenceStyle = CONFIDENCE_STYLES[persona.discoverySource.confidence];

  const topGoal = persona.goals.find((g) => g.priority === 'must-have') || persona.goals[0];
  const topPainPoint = persona.painPoints.find((p) => p.severity === 'high') || persona.painPoints[0];

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-md hover:border-primary/50',
        typeStyle.border,
        isSelected && 'ring-2 ring-primary border-primary'
      )}
      onClick={() => onSelect(persona)}
    >
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          {/* Avatar */}
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold text-white flex-shrink-0"
            style={{ backgroundColor: persona.avatar.color }}
          >
            {persona.avatar.initials}
          </div>

          {/* Name and badges */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{persona.name}</h3>
            <p className="text-xs text-muted-foreground truncate">{persona.tagline}</p>
            <div className="flex gap-1 mt-1.5 flex-wrap">
              <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', typeStyle.badge)}>
                <TypeIcon className="h-2.5 w-2.5 mr-0.5" />
                {t(`personas:types.${persona.type}`)}
              </Badge>
              <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', confidenceStyle)}>
                {t(`personas:confidence.${persona.discoverySource.confidence}`)}
              </Badge>
            </div>
          </div>
        </div>

        {/* Demographics */}
        <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Briefcase className="h-3 w-3" />
            <span className="truncate">{persona.demographics.role}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{t(`personas:usageFrequency.${persona.behaviors.usageFrequency}`)}</span>
          </div>
        </div>

        {/* Top Goal */}
        {topGoal && (
          <div className="mb-2">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
              <Target className="h-2.5 w-2.5" />
              {t('personas:card.topGoal')}
            </div>
            <p className="text-xs line-clamp-2">{topGoal.description}</p>
          </div>
        )}

        {/* Top Pain Point */}
        {topPainPoint && (
          <div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
              <AlertTriangle className="h-2.5 w-2.5" />
              {t('personas:card.topPainPoint')}
            </div>
            <p className="text-xs line-clamp-2 text-destructive/80">{topPainPoint.description}</p>
          </div>
        )}

        {/* Research enriched indicator */}
        {persona.discoverySource.researchEnriched && (
          <div className="mt-2 pt-2 border-t">
            <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-600 border-purple-500/30">
              {t('personas:card.researchEnriched')}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
