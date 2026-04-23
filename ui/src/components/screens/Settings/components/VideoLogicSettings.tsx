import React from "react";
import { Settings } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PACING_LABELS,
  BROLL_PACING_OPTIONS,
  BROLL_GENERATOR_OPTIONS,
  PRODUCT_CLIP_POLICY_OPTIONS,
} from "../SettingsConstants";

interface VideoLogicSettingsProps {
  draftSettings: Settings;
  setDraftSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

export const VideoLogicSettings: React.FC<VideoLogicSettingsProps> = ({
  draftSettings,
  setDraftSettings,
}) => {
  const toSafeNumber = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const brollPacingProfile = draftSettings.broll_pacing_profile || "balanced";
  const brollCoveragePercent = toSafeNumber(draftSettings.broll_coverage_percent, 75);
  const brollGeneratorModel = draftSettings.broll_generator_model || "veo3_lite";
  const productClipPolicy = draftSettings.broll_product_clip_policy || "contextual";

  const pacingPreview = BROLL_PACING_OPTIONS[brollPacingProfile];
  const generatorPreview = BROLL_GENERATOR_OPTIONS[brollGeneratorModel];
  const policyPreview = PRODUCT_CLIP_POLICY_OPTIONS[productClipPolicy];

  return (
    <div className="space-y-6 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Логика перебивок (B-roll)
          </div>
          <p className="text-sm text-muted-foreground">
            Настройте как система выбирает моменты для вставки визуального ряда.
          </p>
        </div>
        <div className="rounded-full bg-white border border-[#e5ebf0] px-4 py-1.5 text-[11px] font-bold text-primary shadow-sm uppercase tracking-wider">
           {PACING_LABELS[brollPacingProfile].title} / Coverage
        </div>
      </div>

      <div className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
               Генератор видео (T2V)
            </label>
            <Select
              value={brollGeneratorModel}
              onValueChange={(value: Settings["broll_generator_model"]) =>
                setDraftSettings((prev) => ({ ...prev, broll_generator_model: value }))
              }
            >
              <SelectTrigger className="h-11 w-full rounded-xl border-none bg-[#f0f4f7] px-4 text-sm font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bytedance/v1-pro-text-to-video">KIE V1 Pro</SelectItem>
                <SelectItem value="bytedance/seedance-1.5-pro">Seedance 1.5 Pro</SelectItem>
                <SelectItem value="grok-imagine/text-to-video">Grok Imagine T2V</SelectItem>
                <SelectItem value="veo3">Veo 3.1 Quality</SelectItem>
                <SelectItem value="veo3_fast">Veo 3.1 Fast</SelectItem>
                <SelectItem value="veo3_lite">Veo 3.1 Lite</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-xl border border-white/70 bg-white p-4 text-xs space-y-2 shadow-inner">
           <div className="flex items-center gap-2">
             <div className="h-2 w-2 rounded-full bg-primary" />
             <span className="font-bold text-foreground">Как это работает:</span>
           </div>
           <p className="text-muted-foreground leading-relaxed pl-4">
             Система работает от целевого покрытия: старается заполнить ролик перебивками так, чтобы они занимали заданную долю времени.
           </p>
           <p className="text-muted-foreground leading-relaxed pl-4 font-medium italic">
             {generatorPreview.description}
           </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Ритм монтажа (Темп)
            </label>
            <Select
              value={brollPacingProfile}
              onValueChange={(value: Settings["broll_pacing_profile"]) =>
                setDraftSettings((prev) => ({ ...prev, broll_pacing_profile: value }))
              }
            >
              <SelectTrigger className="h-11 w-full rounded-xl border-none bg-[#f0f4f7] px-4 text-sm font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="calm">Спокойно</SelectItem>
                <SelectItem value="balanced">Сбалансированно</SelectItem>
                <SelectItem value="dynamic">Динамично</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-400 font-medium px-1">{pacingPreview.title}: {pacingPreview.description}</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Целевое покрытие</div>
              <div className="text-[11px] font-bold text-primary bg-primary/5 px-2 py-0.5 rounded-full">
                {brollCoveragePercent.toFixed(0)}%
              </div>
            </div>
            <input
              type="range"
              min={15}
              max={100}
              step={1}
              value={brollCoveragePercent}
              onChange={(event) =>
                setDraftSettings((prev) => ({ ...prev, broll_coverage_percent: Number(event.target.value) }))
              }
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
              <span>Мало</span>
              <span>75% (Стандарт)</span>
              <span>Много</span>
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 pt-2">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Product Clip Policy
            </label>
            <Select
              value={productClipPolicy}
              onValueChange={(value: Settings["broll_product_clip_policy"]) =>
                setDraftSettings((prev) => ({ ...prev, broll_product_clip_policy: value }))
              }
            >
              <SelectTrigger className="h-11 w-full rounded-xl border-none bg-[#f0f4f7] px-4 text-sm font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contextual">Только если уместно</SelectItem>
                <SelectItem value="required">Обязательно вставить</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-400 font-medium px-1">{policyPreview.description}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
