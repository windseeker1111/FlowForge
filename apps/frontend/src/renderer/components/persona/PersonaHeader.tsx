import { Plus, RefreshCw, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { getPersonaStats } from '../../stores/persona-store';
import type { PersonaHeaderProps } from './types';

export function PersonaHeader({ personas, onAddPersona, onRefresh }: PersonaHeaderProps) {
  const { t } = useTranslation(['personas', 'common']);
  const stats = getPersonaStats(personas);

  return (
    <div className="flex items-center justify-between p-4 border-b bg-card">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{t('personas:header.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('personas:header.subtitle', { count: stats.total })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Stats badges */}
        <div className="hidden md:flex items-center gap-2 mr-4">
          {stats.byType.primary && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-primary" />
              {stats.byType.primary} {t('personas:types.primary')}
            </div>
          )}
          {stats.byType.secondary && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-info" />
              {stats.byType.secondary} {t('personas:types.secondary')}
            </div>
          )}
          {stats.researchEnriched > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-purple-500" />
              {stats.researchEnriched} {t('personas:header.researchEnriched')}
            </div>
          )}
        </div>

        {/* Refresh button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4 mr-1" />
              {t('common:refresh')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('personas:header.refreshTooltip')}</TooltipContent>
        </Tooltip>

        {/* Add persona button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" onClick={onAddPersona}>
              <Plus className="h-4 w-4 mr-1" />
              {t('personas:header.addButton')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('personas:header.addTooltip')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
