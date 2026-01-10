import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  Persona,
  PersonasConfig,
  PersonaGenerationStatus,
  IPCResult
} from '../../../shared/types';
import { createIpcListener, invokeIpc, sendIpc, IpcListenerCleanup } from './ipc-utils';

export interface PersonaGenerationOptions {
  enableResearch: boolean;
}

/**
 * Persona API operations
 */
export interface PersonaAPI {
  // Operations
  getPersonas: (projectId: string) => Promise<IPCResult<PersonasConfig | null>>;
  generatePersonas: (projectId: string, options: PersonaGenerationOptions) => void;
  refreshPersonas: (projectId: string, options: PersonaGenerationOptions) => void;
  stopPersonas: (projectId: string) => Promise<IPCResult>;
  savePersonas: (projectId: string, personas: Persona[]) => Promise<IPCResult>;
  updatePersona: (
    projectId: string,
    personaId: string,
    updates: Partial<Persona>
  ) => Promise<IPCResult>;
  deletePersona: (projectId: string, personaId: string) => Promise<IPCResult>;
  addPersona: (projectId: string, persona: Persona) => Promise<IPCResult>;

  // Event Listeners
  onPersonaProgress: (
    callback: (projectId: string, status: PersonaGenerationStatus) => void
  ) => IpcListenerCleanup;
  onPersonaComplete: (
    callback: (projectId: string, config: PersonasConfig) => void
  ) => IpcListenerCleanup;
  onPersonaError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;
  onPersonaStopped: (
    callback: (projectId: string) => void
  ) => IpcListenerCleanup;
}

/**
 * Creates the Persona API implementation
 */
export const createPersonaAPI = (): PersonaAPI => ({
  // Operations
  getPersonas: (projectId: string): Promise<IPCResult<PersonasConfig | null>> =>
    invokeIpc(IPC_CHANNELS.PERSONA_GET, projectId),

  generatePersonas: (projectId: string, options: PersonaGenerationOptions): void =>
    sendIpc(IPC_CHANNELS.PERSONA_GENERATE, projectId, options),

  refreshPersonas: (projectId: string, options: PersonaGenerationOptions): void =>
    sendIpc(IPC_CHANNELS.PERSONA_REFRESH, projectId, options),

  stopPersonas: (projectId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.PERSONA_STOP, projectId),

  savePersonas: (projectId: string, personas: Persona[]): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.PERSONA_SAVE, projectId, personas),

  updatePersona: (
    projectId: string,
    personaId: string,
    updates: Partial<Persona>
  ): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.PERSONA_UPDATE, projectId, personaId, updates),

  deletePersona: (projectId: string, personaId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.PERSONA_DELETE, projectId, personaId),

  addPersona: (projectId: string, persona: Persona): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.PERSONA_ADD, projectId, persona),

  // Event Listeners
  onPersonaProgress: (
    callback: (projectId: string, status: PersonaGenerationStatus) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.PERSONA_PROGRESS, callback),

  onPersonaComplete: (
    callback: (projectId: string, config: PersonasConfig) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.PERSONA_COMPLETE, callback),

  onPersonaError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.PERSONA_ERROR, callback),

  onPersonaStopped: (
    callback: (projectId: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.PERSONA_STOPPED, callback)
});
