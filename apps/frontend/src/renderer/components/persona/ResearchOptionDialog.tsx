import { Globe, Zap, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import type { ResearchOptionDialogProps } from './types';

export function ResearchOptionDialog({
  open,
  onOpenChange,
  onEnableResearch,
  onSkipResearch,
}: ResearchOptionDialogProps) {
  const { t } = useTranslation(['personas', 'common']);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-purple-500" />
            {t('personas:researchDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('personas:researchDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg bg-purple-500/10 p-4 space-y-2">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Globe className="h-4 w-4 text-purple-500" />
              {t('personas:researchDialog.withResearch.title')}
            </h4>
            <ul className="text-sm text-muted-foreground space-y-1 ml-6">
              <li>• {t('personas:researchDialog.withResearch.benefit1')}</li>
              <li>• {t('personas:researchDialog.withResearch.benefit2')}</li>
              <li>• {t('personas:researchDialog.withResearch.benefit3')}</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Info className="h-3 w-3" />
              {t('personas:researchDialog.withResearch.note')}
            </p>
          </div>

          <div className="rounded-lg bg-muted p-4 space-y-2">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              {t('personas:researchDialog.withoutResearch.title')}
            </h4>
            <ul className="text-sm text-muted-foreground space-y-1 ml-6">
              <li>• {t('personas:researchDialog.withoutResearch.benefit1')}</li>
              <li>• {t('personas:researchDialog.withoutResearch.benefit2')}</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onSkipResearch} className="flex-1">
            <Zap className="h-4 w-4 mr-2" />
            {t('personas:researchDialog.skipButton')}
          </Button>
          <Button onClick={onEnableResearch} className="flex-1">
            <Globe className="h-4 w-4 mr-2" />
            {t('personas:researchDialog.enableButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
