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
  buildGoogleFontsStylesheetUrl,
  DEFAULT_SUBTITLE_FONT_FAMILY,
  buildGoogleFontFamilyList,
  isSubtitlePresetFontKey,
  normalizeSubtitleFontFamilyValue,
  resolveSubtitleFontFamilyName,
  SUBTITLE_FONT_OPTIONS,
  SUBTITLE_MODE_OPTIONS,
  SUBTITLE_PRESET_DEFAULT_MARGIN_PERCENT,
  SUBTITLE_PRESET_DEFAULT_MARGIN_V,
} from "@/lib/subtitles";

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
  const ASS_PLAY_RES_Y = 1920;

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  const toSafeNumber = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const subtitlesEnabled = draftSettings.subtitles_enabled ?? true;
  const subtitleMode = draftSettings.subtitle_mode || "word_by_word";
  const subtitleStylePreset = draftSettings.subtitle_style_preset || "classic";
  const subtitleFontFamily = normalizeSubtitleFontFamilyValue(
    draftSettings.subtitle_font_family || DEFAULT_SUBTITLE_FONT_FAMILY
  );
  const subtitleFontColor = (draftSettings.subtitle_font_color || "#FFFFFF").toUpperCase();
  const subtitleOutlineColor = (draftSettings.subtitle_outline_color || "#000000").toUpperCase();
  const subtitleOutlineWidth = toSafeNumber(draftSettings.subtitle_outline_width, 4);
  const subtitleFontWeight = draftSettings.subtitle_font_weight || 700;
  const [fontSearch, setFontSearch] = React.useState("");
  const [fontCatalog, setFontCatalog] = React.useState<string[]>(() => buildGoogleFontFamilyList());
  const [isFontCatalogLoading, setIsFontCatalogLoading] = React.useState(false);
  const assToPreviewScale = Number.isFinite(subtitlePreviewScale) && subtitlePreviewScale > 0
    ? subtitlePreviewScale
    : 0.35;
  const presetMarginV = SUBTITLE_PRESET_DEFAULT_MARGIN_V[subtitleStylePreset] || 140;
  const presetMarginPercent = SUBTITLE_PRESET_DEFAULT_MARGIN_PERCENT[subtitleStylePreset] || 11;
  const explicitMarginPercent = Number(draftSettings.subtitle_margin_percent);
  const derivedMarginPercent = (toSafeNumber(draftSettings.subtitle_margin_v, presetMarginV) / ASS_PLAY_RES_Y) * 100;
  const subtitleMarginPercent = clamp(
    Number.isFinite(explicitMarginPercent)
      ? explicitMarginPercent
      : Number.isFinite(derivedMarginPercent)
        ? derivedMarginPercent
        : presetMarginPercent,
    0,
    100
  );
  const subtitleMarginVAss = Math.round((subtitleMarginPercent / 100) * ASS_PLAY_RES_Y);
  const subtitleMarginV = Math.round(subtitleMarginVAss * assToPreviewScale);
  const subtitleFontSizeAss =
    subtitleStylePreset === "impact" ? 42 : subtitleStylePreset === "soft_box" ? 36 : 38;
  const subtitleFontSizePreview = subtitleFontSizeAss * assToPreviewScale;
  const subtitleOutlineWidthAss =
    subtitleStylePreset === "impact"
      ? clamp(Number(subtitleOutlineWidth || 3) + 1, 0, 8)
      : clamp(Number(subtitleOutlineWidth || 3), 0, 8);
  const subtitleOutlineWidthPreview = Math.max(0, subtitleOutlineWidthAss * assToPreviewScale);
  const subtitleSideMargin = Math.round(63 * assToPreviewScale);

  const modePreview = SUBTITLE_MODE_OPTIONS[subtitleMode];
  const isPresetFont = isSubtitlePresetFontKey(subtitleFontFamily);
  const subtitleFontDisplayFamily = resolveSubtitleFontFamilyName(subtitleFontFamily);
  const presetKeyByFamily = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const [presetKey, font] of Object.entries(SUBTITLE_FONT_OPTIONS)) {
      map.set(font.family.toLowerCase(), presetKey);
    }
    return map;
  }, []);
  const fontPreview = isPresetFont
    ? SUBTITLE_FONT_OPTIONS[subtitleFontFamily]
    : {
        title: subtitleFontDisplayFamily,
        description: "Произвольный Google Font.",
      };

  const visibleFontOptions = React.useMemo(() => {
    const normalizedQuery = normalizeSubtitleFontFamilyValue(fontSearch).toLowerCase();
    const base = normalizedQuery
      ? fontCatalog.filter((item) => item.toLowerCase().includes(normalizedQuery))
      : fontCatalog;
    const withSelected = base.includes(subtitleFontDisplayFamily)
      ? base
      : [subtitleFontDisplayFamily, ...base];
    const maxCount = normalizedQuery ? 500 : 250;
    return withSelected.slice(0, maxCount);
  }, [fontCatalog, fontSearch, subtitleFontDisplayFamily]);

  React.useEffect(() => {
    let isCancelled = false;
    const loadFontCatalog = async () => {
      try {
        setIsFontCatalogLoading(true);
        const response = await fetch("/api/fonts/google", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Font catalog request failed: ${response.status}`);
        }
        const payload = await response.json() as { fonts?: unknown };
        const nextFonts = Array.isArray(payload.fonts)
          ? payload.fonts.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : [];
        if (!isCancelled && nextFonts.length) {
          setFontCatalog(buildGoogleFontFamilyList(nextFonts));
        }
      } catch (error) {
        console.warn("Failed to load Google font catalog in UI:", error);
      } finally {
        if (!isCancelled) {
          setIsFontCatalogLoading(false);
        }
      }
    };

    void loadFontCatalog();
    return () => {
      isCancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!subtitleFontDisplayFamily) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = buildGoogleFontsStylesheetUrl(subtitleFontDisplayFamily);
    link.dataset.subtitlePreviewFont = subtitleFontDisplayFamily;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [subtitleFontDisplayFamily]);

  return (
    <div className="space-y-6 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Субтитры
          </div>
          <p className="text-sm text-muted-foreground">
            Вшиваются в финальный монтаж. Выбор шрифта идёт из каталога Google Fonts.
          </p>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-3 rounded-xl bg-white border border-[#e5ebf0] px-4 py-2.5 text-sm font-semibold text-foreground cursor-pointer hover:bg-[#f8fafc] transition-colors">
            <input
              type="checkbox"
              checked={draftSettings.typography_hook_enabled ?? false}
              onChange={(event) =>
                setDraftSettings((prev) => ({ ...prev, typography_hook_enabled: event.target.checked }))
              }
              className="h-4 w-4 rounded border-[#d6e0e8] text-primary focus:ring-primary/20"
            />
            Typography Hook (3s)
          </label>
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
              Поиск шрифта
            </label>
            <input
              value={fontSearch}
              onChange={(event) => setFontSearch(event.target.value)}
              placeholder="Например: Inter, Playfair, Bebas"
              className="h-11 w-full rounded-xl border-none bg-[#f0f4f7] px-4 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/10"
            />
            <label className="pt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Шрифт (Google Fonts)
            </label>
            <Select
              value={subtitleFontDisplayFamily}
              onValueChange={(value) => {
                const normalizedFamily = normalizeSubtitleFontFamilyValue(value);
                const presetKey = presetKeyByFamily.get(normalizedFamily.toLowerCase());
                setDraftSettings((prev) => ({
                  ...prev,
                  subtitle_font_family: presetKey || normalizedFamily,
                }));
              }}
            >
              <SelectTrigger className="h-11 w-full rounded-xl border-none bg-[#f0f4f7] px-4 text-sm font-medium focus:ring-2 focus:ring-primary/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-96">
                {visibleFontOptions.map((fontFamily) => (
                  <SelectItem key={fontFamily} value={fontFamily}>
                    {fontFamily}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-500">
              {isFontCatalogLoading
                ? "Загружаю каталог Google Fonts..."
                : `Показано ${visibleFontOptions.length} шрифтов. Чтобы найти любой шрифт, введите его название в поиск.`}
            </p>
            <p className="text-[10px] text-slate-500">
              Активный шрифт: {fontPreview.title}
            </p>
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
                  subtitle_margin_v: Math.round((nextPercent / 100) * ASS_PLAY_RES_Y),
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
                className="relative mx-auto aspect-[9/16] w-full max-w-[420px] overflow-hidden rounded-[2rem] border-4 border-slate-800/50 bg-[radial-gradient(circle_at_top,#2d3748_0%,#1a202c_48%,#0f172a_100%)] shadow-2xl"
              >
                <div className="relative h-full w-full">
                  {/* Placeholder for video content in preview */}
                  <div className="absolute left-[13.3%] top-[7.5%] space-y-3">
                    <div className="h-14 w-44 rounded-full bg-white/10" />
                    <div className="h-8 w-64 rounded-full bg-white/10" />
                  </div>

                  <div
                    className="absolute"
                    style={{ left: subtitleSideMargin, right: subtitleSideMargin, bottom: subtitleMarginV }}
                  >
                    <div className="flex items-center gap-3 pb-4 text-[20px] font-bold uppercase tracking-[0.3em] text-white/40">
                      <span className="inline-block h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                      PREVIEW
                    </div>
                    <div
                      className={`mx-auto text-center leading-[1.05] tracking-tight ${
                        subtitleStylePreset === "soft_box" ? "rounded-[32px] bg-black/50 px-12 py-10 backdrop-blur-sm" : ""
                      }`}
                      style={{
                        color: subtitleFontColor,
                        fontFamily: subtitleFontDisplayFamily,
                        fontWeight: subtitleFontWeight,
                        textTransform: subtitleStylePreset === "impact" ? "uppercase" : "none",
                        WebkitTextStroke:
                          subtitleStylePreset === "soft_box"
                            ? undefined
                            : `${subtitleOutlineWidthPreview.toFixed(2)}px ${subtitleOutlineColor}`,
                        textShadow:
                          subtitleStylePreset === "soft_box"
                            ? "none"
                            : `0 0 ${Math.max(0.8, subtitleOutlineWidthPreview).toFixed(2)}px ${subtitleOutlineColor}, 0 4px 12px rgba(0,0,0,0.5)`,
                        fontSize: subtitleFontSizePreview,
                      }}
                    >
                      {subtitleMode === "word_by_word" ? (
                        <div className="space-y-1">
                          <div className="opacity-30">Путешествуй</div>
                          <div className="scale-110 drop-shadow-lg">свободно</div>
                          <div className="opacity-30">по миру</div>
                        </div>
                      ) : (
                        <div>Путешествуй свободно по миру</div>
                      )}
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
                    Превью масштабируется от финального рендера 1080x1920, поэтому размер шрифта совпадает с монтажом
                 </p>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};
