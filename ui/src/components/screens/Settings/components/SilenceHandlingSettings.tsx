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
  const silenceTrimEnabled = draftSettings.tts_silence_trim_enabled ?? true;
  const sentenceTrimEnabled = draftSettings.tts_sentence_trim_enabled ?? false;
  const silenceTrimMinSeconds = toSafeNumber(draftSettings.tts_silence_trim_min_duration_seconds, 0.35);
  const silenceTrimThresholdDb = toSafeNumber(draftSettings.tts_silence_trim_threshold_db, -45);
  const sentenceTrimMinGapSeconds = toSafeNumber(draftSettings.tts_sentence_trim_min_gap_seconds, 0.3);
  const sentenceTrimKeepGapSeconds = toSafeNumber(draftSettings.tts_sentence_trim_keep_gap_seconds, 0.1);

  return (
    <div className="space-y-6 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Отработка тишины
          </div>
          <p className="text-sm text-muted-foreground">
            Ручная настройка для чистки длинной тишины и безопасного сжатия пауз по таймкодам речи.
          </p>
        </div>
        <div className="rounded-full border border-[#e5ebf0] bg-white px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm">
          Timestamp-aware
        </div>
      </div>

      <div className="rounded-xl border border-white/70 bg-white p-4 text-xs leading-relaxed text-muted-foreground shadow-inner">
        Сначала можно применить общую чистку тишины по dB, затем более точечное сжатие безопасных gap-ов между словами и предложениями по word timestamps.
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-5 rounded-2xl border border-[#e5ebf0] bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Общая тишина
              </div>
              <p className="text-sm text-muted-foreground">
                Режет длинные тихие участки в TTS-аудио по dB. Полезно для затяжных вдохов и хвостов, но работает грубее таймкодного режима.
              </p>
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-[#e5ebf0] bg-[#f8fafc] px-4 py-2.5 text-sm font-semibold text-foreground">
              <input
                type="checkbox"
                checked={silenceTrimEnabled}
                onChange={(event) =>
                  setDraftSettings((prev) => ({ ...prev, tts_silence_trim_enabled: event.target.checked }))
                }
                className="h-4 w-4 rounded border-[#d6e0e8] text-primary focus:ring-primary/20"
              />
              {silenceTrimEnabled ? "Включено" : "Выключено"}
            </label>
          </div>

          <div className="grid gap-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Минимальная тишина для вырезки
                </div>
                <div className="rounded-full bg-primary/5 px-2 py-0.5 text-[11px] font-bold text-primary">
                  {silenceTrimMinSeconds.toFixed(2)} сек
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={silenceTrimMinSeconds}
                onChange={(event) =>
                  setDraftSettings((prev) => ({
                    ...prev,
                    tts_silence_trim_min_duration_seconds: Number(event.target.value),
                  }))
                }
                className="w-full accent-primary"
                disabled={!silenceTrimEnabled}
              />
              <p className="text-[10px] font-medium text-slate-400">
                Чем меньше значение, тем агрессивнее режутся короткие молчания.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Порог тишины
                </div>
                <div className="rounded-full bg-primary/5 px-2 py-0.5 text-[11px] font-bold text-primary">
                  {silenceTrimThresholdDb.toFixed(0)} dB
                </div>
              </div>
              <input
                type="range"
                min={-80}
                max={-20}
                step={1}
                value={silenceTrimThresholdDb}
                onChange={(event) =>
                  setDraftSettings((prev) => ({
                    ...prev,
                    tts_silence_trim_threshold_db: Number(event.target.value),
                  }))
                }
                className="w-full accent-primary"
                disabled={!silenceTrimEnabled}
              />
              <p className="text-[10px] font-medium text-slate-400">
                Более низкий dB режет только почти полную тишину. Более высокий dB реагирует и на тихое дыхание.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-5 rounded-2xl border border-[#e5ebf0] bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Паузы по таймкодам речи
              </div>
              <p className="text-sm text-muted-foreground">
                Ищет безопасные gap-ы между словами, вдохи и длинные остановки, затем сжимает их, не задевая сами слова.
              </p>
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-[#e5ebf0] bg-[#f8fafc] px-4 py-2.5 text-sm font-semibold text-foreground">
              <input
                type="checkbox"
                checked={sentenceTrimEnabled}
                onChange={(event) =>
                  setDraftSettings((prev) => ({ ...prev, tts_sentence_trim_enabled: event.target.checked }))
                }
                className="h-4 w-4 rounded border-[#d6e0e8] text-primary focus:ring-primary/20"
              />
              {sentenceTrimEnabled ? "Включено" : "Выключено"}
            </label>
          </div>

          <div className="grid gap-5">
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
                disabled={!sentenceTrimEnabled}
              />
              <p className="text-[10px] font-medium text-slate-400">
                Gap-ы короче этого значения сохраняются без изменений.
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
                disabled={!sentenceTrimEnabled}
              />
              <p className="text-[10px] font-medium text-slate-400">
                Оставляет воздух и естественный ритм после сжатия длинных пауз.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
