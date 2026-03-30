import { Button } from "@/components/ui/button";
import { Sparkles, Zap, LoaderCircle, Network, ArrowRight } from "lucide-react";
import { Client, Reference, Scenario, Screen, TopicCard } from "@/types";
import { formatUsd, getTotalGenerationCosts } from "@/lib/generation-costs";

interface DashboardScreenProps {
  selectedClient?: Client;
  references: Reference[];
  scenarios: Scenario[];
  topicCards: TopicCard[];
  generatedCount: number;
  batchRewritePending: boolean;
  batchMixPending: boolean;
  onBatchRewrite: () => void;
  onBatchMix: () => void;
  setScreen: (screen: Screen) => void;
}

export function DashboardScreen({
  selectedClient,
  references,
  scenarios,
  topicCards,
  generatedCount,
  batchRewritePending,
  batchMixPending,
  onBatchRewrite,
  onBatchMix,
  setScreen
}: DashboardScreenProps) {
  const totalCosts = getTotalGenerationCosts(scenarios);

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

        <div className="flex flex-wrap gap-3">
          <Button
            className="primary-gradient h-12 rounded-xl px-6 font-bold text-white shadow-lg"
            onClick={onBatchRewrite}
            disabled={!selectedClient || batchRewritePending}
          >
            {batchRewritePending ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            5 вариаций
          </Button>
          <Button
            variant="outline"
            className="h-12 rounded-xl border-none bg-white px-6 font-bold text-primary shadow-sm"
            onClick={onBatchMix}
            disabled={!selectedClient || batchMixPending}
          >
            {batchMixPending ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-2 h-4 w-4" />
            )}
            Тема + Структура
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Референсы", value: references.length, helper: "Исходные материалы" },
          { label: "Сценарии", value: generatedCount, helper: "Готовые тексты" },
          { label: "Темы", value: topicCards.length, helper: "Карточки тем" },
          { label: "Общий расход", value: formatUsd(totalCosts.totalCostUsd), helper: `${totalCosts.generatedPromptCount} prompts • ${totalCosts.heygenDurationSeconds.toFixed(1)}s HeyGen` },
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
