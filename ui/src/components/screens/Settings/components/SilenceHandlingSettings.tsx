import React from "react";
import { Settings } from "@/types";

interface SilenceHandlingSettingsProps {
  draftSettings: Settings;
  setDraftSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

const toSafeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

type PausePreset = "natural" | "tighter" | "very_tight";

const PAUSE_PRESET_CONFIG: Record<
  PausePreset,
  {
    label: string;
    description: string;
    minGapSeconds: number;
    keepGapSeconds: number;
    silenceTrimEnabled: boolean;
    sentenceTrimEnabled: boolean;
  }
> = {
  natural: {
    label: "Естественно",
    description: "Оставляет больше живых пауз и дыхания. Речь звучит мягче и свободнее.",
    minGapSeconds: 0.35,
    keepGapSeconds: 0.14,
    silenceTrimEnabled: true,
    sentenceTrimEnabled: true,
  },
  tighter: {
    label: "Плотнее",
    description: "Убирает лишние паузы, но сохраняет естественный ритм речи.",
    minGapSeconds: 0.2,
    keepGapSeconds: 0.08,
    silenceTrimEnabled: true,
    sentenceTrimEnabled: true,
  },
  very_tight: {
    label: "Очень плотно",
    description: "Делает подачу быстрее и суше. Подходит для динамичных short-form роликов.",
    minGapSeconds: 0.12,
    keepGapSeconds: 0.06,
    silenceTrimEnabled: true,
    sentenceTrimEnabled: true,
  },
};

const detectPausePreset = (
  settings: Settings,
  pauseOptimizationEnabled: boolean,
  sentenceTrimMinGapSeconds: number,
  sentenceTrimKeepGapSeconds: number
): PausePreset => {
  if (!pauseOptimizationEnabled) {
    return "natural";
  }

  const presets = Object.entries(PAUSE_PRESET_CONFIG) as Array<[PausePreset, (typeof PAUSE_PRESET_CONFIG)[PausePreset]]>;
  let bestPreset: PausePreset = "tighter";
  let bestScore = Number.POSITIVE_INFINITY;

  for (const [presetKey, preset] of presets) {
    const enabledScore =
      Number((settings.tts_silence_trim_enabled ?? false) !== preset.silenceTrimEnabled) +
      Number((settings.tts_sentence_trim_enabled ?? false) !== preset.sentenceTrimEnabled);
    const numericScore =
      Math.abs(sentenceTrimMinGapSeconds - preset.minGapSeconds) +
      Math.abs(sentenceTrimKeepGapSeconds - preset.keepGapSeconds);
    const totalScore = enabledScore + numericScore;

    if (totalScore < bestScore) {
      bestScore = totalScore;
      bestPreset = presetKey;
    }
  }

  return bestPreset;
};

export const SilenceHandlingSettings: React.FC<SilenceHandlingSettingsProps> = ({
  draftSettings,
  setDraftSettings,
}) => {
  const silenceTrimEnabled = draftSettings.tts_silence_trim_enabled ?? false;
  const sentenceTrimEnabled = draftSettings.tts_sentence_trim_enabled ?? false;
  const globalEnabled = silenceTrimEnabled || sentenceTrimEnabled;

  const sentenceTrimMinGapSeconds = toSafeNumber(draftSettings.tts_sentence_trim_min_gap_seconds, 0.3);
  const sentenceTrimKeepGapSeconds = toSafeNumber(draftSettings.tts_sentence_trim_keep_gap_seconds, 0.1);
  
  const selectedPreset = detectPausePreset(
    draftSettings,
    globalEnabled,
    sentenceTrimMinGapSeconds,
    sentenceTrimKeepGapSeconds
  );
  
  const selectedPresetMeta = PAUSE_PRESET_CONFIG[selectedPreset];

  const applyPreset = (preset: PausePreset) => {
    const config = PAUSE_PRESET_CONFIG[preset];
    setDraftSettings((prev) => ({
      ...prev,
      tts_silence_trim_enabled: config.silenceTrimEnabled,
      tts_sentence_trim_enabled: config.sentenceTrimEnabled,
      tts_sentence_trim_min_gap_seconds: config.minGapSeconds,
      tts_sentence_trim_keep_gap_seconds: config.keepGapSeconds,
    }));
  };

  const handleGlobalToggle = (enabled: boolean) => {
    if (!enabled) {
      setDraftSettings((prev) => ({
        ...prev,
        tts_silence_trim_enabled: false,
        tts_sentence_trim_enabled: false,
      }));
    } else {
      // Restore default preset (natural) when enabling
      applyPreset("natural");
    }
  };

  return (
    <div className="space-y-6 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Паузы и вдохи
          </div>
          <p className="text-sm text-muted-foreground">
            Упрощенная настройка безопасного сжатия пауз и вдохов по таймкодам речи.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-3 rounded-xl bg-white border border-[#e5ebf0] px-4 py-2.5 text-sm font-semibold text-foreground cursor-pointer hover:bg-[#f8fafc] transition-colors">
            <input
              type="checkbox"
              checked={globalEnabled}
              onChange={(e) => handleGlobalToggle(e.target.checked)}
              className="h-4 w-4 rounded border-[#d6e0e8] text-primary focus:ring-primary/20"
            />
            Общая обработка
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-white/70 bg-white p-4 text-xs leading-relaxed text-muted-foreground shadow-inner">
        {globalEnabled ? (
          "Система делает речь плотнее: подчищает длинную тишину и аккуратно сокращает лишние паузы между словами, не задевая сами слова."
        ) : (
          <span className="text-amber-600 font-medium italic">
            Обработка пауз и вдохов отключена. Речь будет генерироваться ровно так, как её выдает HeyGen/Voice Engine, без дополнительного монтажа тишины.
          </span>
        )}
      </div>

      <section className={`space-y-5 rounded-2xl border border-[#e5ebf0] bg-white p-5 shadow-sm transition-opacity duration-300 ${!globalEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Пресеты пауз
            </div>
            <p className="text-sm text-muted-foreground">
              Выберите, насколько плотной должна звучать речь.
            </p>
          </div>
          {globalEnabled && (
            <div className="rounded-full bg-primary/5 px-3 py-1 text-[11px] font-bold text-primary">
              {selectedPresetMeta.label}
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {(Object.entries(PAUSE_PRESET_CONFIG) as Array<[PausePreset, (typeof PAUSE_PRESET_CONFIG)[PausePreset]]>).map(
            ([presetKey, preset]) => {
              const isSelected = selectedPreset === presetKey && globalEnabled;

              return (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => applyPreset(presetKey)}
                  className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-[#e5ebf0] bg-[#f8fafc] hover:border-primary/30 hover:bg-white"
                  }`}
                >
                  <div className="text-sm font-bold text-foreground">{preset.label}</div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{preset.description}</p>
                </button>
              );
            }
          )}
        </div>
      </section>
    </div>
  );
};
