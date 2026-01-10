import { Users, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import type { PersonaEmptyStateProps } from './types';

export function PersonaEmptyState({ onGenerate }: PersonaEmptyStateProps) {
  const { t } = useTranslation(['personas', 'common']);

  return (
    <div className="flex h-full items-center justify-center">
      <Card className="w-full max-w-lg p-8 text-center">
        <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">
          {t('personas:emptyState.title')}
        </h2>
        <p className="text-muted-foreground mb-6">
          {t('personas:emptyState.description')}
        </p>
        <Button onClick={onGenerate} size="lg">
          <Sparkles className="h-4 w-4 mr-2" />
          {t('personas:emptyState.generateButton')}
        </Button>
      </Card>
    </div>
  );
}
