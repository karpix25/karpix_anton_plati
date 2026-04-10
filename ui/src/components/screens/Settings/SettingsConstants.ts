import { Settings } from "@/types";

export const PACING_LABELS: Record<Settings["broll_pacing_profile"], { title: string; description: string; averageBrollSeconds: number }> = {
  calm: {
    title: "Спокойно",
    description: "Реже перебивки, длиннее удержание аватара, мягче монтаж.",
    averageBrollSeconds: 2.4,
  },
  balanced: {
    title: "Сбалансированно",
    description: "Профессиональный дефолт для talking-head с b-roll.",
    averageBrollSeconds: 2.0,
  },
  dynamic: {
    title: "Динамично",
    description: "Чаще перебивки, но только если текст и паузы это позволяют.",
    averageBrollSeconds: 1.7,
  },
};

export const BROLL_PACING_OPTIONS = PACING_LABELS;

export const BROLL_TIMING_MODE_OPTIONS: Record<
  Settings["broll_timing_mode"],
  { title: string; description: string }
> = {
  semantic_pause: {
    title: "По паузам и смыслу",
    description: "LLM анализирует смысл текста и расставляет видео там, где они лучше всего иллюстрируют сказанное.",
  },
  coverage_percent: {
    title: "По проценту покрытия",
    description: "Система старается заполнить ролик перебивками так, чтобы они занимали определённую долю времени.",
  },
  fixed: {
    title: "Фиксированный интервал",
    description: "Жёсткий ритм: ровно через каждые несколько секунд аватар сменяется видео-футажом.",
  },
};

export const BROLL_GENERATOR_MODEL_LABELS: Record<
  Settings["broll_generator_model"],
  { title: string; description: string }
> = {
  "bytedance/v1-pro-text-to-video": {
    title: "KIE V1 Pro",
    description: "Текущий базовый генератор перебивок через KIE.",
  },
  "bytedance/seedance-1.5-pro": {
    title: "Seedance 1.5 Pro",
    description: "Новая модель KIE для генерации перебивок с API Seedance 1.5 Pro.",
  },
  "grok-imagine/text-to-video": {
    title: "Grok Imagine T2V",
    description: "KIE Text To Video: вертикальные ролики 6 секунд, mode normal, 720p.",
  },
  "veo3": {
    title: "Veo 3.1 Quality",
    description: "Флагманская модель Google Veo 3.1: высочайшее качество и детализация, 1080p.",
  },
  "veo3_fast": {
    title: "Veo 3.1 Fast",
    description: "Быстрая и экономичная версия Veo 3.1: отличный баланс качества и скорости.",
  },
  "veo3_lite": {
    title: "Veo 3.1 Lite",
    description: "Самая доступная версия Veo 3.1: высокая скорость и минимальная стоимость.",
  },
};

export const BROLL_GENERATOR_OPTIONS = BROLL_GENERATOR_MODEL_LABELS;

export const SEMANTIC_RELEVANCE_LABELS: Record<NonNullable<Settings["broll_semantic_relevance_priority"]>, { title: string; description: string }> = {
  precision: {
    title: "Максимально в тему",
    description: "Лучше меньше перебивок, но каждая должна точно иллюстрировать ключевой смысловой блок.",
  },
  balanced: {
    title: "Баланс",
    description: "Компромисс между точностью смысла и плотностью монтажа.",
  },
  dynamic: {
    title: "Больше динамики",
    description: "Можно чаще менять перебивки, если они остаются релевантными сценарию.",
  },
};

export const SEMANTIC_RELEVANCE_OPTIONS = SEMANTIC_RELEVANCE_LABELS;

export const PRODUCT_CLIP_POLICY_LABELS: Record<NonNullable<Settings["broll_product_clip_policy"]>, { title: string; description: string }> = {
  contextual: {
    title: "Контекстная вставка",
    description: "Нативный монтаж: если ИИ решит, что генерация лучше раскрывает смысл, то вставит её вместо товара.",
  },
  required: {
    title: "Обязательно (по ключу)",
    description: "Прямая вставка: если ключевое слово произносится в тексте, видео товара будет вставлено 100%.",
  },
};

export const PRODUCT_CLIP_POLICY_OPTIONS = PRODUCT_CLIP_POLICY_LABELS;

export const HEYGEN_MOTION_TYPE_OPTIONS = [
  { value: "consistent", label: "Consistent" },
  { value: "expressive", label: "Expressive" },
  { value: "consistent_gen_3", label: "Consistent Gen 3" },
  { value: "hailuo_2", label: "Hailuo 2" },
  { value: "veo2", label: "Veo 2" },
  { value: "seedance_lite", label: "Seedance Lite" },
  { value: "kling", label: "Kling" },
] as const;

export const DEFAULT_MINIMAX_VOICE_ID = "Russian_Engaging_Podcaster_v1";
export const DEFAULT_ELEVENLABS_VOICE_ID = "0ArNnoIAWKlT4WweaVMY";
export const DEFAULT_HEYGEN_MOTION_TYPE = "consistent";
export const HEYGEN_MOTION_PROMPT_MAX_LENGTH = 500;
export const PENDING_MOTION_STATUSES = new Set(["pending", "queued", "processing", "in_progress"]);
export const DEFAULT_HEYGEN_MOTION_PROMPT = `Лёгкое естественное дыхание, мягкие движения плеч и корпуса, деликатная живая пластика без резких жестов. Если видны руки, допустимы только аккуратные микродвижения. Если виден фон, можно оставить едва заметное фоновое движение.`;
