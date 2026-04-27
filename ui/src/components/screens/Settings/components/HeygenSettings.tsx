import React from "react";
import { HeygenAvatarConfig, Voice, Settings } from "@/types";
import { Button } from "@/components/ui/button";
import { LoaderCircle, Plus, Shuffle } from "lucide-react";
import { HeygenAvatarItem } from "./HeygenAvatarItem";
import { getAvatarConfigKey } from "../SettingsUtils";

interface HeygenSettingsProps {
  avatarConfigs: HeygenAvatarConfig[];
  selectedClientId: string | null;
  minimaxVoices: Voice[];
  elevenlabsVoices: Voice[];
  heygenCatalog: HeygenAvatarConfig[];
  expandedAvatarPanels: Record<string, boolean>;
  selectedLookTabs: Record<string, string>;
  isRefreshingHeygenCatalog: boolean;
  isSavingHeygenAvatars: boolean;
  motionLookRequestKey: string | null;
  motionPromptRequestKey: string | null;
  draftSettings: Settings;
  onRefreshHeygenCatalog?: () => Promise<HeygenAvatarConfig[]>;
  updateAvatar: (avatarIndex: number, field: keyof HeygenAvatarConfig, value: string | number | boolean) => void;
  toggleAvatarPanel: (avatar: HeygenAvatarConfig, avatarIndex: number) => void;
  updateLook: (avatarIndex: number, lookIndex: number, field: "look_id" | "look_name" | "preview_image_url" | "is_active", value: string | boolean) => void;
  updateLookMotionField: (avatarIndex: number, lookIndex: number, field: "motion_prompt" | "motion_type", value: string) => void;
  addAvatar: () => void;
  removeAvatar: (avatarIndex: number) => void;
  addLook: (avatarIndex: number) => void;
  removeLook: (avatarIndex: number, lookIndex: number) => void;
  handleSaveHeygen: () => void;
  handleImportFromHeygen: () => void;
  handleGenerateLookMotion: (avatarIndex: number, lookIndex: number) => void;
  handleGenerateMotionPrompt: (avatarIndex: number, lookIndex: number) => void;
  setSelectedLookTabs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export const HeygenSettings: React.FC<HeygenSettingsProps> = ({
  avatarConfigs,
  selectedClientId,
  minimaxVoices,
  elevenlabsVoices,
  heygenCatalog,
  expandedAvatarPanels,
  selectedLookTabs,
  isRefreshingHeygenCatalog,
  isSavingHeygenAvatars,
  motionLookRequestKey,
  motionPromptRequestKey,
  draftSettings,
  onRefreshHeygenCatalog,
  updateAvatar,
  toggleAvatarPanel,
  updateLook,
  updateLookMotionField,
  addAvatar,
  removeAvatar,
  addLook,
  removeLook,
  handleSaveHeygen,
  handleImportFromHeygen,
  handleGenerateLookMotion,
  handleGenerateMotionPrompt,
  setSelectedLookTabs,
}) => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
        <div className="max-w-2xl space-y-2">
          <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            HeyGen Pool
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Управляйте пулом персонажей. Система автоматически чередует аватаров при генерации, выбирая случайный активный образ внутри каждого.
          </p>
          <p className="text-[11px] font-medium text-slate-400 italic">
            Вы можете импортировать актуальные группы и образы напрямую из вашего HeyGen аккаунта.
          </p>
        </div>
        
        <div className="flex shrink-0 flex-col gap-3 w-full xl:w-64">
           <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl bg-white font-bold text-slate-600 border-[#e5ebf0] hover:bg-slate-50 text-xs uppercase tracking-widest shadow-sm"
              onClick={handleImportFromHeygen}
              disabled={isRefreshingHeygenCatalog || (!heygenCatalog.length && !onRefreshHeygenCatalog)}
            >
              {isRefreshingHeygenCatalog ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Shuffle className="mr-2 h-4 w-4" />
              )}
              {isRefreshingHeygenCatalog ? "Синхронизация..." : "Импорт из HeyGen"}
            </Button>
            <Button 
               type="button" 
               variant="secondary" 
               className="h-11 rounded-xl text-xs font-black uppercase tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 shadow-sm"
               onClick={addAvatar}
            >
               <Plus className="mr-2 h-4 w-4" />
               Добавить аватара
            </Button>
        </div>
      </div>

      <div className="space-y-4">
        {avatarConfigs.map((avatar, idx) => {
          const panelKey = getAvatarConfigKey(avatar, idx);
          const legacyKeys = [
            String(idx),
            avatar.id ? `id:${avatar.id}` : "",
            avatar.avatar_id ? `avatar:${avatar.avatar_id}` : "",
            `index:${idx}`,
          ].filter(Boolean);
          const isExpanded = legacyKeys.some((key) => expandedAvatarPanels[key]) || false;

          return (
          <HeygenAvatarItem
            key={panelKey}
            avatar={avatar}
            avatarIndex={idx}
            isExpanded={isExpanded}
            selectedClientId={selectedClientId}
            minimaxVoices={minimaxVoices}
            elevenlabsVoices={elevenlabsVoices}
            draftSettings={draftSettings}
            selectedLookTabs={selectedLookTabs}
            motionLookRequestKey={motionLookRequestKey}
            motionPromptRequestKey={motionPromptRequestKey}
            updateAvatar={updateAvatar}
            toggleAvatarPanel={toggleAvatarPanel}
            updateLook={updateLook}
            updateLookMotionField={updateLookMotionField}
            addLook={addLook}
            removeLook={removeLook}
            removeAvatar={removeAvatar}
            handleGenerateLookMotion={handleGenerateLookMotion}
            handleGenerateMotionPrompt={handleGenerateMotionPrompt}
            setSelectedLookTabs={setSelectedLookTabs}
          />
          );
        })}
      </div>

    </div>
  );
};
