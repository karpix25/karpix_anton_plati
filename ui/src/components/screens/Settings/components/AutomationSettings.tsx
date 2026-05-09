import React from "react";
import { Settings } from "@/types";
import { Check, FolderOpen, LoaderCircle, Play, RefreshCw } from "lucide-react";

interface AutomationSettingsProps {
  draftSettings: Settings;
  setDraftSettings: React.Dispatch<React.SetStateAction<Settings>>;
  isManualFinalRunPending: boolean;
  onManualFinalRun: () => void;
}

type YandexDiskFolderNode = {
  name: string;
  path: string;
  children: YandexDiskFolderNode[];
};

const FolderTree: React.FC<{
  nodes: YandexDiskFolderNode[];
  selectedPath: string;
  level?: number;
  onSelect: (path: string) => void;
}> = ({ nodes, selectedPath, level = 0, onSelect }) => {
  if (!nodes.length) {
    return null;
  }

  return (
    <div className="space-y-1">
      {nodes.map((node) => {
        const isSelected = selectedPath === node.path;
        return (
          <div key={node.path} className="space-y-1">
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
                isSelected
                  ? "bg-primary/10 text-primary"
                  : "text-slate-600 hover:bg-[#f0f4f7] hover:text-foreground"
              }`}
              style={{ paddingLeft: `${12 + level * 18}px` }}
            >
              {isSelected ? <Check className="h-4 w-4" /> : <FolderOpen className="h-4 w-4 text-slate-400" />}
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
            </button>
            <FolderTree nodes={node.children || []} selectedPath={selectedPath} level={level + 1} onSelect={onSelect} />
          </div>
        );
      })}
    </div>
  );
};

export const AutomationSettings: React.FC<AutomationSettingsProps> = ({
  draftSettings,
  setDraftSettings,
  isManualFinalRunPending,
  onManualFinalRun,
}) => {
  const MIN_DURATION_SECONDS = 15;
  const MAX_DURATION_SECONDS = 120;
  const autoActive = draftSettings.auto_generate_final_videos ?? false;
  const dailyCount = draftSettings.daily_final_video_count || 0;
  const dailyLimit = draftSettings.daily_final_video_limit || 1;
  const projectCount = draftSettings.monthly_final_video_count || 0;
  const projectLimit = draftSettings.monthly_final_video_limit || 1;
  const automationStoppedAt = draftSettings.final_video_automation_stopped_at || null;
  const automationStopReason = draftSettings.final_video_automation_stop_reason || null;
  const openJobs = draftSettings.open_final_video_jobs || 0;
  const [dailyLimitInput, setDailyLimitInput] = React.useState(String(dailyLimit));
  const [projectLimitInput, setProjectLimitInput] = React.useState(String(projectLimit));
  const [folderRoot, setFolderRoot] = React.useState<YandexDiskFolderNode | null>(null);
  const [isLoadingFolders, setIsLoadingFolders] = React.useState(false);
  const [folderLoadError, setFolderLoadError] = React.useState<string | null>(null);

  const targetMin = draftSettings.target_duration_min_seconds || draftSettings.target_duration_seconds || MIN_DURATION_SECONDS;
  const targetMax = draftSettings.target_duration_max_seconds || draftSettings.target_duration_seconds || MIN_DURATION_SECONDS;
  const [targetMinInput, setTargetMinInput] = React.useState(String(targetMin));
  const [targetMaxInput, setTargetMaxInput] = React.useState(String(targetMax));

  React.useEffect(() => {
    setTargetMinInput(String(targetMin));
  }, [targetMin]);

  React.useEffect(() => {
    setTargetMaxInput(String(targetMax));
  }, [targetMax]);

  React.useEffect(() => {
    setDailyLimitInput(String(dailyLimit));
  }, [dailyLimit]);

  React.useEffect(() => {
    setProjectLimitInput(String(projectLimit));
  }, [projectLimit]);

  const loadYandexFolders = React.useCallback(async () => {
    setIsLoadingFolders(true);
    setFolderLoadError(null);

    try {
      const response = await fetch("/api/yandex-disk/automation-folders", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось загрузить папки Яндекс.Диска");
      }
      setFolderRoot(payload.root || null);
    } catch (error) {
      setFolderLoadError(error instanceof Error ? error.message : "Не удалось загрузить папки Яндекс.Диска");
    } finally {
      setIsLoadingFolders(false);
    }
  }, []);

  React.useEffect(() => {
    loadYandexFolders();
  }, [loadYandexFolders]);

  const commitDailyLimitInput = () => {
    const parsed = Number(dailyLimitInput);
    let committedDaily = dailyLimit;

    setDraftSettings((prev) => {
      const fallbackDaily = Number(prev.daily_final_video_limit || 1);
      const normalizedDaily = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : fallbackDaily;
      committedDaily = normalizedDaily;
      return {
        ...prev,
        daily_final_video_limit: normalizedDaily,
      };
    });

    setDailyLimitInput(String(committedDaily));
  };

  const commitProjectLimitInput = () => {
    const parsed = Number(projectLimitInput);
    let committedProject = projectLimit;

    setDraftSettings((prev) => {
      const fallbackMonthly = Number(prev.monthly_final_video_limit || 1);
      const normalizedMonthlyCandidate = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : fallbackMonthly;
      const normalizedMonthly = Math.max(1, normalizedMonthlyCandidate);
      committedProject = normalizedMonthly;
      return {
        ...prev,
        monthly_final_video_limit: normalizedMonthly,
      };
    });

    setProjectLimitInput(String(committedProject));
  };

  const commitTargetMinInput = () => {
    const parsed = Number(targetMinInput);
    let committedMin = targetMin;
    let committedMax = targetMax;

    setDraftSettings((prev) => {
      const fallbackMin =
        Number(prev.target_duration_min_seconds || prev.target_duration_seconds || MIN_DURATION_SECONDS);
      const fallbackMax =
        Number(prev.target_duration_max_seconds || prev.target_duration_seconds || fallbackMin);
      const normalizedMin = Number.isFinite(parsed)
        ? Math.max(MIN_DURATION_SECONDS, Math.min(MAX_DURATION_SECONDS, parsed))
        : fallbackMin;
      const normalizedMax = Math.max(normalizedMin, fallbackMax);
      committedMin = normalizedMin;
      committedMax = normalizedMax;
      return {
        ...prev,
        target_duration_seconds: Math.round((normalizedMin + normalizedMax) / 2),
        target_duration_min_seconds: normalizedMin,
        target_duration_max_seconds: normalizedMax,
      };
    });

    setTargetMinInput(String(committedMin));
    setTargetMaxInput(String(committedMax));
  };

  const commitTargetMaxInput = () => {
    const parsed = Number(targetMaxInput);
    let committedMin = targetMin;
    let committedMax = targetMax;

    setDraftSettings((prev) => {
      const fallbackMin =
        Number(prev.target_duration_min_seconds || prev.target_duration_seconds || MIN_DURATION_SECONDS);
      const fallbackMax =
        Number(prev.target_duration_max_seconds || prev.target_duration_seconds || fallbackMin);
      const normalizedMaxCandidate = Number.isFinite(parsed)
        ? Math.max(MIN_DURATION_SECONDS, Math.min(MAX_DURATION_SECONDS, parsed))
        : fallbackMax;
      const normalizedMax = Math.max(fallbackMin, normalizedMaxCandidate);
      const normalizedMin = Math.min(fallbackMin, normalizedMax);
      committedMin = normalizedMin;
      committedMax = normalizedMax;
      return {
        ...prev,
        target_duration_seconds: Math.round((normalizedMin + normalizedMax) / 2),
        target_duration_min_seconds: normalizedMin,
        target_duration_max_seconds: normalizedMax,
      };
    });

    setTargetMinInput(String(committedMin));
    setTargetMaxInput(String(committedMax));
  };

  // Approximate words calculation (similar to original logic)
  const estMin = Math.round(targetMin * 2.2);
  const estMax = Math.round(targetMax * 2.2);

  const dailyProgress = Math.min(100, Math.round((dailyCount / Math.max(1, dailyLimit)) * 100));
  const projectProgress = Math.min(100, Math.round((projectCount / Math.max(1, projectLimit)) * 100));
  const manualRunHint = `Ручной запуск добавляет до ${dailyLimit} задач в очередь с учетом лимита проекта.`;
  const formattedStoppedAt = automationStoppedAt
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(automationStoppedAt))
    : null;

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
                <span className="text-muted-foreground">Создано в проекте (запрошено):</span>
                <span className="text-foreground">{projectCount} / {projectLimit}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">В очереди:</span>
                <span className="text-foreground">{openJobs} задач</span>
              </div>
              {formattedStoppedAt ? (
                <>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Дата остановки:</span>
                    <span className="text-right text-foreground">{formattedStoppedAt}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Причина остановки:</span>
                    <span className="text-right text-foreground">
                      {automationStopReason || "Достигнут лимит проекта"}
                    </span>
                  </div>
                </>
              ) : null}
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
                step={1}
                value={dailyLimitInput}
                onChange={(event) => setDailyLimitInput(event.target.value)}
                onBlur={commitDailyLimitInput}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm font-bold text-foreground outline-none focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Лимит проекта
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={projectLimitInput}
                onChange={(event) => setProjectLimitInput(event.target.value)}
                onBlur={commitProjectLimitInput}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
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
              <span>Прогресс проекта</span>
              <span>{projectProgress}%</span>
            </div>
            <div className="h-2 rounded-full bg-[#f0f4f7] overflow-hidden">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${projectProgress}%` }} />
            </div>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-white/70 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <FolderOpen className="h-4 w-4" />
              Папка Яндекс.Диска для готовых роликов
            </label>
            <button
              type="button"
              onClick={loadYandexFolders}
              disabled={isLoadingFolders}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#d6e0e8] bg-white px-3 text-xs font-bold text-slate-600 transition-colors hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingFolders ? "animate-spin" : ""}`} />
              Обновить
            </button>
          </div>
          <input
            type="text"
            value={draftSettings.yandex_disk_folder_path || ""}
            onChange={(event) =>
              setDraftSettings((prev) => ({ ...prev, yandex_disk_folder_path: event.target.value }))
            }
            placeholder="disk:/ВИДЕО/Проект или ВИДЕО/Проект"
            className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/10"
          />
          <p className="text-xs text-muted-foreground">
            Если поле пустое, используется текущая папка по умолчанию для аватара и проекта.
          </p>
          <div className="rounded-xl border border-[#e5ebf0] bg-[#fbfcfd] p-3">
            {isLoadingFolders ? (
              <div className="flex items-center gap-2 px-2 py-3 text-sm font-semibold text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Загружаю папки...
              </div>
            ) : folderLoadError ? (
              <div className="px-2 py-3 text-sm font-semibold text-rose-500">{folderLoadError}</div>
            ) : folderRoot ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setDraftSettings((prev) => ({ ...prev, yandex_disk_folder_path: folderRoot.path }))}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-black transition-colors ${
                    draftSettings.yandex_disk_folder_path === folderRoot.path
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-[#f0f4f7]"
                  }`}
                >
                  {draftSettings.yandex_disk_folder_path === folderRoot.path ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <FolderOpen className="h-4 w-4 text-slate-400" />
                  )}
                  {folderRoot.name}
                </button>
                <FolderTree
                  nodes={folderRoot.children || []}
                  selectedPath={draftSettings.yandex_disk_folder_path || ""}
                  onSelect={(path) => setDraftSettings((prev) => ({ ...prev, yandex_disk_folder_path: path }))}
                />
              </div>
            ) : (
              <div className="px-2 py-3 text-sm font-semibold text-muted-foreground">
                Папки в disk:/ВИДЕО/АВТОМАТ не найдены.
              </div>
            )}
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
	                    min={MIN_DURATION_SECONDS}
	                    max={MAX_DURATION_SECONDS}
	                    step={5}
	                    value={targetMinInput}
	                    onChange={(event) => setTargetMinInput(event.target.value)}
	                    onBlur={commitTargetMinInput}
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
	                    min={MIN_DURATION_SECONDS}
	                    max={MAX_DURATION_SECONDS}
	                    step={5}
	                    value={targetMaxInput}
	                    onChange={(event) => setTargetMaxInput(event.target.value)}
	                    onBlur={commitTargetMaxInput}
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
