import { Network, ArrowRight } from "lucide-react";
import { Client, MonthlyFinalVideoStat, Screen, TopicCard } from "@/types";
import { formatUsd } from "@/lib/generation-costs";

interface DashboardScreenProps {
  selectedClient?: Client;
  totalReferences: number;
  totalScenarios: number;
  topicCards: TopicCard[];
  costStats: {
    totalPrompts: number;
    totalHeygenDuration: number;
    totalCostUsd: number;
  };
  finalVideosMonthly: MonthlyFinalVideoStat[];
  setScreen: (screen: Screen) => void;
}

export function DashboardScreen({
  selectedClient,
  totalReferences,
  totalScenarios,
  topicCards,
  costStats,
  finalVideosMonthly,
  setScreen
}: DashboardScreenProps) {
  const totalCostUsd = costStats.totalCostUsd;
  const heygenDurationSeconds = costStats.totalHeygenDuration;
  const monthLabelFormatter = new Intl.DateTimeFormat("ru-RU", { month: "short", year: "numeric" });

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
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Референсы", value: totalReferences, helper: "Исходные материалы" },
          { label: "Сценарии", value: totalScenarios, helper: "Готовые тексты" },
          {
            label: "Финальные ролики",
            value: Number(selectedClient?.total_final_video_count || 0),
            helper: "Смонтировано (всего)",
          },
          { label: "Темы", value: topicCards.length, helper: "Карточки тем" },
          { label: "Общий расход", value: formatUsd(totalCostUsd), helper: `${costStats.totalPrompts} prompts • ${heygenDurationSeconds.toFixed(1)}s HeyGen` },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-white p-6 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{item.label}</p>
            <p className="mt-2 text-5xl font-bold tracking-tighter text-foreground">{item.value}</p>
            <p className="mt-2 text-sm text-muted-foreground">{item.helper}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Финальные ролики по месяцам
          </p>
          <p className="text-xs text-muted-foreground">Последние 12 месяцев</p>
        </div>
        {finalVideosMonthly.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {finalVideosMonthly.map((item) => {
              const date = new Date(`${item.monthStart}T00:00:00`);
              const monthLabel = Number.isNaN(date.getTime())
                ? item.month
                : monthLabelFormatter.format(date);
              return (
                <div key={item.month} className="rounded-lg border border-[#f0f4f7] bg-[#fafbfc] px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{monthLabel}</div>
                  <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">{item.completed}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 text-sm text-muted-foreground">Нет данных по финальным роликам за период.</div>
        )}
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
