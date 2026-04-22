import React from "react";
import { HeygenAvatarConfig, HeygenLookConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoaderCircle, Trash2, Wand2, Eye, EyeOff } from "lucide-react";
import {
  DEFAULT_HEYGEN_MOTION_PROMPT,
  DEFAULT_HEYGEN_MOTION_TYPE,
  HEYGEN_MOTION_PROMPT_MAX_LENGTH,
  HEYGEN_MOTION_TYPE_OPTIONS,
} from "../SettingsConstants";
import { getMotionIndicator, isPendingMotionStatus } from "../SettingsUtils";

interface HeygenLookItemProps {
  avatar: HeygenAvatarConfig;
  look: HeygenLookConfig;
  avatarIndex: number;
  lookIndex: number;
  isSelected: boolean;
  motionLookRequestKey: string | null;
  motionPromptRequestKey: string | null;
  selectedClientId: string | null;
  updateLook: (avatarIndex: number, lookIndex: number, field: "look_id" | "look_name" | "preview_image_url" | "is_active", value: string | boolean) => void;
  updateLookMotionField: (avatarIndex: number, lookIndex: number, field: "motion_prompt" | "motion_type", value: string) => void;
  removeLook: (avatarIndex: number, lookIndex: number) => void;
  handleGenerateLookMotion: (avatarIndex: number, lookIndex: number) => void;
  handleGenerateMotionPrompt: (avatarIndex: number, lookIndex: number) => void;
  onSelect: () => void;
}

export const HeygenLookItem: React.FC<HeygenLookItemProps> = ({
  avatar,
  look,
  avatarIndex,
  lookIndex,
  isSelected,
  motionLookRequestKey,
  motionPromptRequestKey,
  selectedClientId,
  updateLook,
  updateLookMotionField,
  removeLook,
  handleGenerateLookMotion,
  handleGenerateMotionPrompt,
  onSelect,
}) => {
  const motionIndicator = getMotionIndicator(look.motion_look_id, look.motion_status);

  return (
    <div className={`space-y-4 rounded-2xl border bg-white p-4 transition-all ${isSelected ? "border-primary shadow-lg ring-1 ring-primary/20" : "border-[#e5ebf0] opacity-90 hover:opacity-100"}`}>
       <div className="grid gap-4 md:grid-cols-[120px_1fr_1fr_1fr_auto]">
          <div className="relative group aspect-[9/16] h-[160px] md:h-[120px] mx-auto md:mx-0 overflow-hidden rounded-xl border border-[#e5ebf0] bg-slate-100">
             {look.preview_image_url ? (
               <img
                 src={look.preview_image_url}
                 alt={look.look_name || look.look_id}
                 className="h-full w-full object-cover"
                 referrerPolicy="no-referrer"
               />
             ) : (
               <div className="flex h-full items-center justify-center p-2 text-center text-[10px] font-bold uppercase text-slate-400">
                 Нет превью
               </div>
             )}
             <button
                type="button"
                onClick={() => updateLook(avatarIndex, lookIndex, "is_active", !(look.is_active ?? true))}
                className={`absolute right-2 top-2 rounded-full p-2 shadow-md transition-transform active:scale-95 ${
                  look.is_active ? "bg-white text-primary" : "bg-black/60 text-white"
                }`}
                title={look.is_active ? "Выключить образ" : "Включить образ"}
              >
                {look.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
              <div
                className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest shadow-sm ${
                  motionIndicator.tone === "ready"
                    ? "bg-emerald-100 text-emerald-700"
                    : motionIndicator.tone === "pending"
                      ? "bg-amber-100 text-amber-700"
                      : motionIndicator.tone === "failed"
                        ? "bg-rose-100 text-rose-700"
                        : "bg-slate-100 text-slate-600"
                }`}
              >
                {motionIndicator.label}
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-[9px] font-black uppercase tracking-widest text-white text-center">
                 {look.is_active ? "Live" : "Inactive"}
              </div>
          </div>

          <div className="space-y-3 flex flex-col justify-center">
             <div className="space-y-1">
               <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Название</label>
               <input
                 value={look.look_name}
                 onChange={(e) => updateLook(avatarIndex, lookIndex, "look_name", e.target.value)}
                 className="w-full rounded-lg border-none bg-slate-100 px-3 py-2 text-sm font-bold text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                 placeholder="Main Outfit"
               />
             </div>
             <div className="space-y-1">
               <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">ID</label>
               <input
                 value={look.look_id}
                 onChange={(e) => updateLook(avatarIndex, lookIndex, "look_id", e.target.value)}
                 className="w-full rounded-lg border-none bg-slate-100 px-3 py-2 text-xs font-mono text-slate-600 outline-none focus:ring-2 focus:ring-primary/10"
                 placeholder="look_id"
               />
             </div>
          </div>

          <div className="space-y-3 flex flex-col justify-center">
             <div className="space-y-1">
               <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Preview URL</label>
               <input
                 value={look.preview_image_url || ""}
                 onChange={(e) => updateLook(avatarIndex, lookIndex, "preview_image_url", e.target.value)}
                 className="w-full rounded-lg border-none bg-slate-100 px-3 py-2 text-[11px] text-slate-500 outline-none focus:ring-2 focus:ring-primary/10"
                 placeholder="https://..."
               />
             </div>
             <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Motion Type</label>
                <Select
                  value={look.motion_type || DEFAULT_HEYGEN_MOTION_TYPE}
                  onValueChange={(val) => updateLookMotionField(avatarIndex, lookIndex, "motion_type", val)}
                >
                  <SelectTrigger className="h-9 w-full rounded-lg border-none bg-slate-100 px-3 text-xs font-bold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HEYGEN_MOTION_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
             </div>
          </div>

          <div className="space-y-1 flex flex-col justify-center">
            <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Motion Prompt</label>
            <div className="relative flex-1">
              <textarea
                value={look.motion_prompt || DEFAULT_HEYGEN_MOTION_PROMPT}
                onChange={(e) => updateLookMotionField(avatarIndex, lookIndex, "motion_prompt", e.target.value)}
                className="h-full w-full rounded-xl border-none bg-slate-100 px-3 py-2 text-xs text-slate-600 outline-none focus:ring-2 focus:ring-primary/10 resize-none min-h-[80px]"
                maxLength={HEYGEN_MOTION_PROMPT_MAX_LENGTH}
              />
              <div className="absolute bottom-1 right-2 text-[8px] font-bold text-slate-400">
                {(look.motion_prompt || "").length}/{HEYGEN_MOTION_PROMPT_MAX_LENGTH}
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-2 py-1">
             <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-full"
                onClick={() => removeLook(avatarIndex, lookIndex)}
              >
                <Trash2 className="h-4 w-4" />
             </Button>
             {!isSelected && (
                <Button 
                   type="button" 
                   variant="outline" 
                   size="sm" 
                   className="text-[10px] font-black uppercase tracking-widest"
                   onClick={onSelect}
                >
                  Edit
                </Button>
             )}
          </div>
       </div>

       <div className="flex items-center gap-2 border-t border-slate-100 pt-3 text-[10px] font-black uppercase tracking-widest text-foreground">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              motionIndicator.tone === "ready"
                ? "bg-emerald-500"
                : motionIndicator.tone === "pending"
                  ? "bg-amber-400"
                  : motionIndicator.tone === "failed"
                    ? "bg-rose-500"
                    : "bg-slate-300"
            }`}
          />
          {motionIndicator.label}
          {look.motion_status ? ` (${look.motion_status})` : ""}
       </div>

       {isSelected && (
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
            <div className="space-y-1">
                 <div className="text-[10px] font-black uppercase tracking-widest text-foreground">Motion Actions</div>
                 {look.motion_error && <p className="text-[10px] text-rose-500 font-bold">{look.motion_error}</p>}
                 {look.motion_look_id && <p className="text-[9px] font-mono text-slate-400">ID: {look.motion_look_id}</p>}
            </div>

            <div className="flex gap-2">
               <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-9 px-4 rounded-lg text-xs font-bold"
                  onClick={() => handleGenerateMotionPrompt(avatarIndex, lookIndex)}
                  disabled={motionPromptRequestKey === `${avatar.id || avatarIndex}-${look.id || lookIndex}-prompt`}
                >
                  {motionPromptRequestKey === `${avatar.id || avatarIndex}-${look.id || lookIndex}-prompt` ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    "Адаптировать"
                  )}
               </Button>
               <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 px-4 rounded-lg text-xs font-bold border-primary/20 hover:bg-primary/5 text-primary"
                  onClick={() => handleGenerateLookMotion(avatarIndex, lookIndex)}
                  disabled={
                    !selectedClientId ||
                    !avatar.id ||
                    !look.id ||
                    !look.look_id ||
                    motionLookRequestKey === `${avatar.id}-${look.id}` ||
                    isPendingMotionStatus(look.motion_status)
                  }
                >
                  {motionLookRequestKey === `${avatar.id}-${look.id}` || isPendingMotionStatus(look.motion_status) ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    look.motion_look_id ? "Обновить motion" : "Add Motion"
                  )}
               </Button>
            </div>
          </div>
       )}
    </div>
  );
};
