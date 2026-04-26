import { SubtitleFontFamily, SubtitleMode, SubtitleStylePreset } from "@/types";

export const SUBTITLE_MODE_OPTIONS: Record<
  SubtitleMode,
  { title: string; description: string }
> = {
  word_by_word: {
    title: "По одному слову",
    description: "Каждое слово появляется отдельным титром по реальному word timestamp.",
  },
  phrase_block: {
    title: "Фразами",
    description: "Слова группируются в короткие фразы по паузам и пунктуации.",
  },
};

export const SUBTITLE_STYLE_PRESET_OPTIONS: Record<
  SubtitleStylePreset,
  { title: string; description: string }
> = {
  classic: {
    title: "Classic Outline",
    description: "Чистый нижний титр с обводкой и без лишнего декора.",
  },
  impact: {
    title: "Impact",
    description: "Крупнее, плотнее и агрессивнее для коротких attention-cut роликов.",
  },
  soft_box: {
    title: "Soft Box",
    description: "Мягкий титр на полупрозрачной плашке для спокойной подачи.",
  },
};

export const SUBTITLE_PRESET_DEFAULT_MARGIN_V: Record<SubtitleStylePreset, number> = {
  classic: 140,
  impact: 180,
  soft_box: 155,
};

export const SUBTITLE_PRESET_DEFAULT_MARGIN_PERCENT: Record<SubtitleStylePreset, number> = {
  classic: 11,
  impact: 14,
  soft_box: 12,
};

export const SUBTITLE_FONT_OPTIONS: Record<
  SubtitleFontFamily,
  {
    title: string;
    family: string;
    description: string;
    stylesheetUrl: string;
    regularUrl: string;
    boldUrl: string;
  }
> = {
  pt_sans: {
    title: "PT Sans",
    family: "PT Sans",
    description: "Нейтральный Cyrillic-safe Google Font для чистых субтитров.",
    stylesheetUrl: "https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700&display=swap&subset=cyrillic",
    regularUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/ptsans/PTSans-Regular.ttf",
    boldUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/ptsans/PTSans-Bold.ttf",
  },
  rubik: {
    title: "Rubik",
    family: "Rubik",
    description: "Более мягкая геометрия, хорошо смотрится в word-by-word.",
    stylesheetUrl: "https://fonts.googleapis.com/css2?family=Rubik:wght@400;700&display=swap&subset=cyrillic",
    regularUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/rubik/Rubik-Regular.ttf",
    boldUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/rubik/Rubik-Bold.ttf",
  },
  montserrat: {
    title: "Montserrat",
    family: "Montserrat",
    description: "Выразительный гротеск с сильным рекламным ощущением.",
    stylesheetUrl: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap&subset=cyrillic",
    regularUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/static/Montserrat-Regular.ttf",
    boldUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/static/Montserrat-Bold.ttf",
  },
  oswald: {
    title: "Oswald",
    family: "Oswald",
    description: "Узкий и плотный шрифт для aggressive subtitle preset.",
    stylesheetUrl: "https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&display=swap&subset=cyrillic",
    regularUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/Oswald-Regular.ttf",
    boldUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/Oswald-Bold.ttf",
  },
  noto_sans: {
    title: "Noto Sans",
    family: "Noto Sans",
    description: "Самый безопасный Google Font для кириллицы и mixed language текста.",
    stylesheetUrl: "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&display=swap&subset=cyrillic",
    regularUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans-Regular.ttf",
    boldUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans-Bold.ttf",
  },
};

export const SYSTEM_SUBTITLE_FALLBACK_FAMILY = "DejaVu Sans";
