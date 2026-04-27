import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Network, ArrowRight } from "lucide-react";
import { Client, DashboardMonthlyStats, Screen, TopicCard } from "@/types";
import { formatUsd } from "@/lib/generation-costs";

interface DashboardScreenProps {
  selectedClient?: Client;
  selectedClientId?: string;
  totalReferences: number;
  totalScenarios: number;
  topicCards: TopicCard[];
  costStats: {
    totalPrompts: number;
    totalHeygenDuration: number;
    totalCostUsd: number;
  };
  setScreen: (screen: Screen) => void;
}

const toMonthKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

const buildLastMonths = (count: number): string[] => {
  const now = new Date();
  const result: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(toMonthKey(d));
  }
  return result;
};

export function DashboardScreen({
  selectedClient,
  selectedClientId,
  totalReferences,
  totalScenarios,
  topicCards,
  costStats,
  setScreen,
}: DashboardScreenProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>(toMonthKey(new Date()));
  const monthOptions = useMemo(() => buildLastMonths(12), []);
  const monthLabelFormatter = useMemo(
    () => new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }),
    []
  );

  const monthlyStatsQuery = useQuery<DashboardMonthlyStats>({
    queryKey: ["reports-dashboard-monthly", selectedClientId, selectedMonth],
    queryFn: async () => {
      if (!selectedClientId) {
        return {
          month: selectedMonth,
          referenceCount: 0,
          scenarioCount: 0,
          topicCount: 0,
          finalVideoCount: 0,
          totalPrompts: 0,
          totalHeygenDuration: 0,
          totalCostUsd: 0,
        };
      }
      const { data } = await axios.get("/api/reports/dashboard-monthly", {
        params: { clientId: selectedClientId, month: selectedMonth },
      });
      return {
        month: String(data?.month || selectedMonth),
        referenceCount: Number(data?.referenceCount || 0),
        scenarioCount: Number(data?.scenarioCount || 0),
        topicCount: Number(data?.topicCount || 0),
        finalVideoCount: Number(data?.finalVideoCount || 0),
        totalPrompts: Number(data?.totalPrompts || 0),
        totalHeygenDuration: Number(data?.totalHeygenDuration || 0),
        totalCostUsd: Number(data?.totalCostUsd || 0),
      };
    },
    enabled: Boolean(selectedClientId),
    staleTime: 60_000,
  });

  const monthlyStats = monthlyStatsQuery.data;
  const selectedMonthDate = new Date(`${selectedMonth}-01T00:00:00`);
  const selectedMonthLabel = Number.isNaN(selectedMonthDate.getTime())
    ? selectedMonth
    : monthLabelFormatter.format(selectedMonthDate);

  const referencesValue = monthlyStats?.referenceCount ?? totalReferences;
  const scenariosValue = monthlyStats?.scenarioCount ?? totalScenarios;
  const topicsValue = monthlyStats?.topicCount ?? topicCards.length;
  const finalVideosValue = monthlyStats?.finalVideoCount ?? Number(selectedClient?.total_final_video_count || 0);
  const totalPromptsValue = monthlyStats?.totalPrompts ?? costStats.totalPrompts;
  const heygenDurationSeconds = monthlyStats?.totalHeygenDuration ?? costStats.totalHeygenDuration;
  const totalCostUsd = monthlyStats?.totalCostUsd ?? costStats.totalCostUsd;

  return (
    <div className="max-w-7xl space-y-10">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            Центр кураторства
          </span>
          <h2 className="mb-2 text-[3.5rem] font-bold leading-none tracking-tighter text-foreground">
            Активный проект
          </h2>
          <p className="max-w-md text-muted-foreground">
            Управляй референсами, извлеченными паттернами и генерацией сценариев в одном рабочем контуре.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Месяц панели
          </label>
          <select
            className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-foreground"
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
          >
            {monthOptions.map((month) => {
              const d = new Date(`${month}-01T00:00:00`);
              const label = Number.isNaN(d.getTime()) ? month : monthLabelFormatter.format(d);
              return (
                <option key={month} value={month}>
                  {label}
                </option>
              );
            })}
          </select>
          <div className="mt-1 text-xs text-muted-foreground">
            Показатели за {selectedMonthLabel}
            {monthlyStatsQuery.isFetching ? " • обновляется..." : ""}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Референсы", value: referencesValue, helper: "Добавлено за месяц" },
          { label: "Сценарии", value: scenariosValue, helper: "Сгенерировано за месяц" },
          { label: "Финальные ролики", value: finalVideosValue, helper: "Смонтировано за месяц" },
          { label: "Темы", value: topicsValue, helper: "Создано карточек за месяц" },
          {
            label: "Общий расход",
            value: formatUsd(totalCostUsd),
            helper: `${totalPromptsValue} prompts • ${heygenDurationSeconds.toFixed(1)}s HeyGen`,
          },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-white p-6 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{item.label}</p>
            <p className="mt-2 text-5xl font-bold tracking-tighter text-foreground">{item.value}</p>
            <p className="mt-2 text-sm text-muted-foreground">{item.helper}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="group relative rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-8 flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#f0f4f7] text-primary">
              <Network className="h-6 w-6" />
            </div>
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              активен
            </span>
          </div>
          <h3 className="mb-2 text-xl font-semibold text-foreground">{selectedClient?.name || "Не выбран"}</h3>
          <p className="mb-6 line-clamp-3 text-sm text-muted-foreground">
            {selectedClient?.product_info || "Добавь описание продукта, чтобы сценарии создавались точнее."}
          </p>
          <div className="flex items-center justify-between border-t border-[#f0f4f7] pt-6">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Последнее действие
              </span>
              <div className="text-sm font-medium">Сейчас</div>
            </div>
            <button className="rounded-lg bg-[#f0f4f7] p-2 text-foreground">
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-[#f0f4f7] p-8 lg:col-span-2">
          <h4 className="text-2xl font-semibold text-foreground">Система работает так</h4>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Референсы анализируются, затем из них извлекаются темы и паттерны. После этого можно либо
            переписывать конкретный исходник, либо генерировать новые сценарии на основе комбинации theme + structure.
          </p>
          <div className="mt-6 flex gap-6">
            <button
              onClick={() => setScreen("references")}
              className="border-b-2 border-primary/20 pb-1 text-xs font-bold uppercase tracking-widest text-primary"
            >
              Просмотреть референсы
            </button>
            <button
              onClick={() => setScreen("graph")}
              className="pb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-primary"
            >
              Темы и паттерны
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

