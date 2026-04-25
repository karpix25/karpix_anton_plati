import React, { useState } from "react";
import { HeygenAvatarConfig, Settings, Voice } from "@/types";
import { useSettingsState } from "./useSettingsState";
import { BrandingSettings } from "./components/BrandingSettings";
import { SubtitleSettings } from "./components/SubtitleSettings";
import { AutomationSettings } from "./components/AutomationSettings";
import { VideoLogicSettings } from "./components/VideoLogicSettings";
import { SilenceHandlingSettings } from "./components/SilenceHandlingSettings";
import { PronunciationSettings } from "./components/PronunciationSettings";
import { PromptEvolutionSettings } from "./components/PromptEvolutionSettings";
import { HeygenSettings } from "./components/HeygenSettings";
import { Button } from "@/components/ui/button";
import { 
  LoaderCircle, 
  LayoutDashboard, 
  Type, 
  Zap, 
  Video, 
  BrainCircuit, 
  Users, 
  Save, 
  Trash2,
  AlertCircle,
  CloudCheck,
  CloudUpload
} from "lucide-react";

interface SettingsScreenProps {
  settings: Settings;
  avatarConfigs: HeygenAvatarConfig[];
  selectedClientId: string | null;
  minimaxVoices: Voice[];
  elevenlabsVoices: Voice[];
  heygenCatalog: HeygenAvatarConfig[];
  onSave: (settings: Settings) => void;
  onSaveHeygenAvatars: (avatars: HeygenAvatarConfig[]) => void;
  onDeleteProject: () => void;
  canDeleteProject: boolean;
  onRefreshHeygenCatalog?: () => Promise<HeygenAvatarConfig[]>;
  onRefreshWorkspace?: () => void;
  isSaving: boolean;
  isSavingHeygenAvatars: boolean;
  isDeletingProject: boolean;
}

const SettingsScreen: React.FC<SettingsScreenProps> = (props) => {
  const [activeTab, setActiveTab] = useState<"branding" | "subtitles" | "automation" | "logic" | "evolution" | "heygen">("branding");
  
  const state = useSettingsState(props);

  const tabs = [
    { id: "branding", label: "Брендинг", icon: LayoutDashboard },
    { id: "subtitles", label: "Субтитры", icon: Type },
    { id: "automation", label: "Автоматика", icon: Zap },
    { id: "logic", label: "Логика видео", icon: Video },
    { id: "evolution", label: "AI Эволюция", icon: BrainCircuit },
    { id: "heygen", label: "HeyGen Pool", icon: Users },
  ] as const;

  return (
    <div className="flex h-full flex-col bg-[#f0f4f7]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[#e5ebf0] bg-white/80 px-8 py-4 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tight text-foreground uppercase italicLine">
              Контент машина
            </h1>
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
              Настройки проекта: {props.selectedClientId || "Unselected"}
            </p>
          </div>
          
          <div className="flex items-center gap-3">
             {props.canDeleteProject ? (
                <>
                  <Button
                    variant="ghost"
                    className="h-11 rounded-xl px-4 text-xs font-black uppercase tracking-widest text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition-all"
                    onClick={state.handleDeleteProject}
                    disabled={props.isDeletingProject}
                  >
                    {props.isDeletingProject ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Удалить проект
                  </Button>

                  <div className="mx-2 h-8 w-px bg-[#e5ebf0]" />
                </>
              ) : null}

              <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-50 border border-slate-100 shadow-inner min-w-[140px] justify-center transition-all duration-300">
                {props.isSaving || props.isSavingHeygenAvatars ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Сохранение...
                    </span>
                  </>
                ) : (
                  <>
                    <CloudCheck className="h-4 w-4 text-emerald-500" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">
                      Сохранено
                    </span>
                  </>
                )}
              </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Navigation Sidebar */}
        <aside className="w-80 overflow-y-auto border-r border-[#e5ebf0] bg-white/40 p-6">
           <nav className="space-y-2">
             <div className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-4">Основные разделы</div>
             {tabs.map((tab) => {
               const Icon = tab.icon;
               const isActive = activeTab === tab.id;
               return (
                 <button
                   key={tab.id}
                   onClick={() => setActiveTab(tab.id)}
                   className={`flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-sm font-bold uppercase tracking-wider transition-all ${
                     isActive 
                       ? "bg-white text-primary shadow-md ring-1 ring-primary/5 translate-x-1" 
                       : "text-slate-500 hover:bg-white/60 hover:text-slate-700"
                   }`}
                 >
                   <Icon className={`h-5 w-5 ${isActive ? 'text-primary' : 'text-slate-400'}`} />
                   {tab.label}
                 </button>
               );
             })}
           </nav>

           <div className="mt-12 space-y-6 px-4">
              <div className="rounded-2xl bg-indigo-50/50 p-5 border border-indigo-100">
                 <div className="flex items-center gap-2 text-indigo-600 mb-2">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Совет</span>
                 </div>
                 <p className="text-[11px] leading-relaxed text-indigo-700/80 font-medium">
                    Используйте HeyGen Pool для автоматической ротации аватаров. Это сделает вашу ленту более живой и разнообразной.
                 </p>
              </div>

              <div className="text-center">
                 <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-300">Plati AI v2.4</p>
              </div>
           </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto bg-slate-50/50 p-8 pt-6">
          <div className="mx-auto max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
             {activeTab === "branding" && (
                <div className="space-y-8">
                  <header>
                    <h2 className="text-2xl font-black text-foreground uppercase italic tracking-tight">Брендинг и Продукт</h2>
                    <p className="text-sm text-slate-500 font-medium mt-1">Определите голос вашего бренда и загрузите медиа-ассеты.</p>
                  </header>
                  <BrandingSettings 
                    draftSettings={state.draftSettings}
                    setDraftSettings={state.setDraftSettings}
                    isUploadingProductVideo={state.isUploadingProductVideo}
                    selectedClientId={props.selectedClientId}
                    handleProductVideoUpload={state.handleProductVideoUpload}
                    handleRemoveProductAsset={state.handleRemoveProductAsset}
                  />
                </div>
             )}

             {activeTab === "subtitles" && (
                <div className="space-y-8">
                  <header>
                    <h2 className="text-2xl font-black text-foreground uppercase italic tracking-tight">Оформление субтитров</h2>
                    <p className="text-sm text-slate-500 font-medium mt-1">Настройте типографику и визуальный стиль наложений.</p>
                  </header>
                  <SubtitleSettings 
                    draftSettings={state.draftSettings}
                    setDraftSettings={state.setDraftSettings}
                    subtitlePreviewRef={state.subtitlePreviewRef}
                    subtitlePreviewScale={state.subtitlePreviewScale}
                  />
                </div>
             )}

             {activeTab === "automation" && (
                <div className="space-y-8">
                  <header>
                    <h2 className="text-2xl font-black text-foreground uppercase italic tracking-tight">Лимиты и Автоматизация</h2>
                    <p className="text-sm text-slate-500 font-medium mt-1">Управляйте пайплайном автоматической генерации видео.</p>
                  </header>
                  <AutomationSettings 
                    draftSettings={state.draftSettings}
                    setDraftSettings={state.setDraftSettings}
                    isManualFinalRunPending={state.isManualFinalRunPending}
                    onManualFinalRun={state.handleManualFinalAutomationRun}
                  />
                </div>
             )}

             {activeTab === "logic" && (
                <div className="space-y-8">
                  <header>
                    <h2 className="text-2xl font-black text-foreground uppercase italic tracking-tight">Логика монтажа</h2>
                    <p className="text-sm text-slate-500 font-medium mt-1">Настройте частоту и приоритеты использования перебивок.</p>
                  </header>
                  <VideoLogicSettings 
                    draftSettings={state.draftSettings}
                    setDraftSettings={state.setDraftSettings}
                  />
                  <SilenceHandlingSettings
                    draftSettings={state.draftSettings}
                    setDraftSettings={state.setDraftSettings}
                  />
                  <PronunciationSettings
                    draftSettings={state.draftSettings}
                    setDraftSettings={state.setDraftSettings}
                  />
                </div>
             )}

             {activeTab === "evolution" && (
                <div className="space-y-8">
                  <header>
                    <h2 className="text-2xl font-black text-foreground uppercase italic tracking-tight">AI Эволюция</h2>
                    <p className="text-sm text-slate-500 font-medium mt-1">Самообучаемая система правил на основе обратной связи.</p>
                  </header>
                  <PromptEvolutionSettings 
                    draftSettings={state.draftSettings}
                    selectedClientId={props.selectedClientId}
                    optimizingCategory={state.optimizingCategory}
                    handleOptimizePrompts={state.handleOptimizePrompts}
                    onRollbackPrompt={state.handleRollbackPrompt}
                  />
                </div>
             )}

             {activeTab === "heygen" && (
                <div className="space-y-8">
                  <header>
                    <h2 className="text-2xl font-black text-foreground uppercase italic tracking-tight">HeyGen Pool</h2>
                    <p className="text-sm text-slate-500 font-medium mt-1">Настройка аватаров, их движений и голосов озвучки.</p>
                  </header>
                  <HeygenSettings 
                    avatarConfigs={state.avatarConfigs}
                    selectedClientId={props.selectedClientId}
                    minimaxVoices={props.minimaxVoices}
                    elevenlabsVoices={props.elevenlabsVoices}
                    heygenCatalog={props.heygenCatalog}
                    expandedAvatarPanels={state.expandedAvatarPanels}
                    selectedLookTabs={state.selectedLookTabs}
                    isRefreshingHeygenCatalog={state.isRefreshingHeygenCatalog}
                    isSavingHeygenAvatars={props.isSavingHeygenAvatars}
                    motionLookRequestKey={state.motionLookRequestKey}
                    motionPromptRequestKey={state.motionPromptRequestKey}
                    draftSettings={state.draftSettings}
                    onRefreshHeygenCatalog={props.onRefreshHeygenCatalog}
                    updateAvatar={state.updateAvatar}
                    toggleAvatarPanel={state.toggleAvatarPanel}
                    updateLook={state.updateLook}
                    updateLookMotionField={state.updateLookMotionField}
                    addAvatar={state.addAvatar}
                    removeAvatar={state.removeAvatar}
                    addLook={state.addLook}
                    removeLook={state.removeLook}
                    handleSaveHeygen={state.handleSaveHeygen}
                    handleImportFromHeygen={state.handleImportFromHeygen}
                    handleGenerateLookMotion={state.handleGenerateLookMotion}
                    handleGenerateMotionPrompt={state.handleGenerateMotionPrompt}
                    setSelectedLookTabs={state.setSelectedLookTabs}
                  />
                </div>
             )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default SettingsScreen;
