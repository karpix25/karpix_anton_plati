import React from "react";
import { Settings } from "@/types";
import { LoaderCircle, Play } from "lucide-react";

interface AutomationSettingsProps {
  draftSettings: Settings;
  setDraftSettings: React.Dispatch<React.SetStateAction<Settings>>;
  isManualFinalRunPending: boolean;
  onManualFinalRun: () => void;
}

export const AutomationSettings: React.FC<AutomationSettingsProps> = ({
  draftSettings,
  setDraftSettings,
  isManualFinalRunPending,
  onManualFinalRun,
}) => {
  const autoActive = draftSettings.auto_generate_final_videos ?? false;
  const dailyCount = draftSettings.daily_final_video_count || 0;
  const dailyLimit = draftSettings.daily_final_video_limit || 1;
  const monthlyCount = draftSettings.monthly_final_video_count || 0;
  const monthlyLimit = draftSettings.monthly_final_video_limit || 1;
  const openJobs = draftSettings.open_final_video_jobs || 0;

  const targetMin = draftSettings.target_duration_min_seconds || draftSettings.target_duration_seconds || 15;
  const targetMax = draftSettings.target_duration_max_seconds || draftSettings.target_duration_seconds || 15;

  // Approximate words calculation (similar to original logic)
  const estMin = Math.round(targetMin * 2.2);
  const estMax = Math.round(targetMax * 2.2);

  const dailyProgress = Math.min(100, Math.round((dailyCount / Math.max(1, dailyLimit)) * 100));
  const monthlyProgress = Math.min(100, Math.round((monthlyCount / Math.max(1, monthlyLimit)) * 100));
  const manualRunHint = `Ручной запуск добавляет до ${dailyLimit} задач в очередь (игнорируя дневной остаток, но с учетом месячного лимита).`;

  return (
    <div className="space-y-6">
      <div className="space-y-5 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Автоматика финальных роликов
            </div>
            <p className="text-sm text-muted-foreground">
              Включает контур автопроизводства: сценарий, озвучка, перебивки, аватар, монтаж.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onManualFinalRun}
              disabled={isManualFinalRunPending}
              title={manualRunHint}
              className="inline-flex items-center gap-2 rounded-xl border border-[#d6e0e8] bg-white px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isManualFinalRunPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isManualFinalRunPending ? "Запускаю..." : "Запуск вручную"}
            </button>

            <label className="flex items-center gap-3 rounded-xl bg-white border border-[#e5ebf0] px-4 py-2.5 text-sm font-semibold text-foreground cursor-pointer hover:bg-[#f8fafc] transition-colors">
              <input
                type="checkbox"
                checked={autoActive}
                onChange={(event) =>
                  setDraftSettings((prev) => ({ ...prev, auto_generate_final_videos: event.target.checked }))
                }
                className="h-4 w-4 rounded border-[#d6e0e8] text-primary focus:ring-primary/20"
              />
              {autoActive ? "Активен" : "Выключен"}
            </label>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-white/70 bg-white p-4 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Статистика</div>
            <div className="space-y-2 text-xs font-semibold">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Сделано сегодня (запрошено сегодня):</span>
                <span className="text-foreground">{dailyCount} / {dailyLimit}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Сделано в месяце (запрошено в месяце):</span>
                <span className="text-foreground">{monthlyCount} / {monthlyLimit}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">В очереди:</span>
                <span className="text-foreground">{openJobs} задач</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Лимит в день
              </label>
              <input
                type="number"
                min={1}
                value={dailyLimit}
                onChange={(event) =>
                  setDraftSettings((prev) => {
                    const nextDaily = Math.max(1, parseInt(event.target.value) || 1);
                    return {
                      ...prev,
                      daily_final_video_limit: nextDaily,
                      monthly_final_video_limit: Math.max(prev.monthly_final_video_limit || nextDaily, nextDaily),
                    };
                  })
                }
                className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm font-bold text-foreground outline-none focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Лимит в месяц
              </label>
              <input
                type="number"
                min={dailyLimit}
                value={monthlyLimit}
                onChange={(event) =>
                  setDraftSettings((prev) => ({
                    ...prev,
                    monthly_final_video_limit: Math.max(prev.daily_final_video_limit || 1, parseInt(event.target.value) || 1),
                  }))
                }
                className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm font-bold text-foreground outline-none focus:ring-2 focus:ring-primary/10"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Прогресс (день)</span>
              <span>{dailyProgress}%</span>
            </div>
            <div className="h-2 rounded-full bg-[#f0f4f7] overflow-hidden">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${dailyProgress}%` }} />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Прогресс (месяц)</span>
              <span>{monthlyProgress}%</span>
            </div>
            <div className="h-2 rounded-full bg-[#f0f4f7] overflow-hidden">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${monthlyProgress}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Длина сценария</div>
            <p className="text-sm text-muted-foreground">Диапазон длительности итогового ролика.</p>
          </div>
          <div className="rounded-full bg-white border border-[#e5ebf0] px-4 py-1.5 text-sm font-bold text-primary shadow-sm">
            {targetMin} - {targetMax} сек
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[1fr_200px] items-center">
          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center block">От</label>
                <div className="relative">
                  <input
                    type="number"
                    min={15}
                    max={120}
                    step={5}
                    value={targetMin}
                    onChange={(event) =>
                      setDraftSettings((prev) => {
                        const nextMin = Math.max(15, Math.min(120, Number(event.target.value) || 15));
                        const nextMax = Math.max(nextMin, Number(prev.target_duration_max_seconds || nextMin));
                        return {
                          ...prev,
                          target_duration_min_seconds: nextMin,
                          target_duration_max_seconds: nextMax,
                        };
                      })
                    }
                    className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-4 text-center text-lg font-black text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground uppercase">с</span>
                </div>
             </div>
             <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center block">До</label>
                <div className="relative">
                  <input
                    type="number"
                    min={15}
                    max={120}
                    step={5}
                    value={targetMax}
                    onChange={(event) =>
                      setDraftSettings((prev) => {
                        const nextMax = Math.max(targetMin, Math.min(120, Number(event.target.value) || targetMin));
                        const nextMin = Math.min(Number(prev.target_duration_min_seconds || nextMax), nextMax);
                        return {
                          ...prev,
                          target_duration_min_seconds: nextMin,
                          target_duration_max_seconds: nextMax,
                        };
                      })
                    }
                    className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-4 text-center text-lg font-black text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground uppercase">с</span>
                </div>
             </div>
          </div>

          <div className="bg-white rounded-2xl border border-white/70 p-4 shadow-inner text-center">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Примерно слов</div>
            <div className="text-xl font-black text-primary">{estMin} – {estMax}</div>
            <div className="text-[9px] font-bold uppercase tracking-tight text-slate-400 mt-1">Основано на темпе 2.2 с/с</div>
          </div>
        </div>

        <p className="text-xs italic text-muted-foreground leading-relaxed">
          Генератор будет подбирать сюжет так, чтобы итоговый хронометраж попал в этот диапазон.
        </p>
      </div>
    </div>
  );
};
