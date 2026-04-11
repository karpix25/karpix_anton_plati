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

export const SilenceHandlingSettings: React.FC<SilenceHandlingSettingsProps> = ({
  draftSettings,
  setDraftSettings,
}) => {
  const pauseOptimizationEnabled =
    (draftSettings.tts_silence_trim_enabled ?? false) || (draftSettings.tts_sentence_trim_enabled ?? false);
  const sentenceTrimMinGapSeconds = toSafeNumber(draftSettings.tts_sentence_trim_min_gap_seconds, 0.3);
  const sentenceTrimKeepGapSeconds = toSafeNumber(draftSettings.tts_sentence_trim_keep_gap_seconds, 0.1);

  return (
    <div className="space-y-6 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Паузы И Вдохи
          </div>
          <p className="text-sm text-muted-foreground">
            Упрощенная настройка безопасного сжатия пауз и вдохов по таймкодам речи.
          </p>
        </div>
        <div className="rounded-full border border-[#e5ebf0] bg-white px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm">
          Smart Trim
        </div>
      </div>

      <div className="rounded-xl border border-white/70 bg-white p-4 text-xs leading-relaxed text-muted-foreground shadow-inner">
        Система сначала делает мягкую чистку длинной тишины по dB, затем ищет безопасные gap-ы между словами по word timestamps и режет только середину этих пауз, не заходя в сами слова.
      </div>

      <section className="space-y-5 rounded-2xl border border-[#e5ebf0] bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Оптимизация речи
            </div>
            <p className="text-sm text-muted-foreground">
              Один переключатель управляет и мягкой чисткой длинной тишины, и точным сжатием пауз между словами.
            </p>
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-[#e5ebf0] bg-[#f8fafc] px-4 py-2.5 text-sm font-semibold text-foreground">
            <input
              type="checkbox"
              checked={pauseOptimizationEnabled}
              onChange={(event) =>
                setDraftSettings((prev) => ({
                  ...prev,
                  tts_silence_trim_enabled: event.target.checked,
                  tts_sentence_trim_enabled: event.target.checked,
                }))
              }
              className="h-4 w-4 rounded border-[#d6e0e8] text-primary focus:ring-primary/20"
            />
            {pauseOptimizationEnabled ? "Включено" : "Выключено"}
          </label>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Пауза, с которой начинается сжатие
              </div>
              <div className="rounded-full bg-primary/5 px-2 py-0.5 text-[11px] font-bold text-primary">
                {sentenceTrimMinGapSeconds.toFixed(2)} сек
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={sentenceTrimMinGapSeconds}
              onChange={(event) =>
                setDraftSettings((prev) => ({
                  ...prev,
                  tts_sentence_trim_min_gap_seconds: Number(event.target.value),
                }))
              }
              className="w-full accent-primary"
              disabled={!pauseOptimizationEnabled}
            />
            <p className="text-[10px] font-medium text-slate-400">
              Чем меньше значение, тем больше коротких вдохов и пауз можно будет ужимать.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Сколько паузы оставить
              </div>
              <div className="rounded-full bg-primary/5 px-2 py-0.5 text-[11px] font-bold text-primary">
                {sentenceTrimKeepGapSeconds.toFixed(2)} сек
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={sentenceTrimKeepGapSeconds}
              onChange={(event) =>
                setDraftSettings((prev) => ({
                  ...prev,
                  tts_sentence_trim_keep_gap_seconds: Number(event.target.value),
                }))
              }
              className="w-full accent-primary"
              disabled={!pauseOptimizationEnabled}
            />
            <p className="text-[10px] font-medium text-slate-400">
              Чем меньше значение, тем суше и быстрее звучит речь. Чем больше, тем естественнее дыхание и ритм.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
