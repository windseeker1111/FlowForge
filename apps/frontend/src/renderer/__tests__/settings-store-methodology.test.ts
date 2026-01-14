/**
 * Unit tests for Settings Store - defaultMethodology feature
 * Tests Zustand store for methodology settings persistence
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSettingsStore, loadSettings, saveSettings } from '../stores/settings-store';
import { DEFAULT_APP_SETTINGS } from '../../shared/constants';
import type { AppSettings } from '../../shared/types';

// Mock electron API
const mockGetSettings = vi.fn();
const mockSaveSettings = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    getSettings: mockGetSettings,
    saveSettings: mockSaveSettings,
    getAPIProfiles: vi.fn().mockResolvedValue({ success: true, data: { profiles: [], activeProfileId: null } }),
    saveAPIProfile: vi.fn(),
    updateAPIProfile: vi.fn(),
    deleteAPIProfile: vi.fn(),
    setActiveAPIProfile: vi.fn(),
    testConnection: vi.fn(),
    discoverModels: vi.fn()
  }
});

describe('Settings Store - defaultMethodology', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    useSettingsStore.setState({
      settings: DEFAULT_APP_SETTINGS as AppSettings,
      isLoading: false,
      error: null
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setSettings with defaultMethodology', () => {
    it('should set defaultMethodology in settings', () => {
      const settings: AppSettings = {
        ...DEFAULT_APP_SETTINGS,
        defaultMethodology: 'bmad'
      } as AppSettings;

      useSettingsStore.getState().setSettings(settings);

      expect(useSettingsStore.getState().settings.defaultMethodology).toBe('bmad');
    });

    it('should allow undefined defaultMethodology', () => {
      const settings: AppSettings = {
        ...DEFAULT_APP_SETTINGS,
        defaultMethodology: undefined
      } as AppSettings;

      useSettingsStore.getState().setSettings(settings);

      expect(useSettingsStore.getState().settings.defaultMethodology).toBeUndefined();
    });
  });

  describe('updateSettings with defaultMethodology', () => {
    it('should update only defaultMethodology without affecting other settings', () => {
      const initialSettings: AppSettings = {
        ...DEFAULT_APP_SETTINGS,
        theme: 'dark',
        defaultMethodology: 'native'
      } as AppSettings;

      useSettingsStore.getState().setSettings(initialSettings);
      useSettingsStore.getState().updateSettings({ defaultMethodology: 'bmad' });

      const state = useSettingsStore.getState().settings;
      expect(state.defaultMethodology).toBe('bmad');
      expect(state.theme).toBe('dark'); // Other settings unchanged
    });

    it('should merge defaultMethodology with existing settings', () => {
      useSettingsStore.getState().setSettings({
        ...DEFAULT_APP_SETTINGS,
        theme: 'light',
        agentFramework: 'auto-claude'
      } as AppSettings);

      useSettingsStore.getState().updateSettings({ defaultMethodology: 'bmad' });

      expect(useSettingsStore.getState().settings.defaultMethodology).toBe('bmad');
      expect(useSettingsStore.getState().settings.theme).toBe('light');
      expect(useSettingsStore.getState().settings.agentFramework).toBe('auto-claude');
    });
  });

  describe('loadSettings with defaultMethodology', () => {
    it('should load defaultMethodology from electron store', async () => {
      const savedSettings: AppSettings = {
        ...DEFAULT_APP_SETTINGS,
        defaultMethodology: 'bmad',
        onboardingCompleted: true
      } as AppSettings;

      mockGetSettings.mockResolvedValue({
        success: true,
        data: savedSettings
      });

      await loadSettings();

      expect(mockGetSettings).toHaveBeenCalled();
      expect(useSettingsStore.getState().settings.defaultMethodology).toBe('bmad');
    });

    it('should preserve undefined defaultMethodology from storage', async () => {
      const savedSettings: AppSettings = {
        ...DEFAULT_APP_SETTINGS,
        onboardingCompleted: true
        // defaultMethodology intentionally not set
      } as AppSettings;

      mockGetSettings.mockResolvedValue({
        success: true,
        data: savedSettings
      });

      await loadSettings();

      expect(useSettingsStore.getState().settings.defaultMethodology).toBeUndefined();
    });

    it('should handle load failure gracefully', async () => {
      mockGetSettings.mockResolvedValue({
        success: false,
        error: 'Failed to load'
      });

      await loadSettings();

      // Should not throw, settings remain at defaults
      expect(useSettingsStore.getState().error).toBeNull();
    });
  });

  describe('saveSettings with defaultMethodology', () => {
    it('should save defaultMethodology to electron store', async () => {
      mockSaveSettings.mockResolvedValue({ success: true });

      const result = await saveSettings({ defaultMethodology: 'bmad' });

      expect(result).toBe(true);
      expect(mockSaveSettings).toHaveBeenCalledWith({ defaultMethodology: 'bmad' });
    });

    it('should update store after successful save', async () => {
      mockSaveSettings.mockResolvedValue({ success: true });

      await saveSettings({ defaultMethodology: 'bmad' });

      expect(useSettingsStore.getState().settings.defaultMethodology).toBe('bmad');
    });

    it('should not update store on save failure', async () => {
      useSettingsStore.getState().setSettings({
        ...DEFAULT_APP_SETTINGS,
        defaultMethodology: 'native'
      } as AppSettings);

      mockSaveSettings.mockResolvedValue({ success: false });

      const result = await saveSettings({ defaultMethodology: 'bmad' });

      expect(result).toBe(false);
      expect(useSettingsStore.getState().settings.defaultMethodology).toBe('native');
    });

    it('should handle save exception gracefully', async () => {
      mockSaveSettings.mockRejectedValue(new Error('Save failed'));

      const result = await saveSettings({ defaultMethodology: 'bmad' });

      expect(result).toBe(false);
    });
  });

  describe('round-trip persistence', () => {
    it('should persist and reload defaultMethodology correctly', async () => {
      // First save
      mockSaveSettings.mockResolvedValue({ success: true });
      await saveSettings({ defaultMethodology: 'bmad' });

      // Then reload
      mockGetSettings.mockResolvedValue({
        success: true,
        data: {
          ...DEFAULT_APP_SETTINGS,
          defaultMethodology: 'bmad',
          onboardingCompleted: true
        }
      });

      await loadSettings();

      expect(useSettingsStore.getState().settings.defaultMethodology).toBe('bmad');
    });

    it('should persist native methodology and reload correctly', async () => {
      mockSaveSettings.mockResolvedValue({ success: true });
      await saveSettings({ defaultMethodology: 'native' });

      mockGetSettings.mockResolvedValue({
        success: true,
        data: {
          ...DEFAULT_APP_SETTINGS,
          defaultMethodology: 'native',
          onboardingCompleted: true
        }
      });

      await loadSettings();

      expect(useSettingsStore.getState().settings.defaultMethodology).toBe('native');
    });
  });
});
