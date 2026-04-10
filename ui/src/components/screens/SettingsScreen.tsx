import React from "react";
import SettingsSubsystem from "./Settings";
import { HeygenAvatarConfig, Settings, Voice } from "@/types";

interface SettingsScreenProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onDeleteProject: () => void;
  isSaving: boolean;
  isDeletingProject: boolean;
  selectedClientId: string;
  heygenAvatars: HeygenAvatarConfig[];
  heygenCatalog: HeygenAvatarConfig[];
  minimaxVoices: Voice[];
  elevenlabsVoices: Voice[];
  onSaveHeygenAvatars: (avatars: HeygenAvatarConfig[]) => void;
  onRefreshHeygenCatalog?: () => Promise<HeygenAvatarConfig[]>;
  onRefreshWorkspace?: () => void;
  isSavingHeygenAvatars: boolean;
}

/**
 * SettingsScreen re-export component.
 * This file acts as a compatibility layer for the modularized settings implementation.
 */
export function SettingsScreen({
  settings,
  onSave,
  onDeleteProject,
  isSaving,
  isDeletingProject,
  selectedClientId,
  heygenAvatars,
  heygenCatalog,
  minimaxVoices,
  elevenlabsVoices,
  onSaveHeygenAvatars,
  onRefreshHeygenCatalog,
  onRefreshWorkspace,
  isSavingHeygenAvatars,
}: SettingsScreenProps) {
  return (
    <SettingsSubsystem
      settings={settings}
      avatarConfigs={heygenAvatars}
      selectedClientId={selectedClientId}
      minimaxVoices={minimaxVoices}
      elevenlabsVoices={elevenlabsVoices}
      heygenCatalog={heygenCatalog}
      onSave={onSave}
      onSaveHeygenAvatars={onSaveHeygenAvatars}
      onDeleteProject={onDeleteProject}
      onRefreshHeygenCatalog={onRefreshHeygenCatalog}
      onRefreshWorkspace={onRefreshWorkspace}
      isSaving={isSaving}
      isSavingHeygenAvatars={isSavingHeygenAvatars}
      isDeletingProject={isDeletingProject}
    />
  );
}
