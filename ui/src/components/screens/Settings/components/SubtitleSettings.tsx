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
  SUBTITLE_FONT_OPTIONS,
  SUBTITLE_MODE_OPTIONS,
  SUBTITLE_STYLE_OPTIONS,
} from "../SettingsConstants";

interface SubtitleSettingsProps {
  draftSettings: Settings;
  setDraftSettings: React.Dispatch<React.SetStateAction<Settings>>;
  subtitlePreviewRef: React.RefObject<HTMLDivElement | null>;
  subtitlePreviewScale: number;
}

export const SubtitleSettings: React.FC<SubtitleSettingsProps> = ({
  draftSettings,
  setDraftSettings,
  subtitlePreviewRef,
  subtitlePreviewScale,
}) => {
  const subtitlesEnabled = draftSettings.subtitles_enabled ?? true;
  const subtitleMode = draftSettings.subtitle_mode || "word_by_word";
  const subtitleStylePreset = draftSettings.subtitle_style_preset || "classic";
  const subtitleFontFamily = draftSettings.subtitle_font_family || "impact";
  const subtitleFontColor = (draftSettings.subtitle_font_color || "#FFFFFF").toUpperCase();
  const subtitleOutlineColor = (draftSettings.subtitle_outline_color || "#000000").toUpperCase();
  const subtitleOutlineWidth = typeof draftSettings.subtitle_outline_width === "number" ? draftSettings.subtitle_outline_width : 4;
  const subtitleFontWeight = draftSettings.subtitle_font_weight || 700;
  const subtitleMarginPercent = typeof draftSettings.subtitle_margin_percent === "number" ? draftSettings.subtitle_margin_percent : 12;
  const subtitleMarginV = typeof draftSettings.subtitle_margin_v === "number" ? draftSettings.subtitle_margin_v : 154;

  const modePreview = SUBTITLE_MODE_OPTIONS[subtitleMode];
  const stylePreview = SUBTITLE_STYLE_OPTIONS[subtitleStylePreset];
  const fontPreview = SUBTITLE_FONT_OPTIONS[subtitleFontFamily];

  return (
    <div className="space-y-6 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Субтитры
          </div>
          <p className="text-sm text-muted-foreground">
            Вшиваются в финальный монтаж. Выберите режим, стиль и кириллический шрифт.
          </p>
        </div>
        <label className="flex items-center gap-3 rounded-xl bg-white border border-[#e5ebf0] px-4 py-2.5 text-sm font-semibold text-foreground cursor-pointer hover:bg-[#f8fafc] transition-colors">
          <input
            type="checkbox"
            checked={subtitlesEnabled}
            onChange={(event) =>
              setDraftSettings((prev) => ({ ...prev, subtitles_enabled: event.target.checked }))
            }
            className="h-4 w-4 rounded border-[#d6e0e8] text-primary focus:ring-primary/20"
          />
          Включены
        </label>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Режим показа
              </label>
              <Select
                value={subtitleMode}
                onValueChange={(value: Settings["subtitle_mode"]) =>
                  setDraftSettings((prev) => ({ ...prev, subtitle_mode: value }))
                }
              >
                <SelectTrigger className="h-11 w-full rounded-xl border-none bg-[#f0f4f7] px-4 text-sm font-medium focus:ring-2 focus:ring-primary/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="word_by_word">По одному слову</SelectItem>
                  <SelectItem value="phrase_block">Фразами</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Стиль
              </label>
              <Select
                value={subtitleStylePreset}
                onValueChange={(value: Settings["subtitle_style_preset"]) =>
                  setDraftSettings((prev) => ({ ...prev, subtitle_style_preset: value }))
                }
              >
                <SelectTrigger className="h-11 w-full rounded-xl border-none bg-[#f0f4f7] px-4 text-sm font-medium focus:ring-2 focus:ring-primary/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="classic">Classic Outline</SelectItem>
                  <SelectItem value="impact">Impact</SelectItem>
                  <SelectItem value="soft_box">Soft Box</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Шрифт (Google Fonts)
            </label>
            <Select
              value={subtitleFontFamily}
              onValueChange={(value: Settings["subtitle_font_family"]) =>
                setDraftSettings((prev) => ({ ...prev, subtitle_font_family: value }))
              }
            >
              <SelectTrigger className="h-11 w-full rounded-xl border-none bg-[#f0f4f7] px-4 text-sm font-medium focus:ring-2 focus:ring-primary/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SUBTITLE_FONT_OPTIONS).map(([fontKey, font]) => (
                  <SelectItem key={fontKey} value={fontKey}>
                    {font.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
               <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Цвет текста
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-[#f0f4f7] px-3 py-2">
                <div className="h-8 w-8 rounded-lg overflow-hidden border border-white/20 shadow-sm shrink-0">
                  <input
                    type="color"
                    value={subtitleFontColor}
                    onChange={(event) =>
                      setDraftSettings((prev) => ({ ...prev, subtitle_font_color: event.target.value.toUpperCase() }))
                    }
                    className="h-12 w-12 -translate-x-2 -translate-y-2 cursor-pointer"
                  />
                </div>
                <input
                  value={subtitleFontColor}
                  onChange={(event) =>
                    setDraftSettings((prev) => ({ ...prev, subtitle_font_color: event.target.value.toUpperCase() }))
                  }
                  className="w-full bg-transparent text-sm font-bold text-foreground outline-none"
                />
              </div>
            </div>

            <div className="space-y-2">
               <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Цвет обводки
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-[#f0f4f7] px-3 py-2">
                <div className="h-8 w-8 rounded-lg overflow-hidden border border-white/20 shadow-sm shrink-0">
                  <input
                    type="color"
                    value={subtitleOutlineColor}
                    onChange={(event) =>
                      setDraftSettings((prev) => ({ ...prev, subtitle_outline_color: event.target.value.toUpperCase() }))
                    }
                    className="h-12 w-12 -translate-x-2 -translate-y-2 cursor-pointer"
                  />
                </div>
                <input
                  value={subtitleOutlineColor}
                  onChange={(event) =>
                    setDraftSettings((prev) => ({ ...prev, subtitle_outline_color: event.target.value.toUpperCase() }))
                  }
                  className="w-full bg-transparent text-sm font-bold text-foreground outline-none"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
             <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Толщина</div>
                <div className="text-[11px] font-bold text-primary bg-primary/5 px-2 py-0.5 rounded-full">
                  {subtitleOutlineWidth.toFixed(1)} px
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={8}
                step={0.5}
                value={subtitleOutlineWidth}
                onChange={(event) =>
                  setDraftSettings((prev) => ({ ...prev, subtitle_outline_width: Number(event.target.value) }))
                }
                className="w-full accent-primary"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Жирность
              </label>
              <Select
                value={String(subtitleFontWeight)}
                onValueChange={(value) =>
                  setDraftSettings((prev) => ({
                    ...prev,
                    subtitle_font_weight: value === "400" ? 400 : 700,
                  }))
                }
              >
                <SelectTrigger className="h-11 w-full rounded-xl border-none bg-[#f0f4f7] px-4 text-sm font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="400">Regular</SelectItem>
                  <SelectItem value="700">Bold</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Высота (от низа)</div>
              <div className="text-[11px] font-bold text-primary bg-primary/5 px-2 py-0.5 rounded-full">
                {subtitleMarginPercent}%
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={subtitleMarginPercent}
              onChange={(event) => {
                const nextPercent = Number(event.target.value);
                setDraftSettings((prev) => ({
                  ...prev,
                  subtitle_margin_percent: nextPercent,
                  subtitle_margin_v: Math.round((nextPercent / 100) * 1280),
                }));
              }}
              className="w-full accent-primary"
            />
          </div>
        </div>

        <div className="flex flex-col">
           <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Превью</div>
           <div className="flex-1 flex flex-col rounded-2xl bg-[#0f172a] p-4 shadow-xl border border-slate-800">
              <div
                ref={subtitlePreviewRef}
                className="relative mx-auto aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded-[2rem] border-4 border-slate-800/50 bg-[radial-gradient(circle_at_top,#2d3748_0%,#1a202c_48%,#0f172a_100%)] shadow-2xl"
              >
                <div
                  className="absolute left-0 top-0"
                  style={{
                    width: 720,
                    height: 1280,
                    transform: `scale(${subtitlePreviewScale})`,
                    transformOrigin: "top left",
                  }}
                >
                  <div className="relative h-full w-full">
                    {/* Placeholder for video content in preview */}
                    <div className="absolute left-[96px] top-[96px] space-y-3">
                      <div className="h-14 w-44 rounded-full bg-white/10" />
                      <div className="h-8 w-64 rounded-full bg-white/10" />
                    </div>

                    <div
                      className="absolute left-[42px] right-[42px]"
                      style={{ bottom: subtitleMarginV }}
                    >
                      <div className="flex items-center gap-3 pb-4 text-[20px] font-bold uppercase tracking-[0.3em] text-white/40">
                        <span className="inline-block h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                        PREVIEW
                      </div>
                      <div
                        className={`mx-auto text-center uppercase leading-[1.05] tracking-tight ${
                          subtitleStylePreset === "soft_box" ? "rounded-[32px] bg-black/50 px-12 py-10 backdrop-blur-sm" : ""
                        }`}
                        style={{
                          color: subtitleFontColor,
                          fontFamily: fontPreview.title,
                          fontWeight: subtitleFontWeight,
                          WebkitTextStroke:
                            subtitleStylePreset === "soft_box" ? undefined : `${subtitleOutlineWidth}px ${subtitleOutlineColor}`,
                          textShadow:
                            subtitleStylePreset === "soft_box"
                              ? "none"
                              : `0 0 ${Math.max(1, subtitleOutlineWidth)}px ${subtitleOutlineColor}, 0 4px 12px rgba(0,0,0,0.5)`,
                          fontSize:
                            subtitleStylePreset === "impact" ? 32 : subtitleStylePreset === "soft_box" ? 26 : 28,
                        }}
                      >
                        {subtitleMode === "word_by_word" ? (
                          <div className="space-y-1">
                            <div className="opacity-30">ПУТЕШЕСТВУЙ</div>
                            <div className="scale-110 drop-shadow-lg">СВОБОДНО</div>
                            <div className="opacity-30">ПО МИРУ</div>
                          </div>
                        ) : (
                          <div>ПУТЕШЕСТВУЙ СВОБОДНО ПО МИРУ</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="absolute inset-x-0 bottom-4 text-center">
                    <div className="px-4 py-1 inline-block rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-[9px] font-bold uppercase tracking-widest text-white/50">
                        HD 9:16 Reality Check
                    </div>
                </div>
              </div>
              <div className="mt-4 text-center space-y-2">
                 <p className="text-[11px] font-medium text-slate-400">
                    {modePreview.title}: {modePreview.description}
                 </p>
                 <div className="h-px bg-slate-800 w-1/4 mx-auto" />
                 <p className="text-[10px] text-slate-500 italic max-w-xs mx-auto">
                    Превью показывает реальный масштаб для видео 1280px высотой
                 </p>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};
