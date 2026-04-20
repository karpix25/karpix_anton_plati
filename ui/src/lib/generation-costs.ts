import { Scenario, ScenarioVideoPromptItem, WordTimestamp } from "@/types";

export const PROMPT_GENERATION_COST_USD = 0.03;
export const SEEDANCE_15_PRO_GENERATION_COST_USD = 0.07;
export const GROK_IMAGINE_TEXT_TO_VIDEO_COST_USD = 0.1;
export const VEO3_QUALITY_COST_USD = 0.15;
export const VEO3_FAST_COST_USD = 0.08;
export const VEO3_LITE_COST_USD = 0.04;
export const HEYGEN_COST_PER_MINUTE_USD = 1;

export type BrollGeneratorModel =
  | "bytedance/v1-pro-text-to-video"
  | "bytedance/seedance-1.5-pro"
  | "grok-imagine/text-to-video"
  | "veo3"
  | "veo3_fast"
  | "veo3_lite";

export function getScenarioBrollGeneratorModel(scenario?: Scenario | null): BrollGeneratorModel {
  const rawModel = scenario?.video_generation_prompts?.generator_model;
  if (
    rawModel === "bytedance/seedance-1.5-pro" || 
    rawModel === "grok-imagine/text-to-video" ||
    rawModel === "veo3" ||
    rawModel === "veo3_fast" ||
    rawModel === "veo3_lite"
  ) {
    return rawModel;
  }
  return "veo3_lite";
}

export function getBrollGenerationUnitCostUsd(model: BrollGeneratorModel): number {
  if (model === "bytedance/seedance-1.5-pro") return SEEDANCE_15_PRO_GENERATION_COST_USD;
  if (model === "grok-imagine/text-to-video") return GROK_IMAGINE_TEXT_TO_VIDEO_COST_USD;
  if (model === "veo3") return VEO3_QUALITY_COST_USD;
  if (model === "veo3_fast") return VEO3_FAST_COST_USD;
  if (model === "veo3_lite") return VEO3_LITE_COST_USD;
  return PROMPT_GENERATION_COST_USD;
}

export function getScenarioDurationSeconds(words?: WordTimestamp[] | null): number {
  const normalizedWords = words || [];
  return normalizedWords.reduce((maxEnd, word) => {
    const end = Number(word?.end || 0);
    return Number.isFinite(end) ? Math.max(maxEnd, end) : maxEnd;
  }, 0);
}

export function getScenarioActualDurationSeconds(scenario?: Scenario | null): number {
  if (!scenario) return 0;
  const savedAudioDuration = Number(scenario.tts_audio_duration_seconds || 0);
  if (Number.isFinite(savedAudioDuration) && savedAudioDuration > 0) {
    return savedAudioDuration;
  }
  return getScenarioDurationSeconds(scenario.tts_word_timestamps?.words);
}

function isActuallyGeneratedPrompt(item: ScenarioVideoPromptItem): boolean {
  if (item.use_ready_asset) return false;
  if (item.video_url) return true;
  if (Array.isArray(item.result_urls) && item.result_urls.length > 0) return true;
  if (item.task_id) return true;

  const taskState = String(item.task_state || "").toLowerCase();
  if (taskState === "success" || taskState === "fail") return true;

  const submissionStatus = String(item.submission_status || "").toLowerCase();
  return ["submitted", "success", "completed", "failed"].includes(submissionStatus);
}

function hasHeygenGenerationAttempt(scenario?: Scenario | null): boolean {
  if (!scenario) return false;
  const status = String(scenario.heygen_status || "").toLowerCase();
  return Boolean(
    scenario.heygen_video_id ||
      scenario.heygen_video_url ||
      scenario.heygen_requested_at ||
      ["pending", "waiting", "processing", "queued", "in_progress", "completed", "success", "failed"].includes(status)
  );
}

export function getGeneratedPromptCount(prompts?: ScenarioVideoPromptItem[] | null): number {
  return (prompts || []).filter(isActuallyGeneratedPrompt).length;
}

export function getScenarioGenerationCosts(scenario: Scenario) {
  const prompts = scenario.video_generation_prompts?.prompts || [];
  const generatedPromptCount = getGeneratedPromptCount(prompts);
  const generatorModel = getScenarioBrollGeneratorModel(scenario);
  const promptUnitCostUsd = getBrollGenerationUnitCostUsd(generatorModel);
  const promptCostUsd = generatedPromptCount * promptUnitCostUsd;
  const heygenDurationSeconds = hasHeygenGenerationAttempt(scenario) ? getScenarioActualDurationSeconds(scenario) : 0;
  const heygenCostUsd = (heygenDurationSeconds / 60) * HEYGEN_COST_PER_MINUTE_USD;
  const totalCostUsd = promptCostUsd + heygenCostUsd;

  return {
    generatedPromptCount,
    generatorModel,
    promptUnitCostUsd,
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
  const normalized = Number(value);
  const safeValue = Number.isFinite(normalized) ? normalized : 0;
  return `$${safeValue.toFixed(3)}`;
}
