import { BackgroundAudioTag } from "@/types";

export const BACKGROUND_AUDIO_TAG_LABELS: Record<
  BackgroundAudioTag,
  { title: string; description: string }
> = {
  disturbing: {
    title: "Disturbing",
    description: "Напряжённый или тревожный музыкальный фон.",
  },
  inspiring: {
    title: "Inspiring",
    description: "Подъёмный, мотивирующий и более эпичный фон.",
  },
  neutral: {
    title: "Neutral",
    description: "Спокойный нейтральный фон без сильного эмоционального смещения.",
  },
  relax: {
    title: "Relax",
    description: "Мягкий и расслабленный фон.",
  },
};

export const DEFAULT_BACKGROUND_AUDIO_TAG: BackgroundAudioTag = "neutral";
