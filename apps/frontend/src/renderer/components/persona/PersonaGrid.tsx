import { useTranslation } from 'react-i18next';
import { PersonaCard } from './PersonaCard';
import { getPersonasByType } from '../../stores/persona-store';
import type { PersonaGridProps } from './types';

export function PersonaGrid({ personas, selectedPersona, onPersonaSelect }: PersonaGridProps) {
  const { t } = useTranslation(['personas']);

  const primaryPersonas = getPersonasByType(personas, 'primary');
  const secondaryPersonas = getPersonasByType(personas, 'secondary');
  const edgeCasePersonas = getPersonasByType(personas, 'edge-case');

  return (
    <div className="space-y-6 p-4">
      {/* Primary Personas */}
      {primaryPersonas.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary" />
            {t('personas:sections.primary')}
            <span className="text-muted-foreground">({primaryPersonas.length})</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {primaryPersonas.map((persona) => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                onSelect={onPersonaSelect}
                isSelected={selectedPersona?.id === persona.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Secondary Personas */}
      {secondaryPersonas.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-info" />
            {t('personas:sections.secondary')}
            <span className="text-muted-foreground">({secondaryPersonas.length})</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {secondaryPersonas.map((persona) => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                onSelect={onPersonaSelect}
                isSelected={selectedPersona?.id === persona.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Edge Case Personas */}
      {edgeCasePersonas.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-warning" />
            {t('personas:sections.edgeCases')}
            <span className="text-muted-foreground">({edgeCasePersonas.length})</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {edgeCasePersonas.map((persona) => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                onSelect={onPersonaSelect}
                isSelected={selectedPersona?.id === persona.id}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
