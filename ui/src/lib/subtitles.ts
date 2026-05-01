import { SubtitleMode, SubtitleStylePreset } from "@/types";

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

export const DEFAULT_SUBTITLE_FONT_FAMILY = "pt_sans";

export type SubtitlePresetFontKey =
  | "pt_sans"
  | "rubik"
  | "montserrat"
  | "oswald"
  | "noto_sans";

export const SUBTITLE_FONT_OPTIONS: Record<
  SubtitlePresetFontKey,
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
    regularUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/ptsans/PT_Sans-Web-Regular.ttf",
    boldUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/ptsans/PT_Sans-Web-Bold.ttf",
  },
  rubik: {
    title: "Rubik",
    family: "Rubik",
    description: "Более мягкая геометрия, хорошо смотрится в word-by-word.",
    stylesheetUrl: "https://fonts.googleapis.com/css2?family=Rubik:wght@400;700&display=swap&subset=cyrillic",
    regularUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/rubik/static/Rubik-Regular.ttf",
    boldUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/rubik/static/Rubik-Bold.ttf",
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
    regularUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/static/Oswald-Regular.ttf",
    boldUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/static/Oswald-Bold.ttf",
  },
  noto_sans: {
    title: "Noto Sans",
    family: "Noto Sans",
    description: "Самый безопасный Google Font для кириллицы и mixed language текста.",
    stylesheetUrl: "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&display=swap&subset=cyrillic",
    regularUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/static/NotoSans-Regular.ttf",
    boldUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/static/NotoSans-Bold.ttf",
  },
};

export const SYSTEM_SUBTITLE_FALLBACK_FAMILY = "DejaVu Sans";

export const GOOGLE_FONT_FALLBACK_FAMILIES: string[] = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Oswald",
  "Raleway",
  "Nunito",
  "Work Sans",
  "Mukta",
  "Rubik",
  "PT Sans",
  "Noto Sans",
  "Noto Serif",
  "Source Sans 3",
  "Merriweather",
  "Playfair Display",
  "Bebas Neue",
  "Manrope",
  "Fira Sans",
  "Ubuntu",
  "M PLUS 1p",
  "Barlow",
  "Barlow Condensed",
  "DM Sans",
  "IBM Plex Sans",
  "Exo 2",
  "Titillium Web",
  "Yanone Kaffeesatz",
  "Arimo",
  "Cabin",
  "Heebo",
  "Hind",
  "Inconsolata",
  "JetBrains Mono",
  "Space Grotesk",
  "Quicksand",
  "Kanit",
  "Prompt",
  "Teko",
  "Anton",
  "Archivo",
  "Asap",
  "Asap Condensed",
  "Bitter",
  "Cairo",
  "Comfortaa",
  "Cormorant Garamond",
  "Crimson Text",
  "Dosis",
  "EB Garamond",
  "Figtree",
  "Fraunces",
  "Great Vibes",
  "Josefin Sans",
  "Karla",
  "Libre Baskerville",
  "Libre Franklin",
  "Lora",
  "Mulish",
  "Nanum Gothic",
  "Newsreader",
  "Overpass",
  "PT Serif",
  "Plus Jakarta Sans",
  "Public Sans",
  "Righteous",
  "Roboto Condensed",
  "Roboto Slab",
  "Sora",
  "Tinos",
  "Varela Round",
  "Vollkorn",
  "Zilla Slab",
];

export function buildGoogleFontFamilyList(extraFamilies: string[] = []) {
  const presetFamilies = Object.values(SUBTITLE_FONT_OPTIONS).map((item) => item.family);
  const unique = new Set<string>();

  [...presetFamilies, ...GOOGLE_FONT_FALLBACK_FAMILIES, ...extraFamilies]
    .map((item) => normalizeSubtitleFontFamilyValue(item))
    .filter(Boolean)
    .forEach((item) => unique.add(item));

  return [...unique].sort((left, right) => left.localeCompare(right));
}

export function isSubtitlePresetFontKey(value: string | null | undefined): value is SubtitlePresetFontKey {
  if (!value) return false;
  return Object.prototype.hasOwnProperty.call(SUBTITLE_FONT_OPTIONS, value);
}

export function normalizeSubtitleFontFamilyValue(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) {
    return DEFAULT_SUBTITLE_FONT_FAMILY;
  }

  return normalized.slice(0, 96);
}

export function resolveSubtitleFontFamilyName(value: string | null | undefined) {
  const normalized = normalizeSubtitleFontFamilyValue(value);
  if (isSubtitlePresetFontKey(normalized)) {
    return SUBTITLE_FONT_OPTIONS[normalized].family;
  }
  return normalized;
}

export function buildGoogleFontsStylesheetUrl(fontFamily: string, weights: number[] = [400, 700]) {
  const normalizedFamily = normalizeSubtitleFontFamilyValue(fontFamily);
  const familyQuery = encodeURIComponent(normalizedFamily).replace(/%20/g, "+");
  const normalizedWeights = Array.from(new Set(weights))
    .map((weight) => Math.round(Number(weight)))
    .filter((weight) => Number.isFinite(weight) && weight >= 100 && weight <= 900)
    .sort((a, b) => a - b);

  if (normalizedWeights.length) {
    return `https://fonts.googleapis.com/css2?family=${familyQuery}:wght@${normalizedWeights.join(";")}&display=swap`;
  }

  return `https://fonts.googleapis.com/css2?family=${familyQuery}&display=swap`;
}
