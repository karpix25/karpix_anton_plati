import React, { useEffect, useMemo } from "react";
import { HeygenAvatarConfig, Voice, Settings, HeygenLookConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { HeygenLookItem } from "./HeygenLookItem";
import {
  DEFAULT_MINIMAX_VOICE_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "../SettingsConstants";
import { getMotionIndicator } from "../SettingsUtils";

interface HeygenAvatarItemProps {
  avatar: HeygenAvatarConfig;
  avatarIndex: number;
  isExpanded: boolean;
  selectedClientId: string | null;
  minimaxVoices: Voice[];
  elevenlabsVoices: Voice[];
  draftSettings: Settings;
  selectedLookTabs: Record<string, string>;
  motionLookRequestKey: string | null;
  motionPromptRequestKey: string | null;
  updateAvatar: (avatarIndex: number, field: keyof HeygenAvatarConfig, value: string | number | boolean) => void;
  toggleAvatarPanel: (avatar: HeygenAvatarConfig, avatarIndex: number) => void;
  updateLook: (avatarIndex: number, lookIndex: number, field: "look_id" | "look_name" | "preview_image_url" | "is_active", value: string | boolean) => void;
  updateLookMotionField: (avatarIndex: number, lookIndex: number, field: "motion_prompt" | "motion_type", value: string) => void;
  addLook: (avatarIndex: number) => void;
  removeLook: (avatarIndex: number, lookIndex: number) => void;
  removeAvatar: (avatarIndex: number) => void;
  handleGenerateLookMotion: (avatarIndex: number, lookIndex: number) => void;
  handleGenerateMotionPrompt: (avatarIndex: number, lookIndex: number) => void;
  setSelectedLookTabs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export const HeygenAvatarItem: React.FC<HeygenAvatarItemProps> = ({
  avatar,
  avatarIndex,
  isExpanded,
  selectedClientId,
  minimaxVoices,
  elevenlabsVoices,
  draftSettings,
  selectedLookTabs,
  motionLookRequestKey,
  motionPromptRequestKey,
  updateAvatar,
  toggleAvatarPanel,
  updateLook,
  updateLookMotionField,
  addLook,
  removeLook,
  removeAvatar,
  handleGenerateLookMotion,
  handleGenerateMotionPrompt,
  setSelectedLookTabs,
}) => {
  const activeLooksCount = avatar.looks.filter((l) => l.is_active ?? true).length;
  const motionReadyLooksCount = avatar.looks.filter((look) => getMotionIndicator(look.motion_look_id, look.motion_status).tone === "ready").length;
  const motionPendingLooksCount = avatar.looks.filter((look) => getMotionIndicator(look.motion_look_id, look.motion_status).tone === "pending").length;

  // Diagnostic warning for developer
  useEffect(() => {
    if (avatar.tts_provider === 'elevenlabs') {
      const isFallback = elevenlabsVoices.length === 1 && elevenlabsVoices[0]?.voice_id === DEFAULT_ELEVENLABS_VOICE_ID;
      if (isFallback) {
         console.warn(`[ElevenLabs] Only one voice (fallback) is available. Check your ELEVENLABS_API_KEY if you expect more voices.`);
      }
    }
  }, [avatar.tts_provider, elevenlabsVoices]);
  const selectedLookIndex = parseInt(selectedLookTabs[avatarIndex] || "0", 10);
  const avatarTtsProvider = avatar.tts_provider || "minimax";
  const currentVoiceId = avatarTtsProvider === "minimax" 
    ? (avatar.tts_voice_id || DEFAULT_MINIMAX_VOICE_ID)
    : (avatar.elevenlabs_voice_id || DEFAULT_ELEVENLABS_VOICE_ID);

  const availableVoices = useMemo(() => {
    return avatarTtsProvider === 'minimax' ? minimaxVoices : elevenlabsVoices;
  }, [avatarTtsProvider, minimaxVoices, elevenlabsVoices]);

  const isCustomId = useMemo(() => {
    return currentVoiceId && !availableVoices.some((v: Voice) => v.voice_id === currentVoiceId);
  }, [currentVoiceId, availableVoices]);

  return (
    <div className={`rounded-2xl border transition-all duration-300 ${avatar.is_active ? "border-primary/20 bg-white shadow-sm ring-1 ring-primary/5" : "border-[#e5ebf0] bg-[#fbfcfd]"}`}>
      {/* Header / Summary Card */}
      <div className="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
        <button
          type="button"
          onClick={() => toggleAvatarPanel(avatar, avatarIndex)}
          className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left group"
        >
          <div className="flex min-w-0 items-center gap-4">
            <div className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border transition-transform group-hover:scale-105 ${avatar.is_active ? "border-primary shadow-md" : "border-[#e5ebf0]"}`}>
              {avatar.preview_image_url ? (
                <img
                  src={avatar.preview_image_url}
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                  alt=""
                />
              ) : (
                <div className="h-full w-full bg-slate-100 flex items-center justify-center text-[10px] text-slate-400">N/A</div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-black/40 p-0.5 text-center text-[8px] font-black uppercase tracking-tighter text-white">
                {avatar.is_active ? "Active" : "Paused"}
              </div>
            </div>
            
            <div className="min-w-0">
               <div className="truncate text-sm font-black text-foreground uppercase tracking-tight">
                  {avatar.avatar_name || avatar.avatar_id || `Avatar ${avatarIndex + 1}`}
               </div>
               <div className="mt-1 flex flex-wrap items-center gap-2">
                 <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${avatar.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    {avatar.is_active ? "On" : "Off"}
                 </span>
                 <span className="rounded-full bg-slate-50 border border-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
                    Looks: {avatar.looks.length} ({activeLooksCount} active)
                 </span>
                 <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                   motionReadyLooksCount > 0
                     ? "bg-emerald-50 text-emerald-600"
                     : "bg-slate-100 text-slate-500"
                 }`}>
                    Motion: {motionReadyLooksCount}/{avatar.looks.length}
                 </span>
                 {motionPendingLooksCount > 0 && (
                   <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-700">
                      Pending: {motionPendingLooksCount}
                   </span>
                 )}
               </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-primary transition-colors">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </button>

        <div className="flex items-center gap-2">
           <button
              type="button"
              onClick={() => updateAvatar(avatarIndex, "is_active", !(avatar.is_active ?? true))}
              className={`p-2 rounded-xl transition-colors ${avatar.is_active ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
              title={avatar.is_active ? "Pause Avatar" : "Activate Avatar"}
           >
              {avatar.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
           </button>
        </div>
      </div>

      {/* Expanded Panel */}
      {isExpanded && (
        <div className="border-t border-slate-100 p-6 space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="grid gap-8 lg:grid-cols-[180px_1fr]">
             <div className="space-y-4">
                <div className="aspect-square w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-inner">
                   {avatar.preview_image_url ? (
                      <img src={avatar.preview_image_url} className="h-full w-full object-cover" referrerPolicy="no-referrer" alt="" />
                   ) : (
                      <div className="h-full flex items-center justify-center text-xs text-slate-400 font-bold uppercase">Нет превью</div>
                   )}
                </div>
                <Button 
                   variant="outline" 
                   size="sm" 
                   className="w-full text-rose-500 border-rose-100 hover:bg-rose-50 font-bold uppercase tracking-widest text-[10px]"
                   onClick={() => removeAvatar(avatarIndex)}
                >
                   <Trash2 className="h-3.5 w-3.5 mr-2" />
                   Delete Avatar
                </Button>
             </div>

             <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Внутреннее имя</label>
                      <input
                        value={avatar.avatar_name}
                        onChange={(e) => updateAvatar(avatarIndex, "avatar_name", e.target.value)}
                        className="w-full rounded-xl border-none bg-slate-100 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/10 transition-shadow"
                        placeholder="e.g. Finance Host"
                      />
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">ID аватара HeyGen</label>
                      <input
                        value={avatar.avatar_id}
                        onChange={(e) => updateAvatar(avatarIndex, "avatar_id", e.target.value)}
                        className="w-full rounded-xl border-none bg-slate-100 px-4 py-3 text-xs font-mono outline-none focus:ring-2 focus:ring-primary/10 transition-shadow"
                      />
                   </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Провайдер</label>
                      <Select
                        value={avatarTtsProvider}
                        onValueChange={(val: "minimax" | "elevenlabs") => updateAvatar(avatarIndex, "tts_provider", val)}
                      >
                        <SelectTrigger className="h-11 w-full rounded-xl border-none bg-slate-100 px-4 text-sm font-bold">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                           <SelectItem value="minimax">MiniMax (Dynamic)</SelectItem>
                           <SelectItem value="elevenlabs">ElevenLabs v3</SelectItem>
                         </SelectContent>
                      </Select>
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Пол диктора</label>
                      <Select
                        value={avatar.gender || "female"}
                        onValueChange={(val: "male" | "female") => updateAvatar(avatarIndex, "gender", val)}
                      >
                         <SelectTrigger className="h-11 w-full rounded-xl border-none bg-slate-100 px-4 text-sm font-bold">
                            <SelectValue />
                         </SelectTrigger>
                         <SelectContent>
                            <SelectItem value="female">Женский</SelectItem>
                            <SelectItem value="male">Мужской</SelectItem>
                         </SelectContent>
                      </Select>
                   </div>
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">ID Голоса</label>
                      <div className="flex flex-col gap-2">
                        <Select
                          value={isCustomId ? "custom" : currentVoiceId}
                          onValueChange={(val) => {
                            updateAvatar(avatarIndex, avatarTtsProvider === 'minimax' ? 'tts_voice_id' : 'elevenlabs_voice_id', val);
                          }}
                        >
                           <SelectTrigger className="h-11 w-full rounded-xl border-none bg-slate-100 px-4 text-sm font-bold">
                              <SelectValue placeholder="Выберите голос" />
                           </SelectTrigger>
                           <SelectContent className="max-h-80">
                              <SelectItem value="custom" className="font-bold text-primary italic">
                                 [+] Ввести ID вручную...
                              </SelectItem>
                              {avatarTtsProvider === 'minimax' ? (
                                 minimaxVoices.map(v => <SelectItem key={v.voice_id} value={v.voice_id}>{v.voice_name}</SelectItem>)
                              ) : (
                                 elevenlabsVoices.map(v => <SelectItem key={v.voice_id} value={v.voice_id}>{v.name}</SelectItem>)
                              )}
                           </SelectContent>
                        </Select>
                        
                        {isCustomId && (
                           <div className="space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
                             <input
                                value={currentVoiceId === "custom" ? "" : currentVoiceId}
                                onChange={(e) => updateAvatar(avatarIndex, avatarTtsProvider === 'minimax' ? 'tts_voice_id' : 'elevenlabs_voice_id', e.target.value.trim())}
                                className="w-full rounded-xl border-none bg-slate-100 px-4 py-2.5 text-xs font-mono outline-none ring-2 ring-primary/20 focus:ring-primary/40 transition-shadow"
                                placeholder="Вставьте ID голоса здесь..."
                             />
                             <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest px-1">
                                Активен ручной ввод ID
                             </p>
                           </div>
                        )}
                      </div>
                    </div>
                </div>
             </div>
          </div>

          <div className="space-y-6 pt-4">
             <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="space-y-1">
                   <h4 className="text-sm font-black uppercase tracking-widest text-foreground">Настроенные образы (Looks)</h4>
                   <p className="text-[11px] text-muted-foreground font-medium">Inside this avatar, one active look will be picked randomly for each video.</p>
                </div>
                <Button 
                   onClick={() => addLook(avatarIndex)} 
                   size="sm" 
                   className="rounded-full bg-primary/10 text-primary hover:bg-primary/20 shadow-none border-none font-bold text-[10px] uppercase tracking-widest h-8"
                >
                   <Plus className="h-3.5 w-3.5 mr-1" />
                   Add Look
                </Button>
             </div>

             <div className="space-y-4">
                {avatar.looks.length > 0 ? (
                  avatar.looks.map((look, lookIdx) => (
                    <HeygenLookItem
                      key={look.id || `look-${lookIdx}`}
                      avatar={avatar}
                      look={look}
                      avatarIndex={avatarIndex}
                      lookIndex={lookIdx}
                      isSelected={selectedLookIndex === lookIdx}
                      motionLookRequestKey={motionLookRequestKey}
                      motionPromptRequestKey={motionPromptRequestKey}
                      selectedClientId={selectedClientId}
                      updateLook={updateLook}
                      updateLookMotionField={updateLookMotionField}
                      removeLook={removeLook}
                      handleGenerateLookMotion={handleGenerateLookMotion}
                      handleGenerateMotionPrompt={handleGenerateMotionPrompt}
                      onSelect={() => setSelectedLookTabs(prev => ({ ...prev, [avatarIndex]: lookIdx.toString() }))}
                    />
                  ))
                ) : (
                  <div className="rounded-2xl border-2 border-dashed border-slate-100 p-8 text-center text-xs font-medium text-slate-400">
                    No looks configured for this avatar yet.
                  </div>
                )}
             </div>
          </div>
        </div>
      )}
    </div>
  );
};
