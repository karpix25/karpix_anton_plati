import { Scenario, ScenarioVideoPromptItem, WordTimestamp } from "@/types";

export const PROMPT_GENERATION_COST_USD = 0.03;
export const HEYGEN_COST_PER_MINUTE_USD = 1;

export function getScenarioDurationSeconds(words?: WordTimestamp[] | null): number {
  const normalizedWords = words || [];
  return normalizedWords.reduce((maxEnd, word) => {
    const end = Number(word?.end || 0);
    return Number.isFinite(end) ? Math.max(maxEnd, end) : maxEnd;
  }, 0);
}

export function getGeneratedPromptCount(prompts?: ScenarioVideoPromptItem[] | null): number {
  return (prompts || []).filter((item) => !item.use_ready_asset && item.prompt_json).length;
}

export function getScenarioGenerationCosts(scenario: Scenario) {
  const prompts = scenario.video_generation_prompts?.prompts || [];
  const words = scenario.tts_word_timestamps?.words || [];
  const generatedPromptCount = getGeneratedPromptCount(prompts);
  const promptCostUsd = generatedPromptCount * PROMPT_GENERATION_COST_USD;
  const heygenDurationSeconds = getScenarioDurationSeconds(words);
  const heygenCostUsd = (heygenDurationSeconds / 60) * HEYGEN_COST_PER_MINUTE_USD;
  const totalCostUsd = promptCostUsd + heygenCostUsd;

  return {
    generatedPromptCount,
    promptCostUsd,
    heygenDurationSeconds,
    heygenCostUsd,
    totalCostUsd,
  };
}

export function getTotalGenerationCosts(scenarios: Scenario[]) {
  return scenarios.reduce(
    (acc, scenario) => {
      const costs = getScenarioGenerationCosts(scenario);
      acc.generatedPromptCount += costs.generatedPromptCount;
      acc.promptCostUsd += costs.promptCostUsd;
      acc.heygenDurationSeconds += costs.heygenDurationSeconds;
      acc.heygenCostUsd += costs.heygenCostUsd;
      acc.totalCostUsd += costs.totalCostUsd;
      return acc;
    },
    {
      generatedPromptCount: 0,
      promptCostUsd: 0,
      heygenDurationSeconds: 0,
      heygenCostUsd: 0,
      totalCostUsd: 0,
    }
  );
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(3)}`;
}
