import { create } from 'zustand';
import type {
  Persona,
  PersonasConfig,
  PersonaGenerationStatus,
  PersonaDiscoveryResult
} from '../../shared/types';

interface PersonaState {
  // Data
  personas: Persona[];
  discoveryResult: PersonaDiscoveryResult | null;
  generationStatus: PersonaGenerationStatus;
  currentProjectId: string | null;

  // Actions
  setPersonas: (personas: Persona[]) => void;
  setDiscoveryResult: (result: PersonaDiscoveryResult | null) => void;
  setGenerationStatus: (status: PersonaGenerationStatus) => void;
  setCurrentProjectId: (projectId: string | null) => void;
  updatePersona: (personaId: string, updates: Partial<Persona>) => void;
  deletePersona: (personaId: string) => void;
  addPersona: (persona: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>) => string;
  reorderPersonas: (personaIds: string[]) => void;
  clearPersonas: () => void;
}

const initialGenerationStatus: PersonaGenerationStatus = {
  phase: 'idle',
  progress: 0,
  message: ''
};

export const usePersonaStore = create<PersonaState>((set) => ({
  // Initial state
  personas: [],
  discoveryResult: null,
  generationStatus: initialGenerationStatus,
  currentProjectId: null,

  // Actions
  setPersonas: (personas) => set({ personas }),

  setDiscoveryResult: (result) => set({ discoveryResult: result }),

  setGenerationStatus: (status) => set({ generationStatus: status }),

  setCurrentProjectId: (projectId) => set({ currentProjectId: projectId }),

  updatePersona: (personaId, updates) =>
    set((state) => {
      const updatedPersonas = state.personas.map((persona) =>
        persona.id === personaId
          ? { ...persona, ...updates, updatedAt: new Date().toISOString() }
          : persona
      );
      return { personas: updatedPersonas };
    }),

  deletePersona: (personaId) =>
    set((state) => {
      const updatedPersonas = state.personas.filter(
        (persona) => persona.id !== personaId
      );
      return { personas: updatedPersonas };
    }),

  addPersona: (personaData) => {
    const newId = `persona-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const newPersona: Persona = {
      ...personaData,
      id: newId,
      createdAt: now,
      updatedAt: now
    };

    set((state) => ({
      personas: [...state.personas, newPersona]
    }));

    return newId;
  },

  reorderPersonas: (personaIds) =>
    set((state) => {
      const reorderedPersonas = personaIds
        .map((id) => state.personas.find((p) => p.id === id))
        .filter((p): p is Persona => p !== undefined);
      return { personas: reorderedPersonas };
    }),

  clearPersonas: () =>
    set({
      personas: [],
      discoveryResult: null,
      generationStatus: initialGenerationStatus,
      currentProjectId: null
    })
}));

// Helper functions for loading personas
export async function loadPersonas(projectId: string): Promise<void> {
  const store = usePersonaStore.getState();

  // Set current project ID first for event handler filtering
  store.setCurrentProjectId(projectId);

  // Check if generation is currently running
  const statusResult = await window.electronAPI.getPersonaStatus?.(projectId);
  if (statusResult?.success && statusResult.data?.isRunning) {
    store.setGenerationStatus({
      phase: 'analyzing',
      progress: 0,
      message: 'Persona generation in progress...'
    });
  } else {
    store.setGenerationStatus({
      phase: 'idle',
      progress: 0,
      message: ''
    });
  }

  // Load personas from file
  const result = await window.electronAPI.getPersonas(projectId);
  if (result.success && result.data) {
    const config = result.data as PersonasConfig;
    store.setPersonas(config.personas);
  } else {
    store.setPersonas([]);
  }
}

export function generatePersonas(
  projectId: string,
  enableResearch?: boolean
): void {
  if (window.DEBUG) {
    console.log('[Personas] Starting generation:', { projectId, enableResearch });
  }

  usePersonaStore.getState().setGenerationStatus({
    phase: 'analyzing',
    progress: 0,
    message: 'Starting persona generation...'
  });
  window.electronAPI.generatePersonas(projectId, enableResearch);
}

export function refreshPersonas(
  projectId: string,
  enableResearch?: boolean
): void {
  if (window.DEBUG) {
    console.log('[Personas] Starting refresh:', { projectId, enableResearch });
  }

  usePersonaStore.getState().setGenerationStatus({
    phase: 'analyzing',
    progress: 0,
    message: 'Refreshing personas...'
  });
  window.electronAPI.refreshPersonas(projectId, enableResearch);
}

export async function stopPersonas(projectId: string): Promise<boolean> {
  const store = usePersonaStore.getState();

  if (window.DEBUG) {
    console.log('[Personas] Stop requested:', { projectId });
  }

  // Update UI state to idle
  store.setGenerationStatus({
    phase: 'idle',
    progress: 0,
    message: 'Generation stopped'
  });

  const result = await window.electronAPI.stopPersonas(projectId);

  if (window.DEBUG) {
    console.log('[Personas] Stop result:', { projectId, success: result.success });
  }

  if (!result.success) {
    console.log('[Personas] Process already stopped');
  }

  return result.success;
}

export async function savePersonas(
  projectId: string,
  personas: Persona[]
): Promise<boolean> {
  const store = usePersonaStore.getState();
  const result = await window.electronAPI.savePersonas(projectId, personas);

  if (result.success) {
    store.setPersonas(personas);
  }

  return result.success;
}

// Selectors
export function getPersonasByType(
  personas: Persona[],
  type: Persona['type']
): Persona[] {
  return personas.filter((p) => p.type === type);
}

export function getPrimaryPersonas(personas: Persona[]): Persona[] {
  return getPersonasByType(personas, 'primary');
}

export function getSecondaryPersonas(personas: Persona[]): Persona[] {
  return getPersonasByType(personas, 'secondary');
}

export function getEdgeCasePersonas(personas: Persona[]): Persona[] {
  return getPersonasByType(personas, 'edge-case');
}

export function getPersonaStats(personas: Persona[]): {
  total: number;
  byType: Record<string, number>;
  byConfidence: Record<string, number>;
  researchEnriched: number;
} {
  const byType: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  let researchEnriched = 0;

  personas.forEach((persona) => {
    byType[persona.type] = (byType[persona.type] || 0) + 1;
    byConfidence[persona.discoverySource.confidence] =
      (byConfidence[persona.discoverySource.confidence] || 0) + 1;
    if (persona.discoverySource.researchEnriched) {
      researchEnriched++;
    }
  });

  return {
    total: personas.length,
    byType,
    byConfidence,
    researchEnriched
  };
}

export function getPersonaById(
  personas: Persona[],
  id: string
): Persona | undefined {
  return personas.find((p) => p.id === id);
}

export function getPersonasByGoalPriority(
  personas: Persona[],
  priority: 'must-have' | 'should-have' | 'nice-to-have'
): Persona[] {
  return personas.filter((persona) =>
    persona.goals.some((goal) => goal.priority === priority)
  );
}

export function getPersonasWithPainPoint(
  personas: Persona[],
  severity: 'high' | 'medium' | 'low'
): Persona[] {
  return personas.filter((persona) =>
    persona.painPoints.some((pp) => pp.severity === severity)
  );
}
