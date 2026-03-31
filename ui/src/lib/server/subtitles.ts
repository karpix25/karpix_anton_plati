import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { Settings, WordTimestamp } from "@/types";
import { SUBTITLE_FONT_OPTIONS, SYSTEM_SUBTITLE_FALLBACK_FAMILY } from "@/lib/subtitles";

type SubtitleRenderSettings = Pick<
  Settings,
  | "subtitles_enabled"
  | "subtitle_mode"
  | "subtitle_style_preset"
  | "subtitle_font_family"
  | "subtitle_font_color"
  | "subtitle_font_weight"
  | "subtitle_outline_color"
  | "subtitle_outline_width"
>;

type SubtitleEvent = {
  start: number;
  end: number;
  text: string;
};

const DEFAULT_SUBTITLE_SETTINGS: SubtitleRenderSettings = {
  subtitles_enabled: false,
  subtitle_mode: "word_by_word",
  subtitle_style_preset: "classic",
  subtitle_font_family: "pt_sans",
  subtitle_font_color: "#FFFFFF",
  subtitle_font_weight: 700,
  subtitle_outline_color: "#111111",
  subtitle_outline_width: 3,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value: string | null | undefined, fallback: string) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toUpperCase();
  }
  return fallback;
}

function hexToAssColor(hex: string, alphaHex = "00") {
  const normalized = normalizeHexColor(hex, "#FFFFFF").slice(1);
  const rr = normalized.slice(0, 2);
  const gg = normalized.slice(2, 4);
  const bb = normalized.slice(4, 6);
  return `&H${alphaHex}${bb}${gg}${rr}`;
}

function formatAssTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);
  const centiseconds = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function escapeAssText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function normalizeWord(word: WordTimestamp) {
  const start = Number(word.start || 0);
  const end = Number(word.end || 0);
  const text = String(word.punctuated_word || word.word || "").trim();
  return {
    start,
    end,
    text,
  };
}

function buildWordByWordEvents(words: WordTimestamp[], totalDuration: number, preset: SubtitleRenderSettings["subtitle_style_preset"]) {
  const normalizedWords = words
    .map(normalizeWord)
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);

  const events: SubtitleEvent[] = [];

  for (let index = 0; index < normalizedWords.length; index += 1) {
    const current = normalizedWords[index];
    const next = normalizedWords[index + 1];
    const start = current.start;
    const naturalEnd = next ? Math.max(current.end, next.start - 0.02) : current.end + 0.6;
    const cappedEnd = Math.min(totalDuration, naturalEnd);
    const text = preset === "impact" ? current.text.toUpperCase() : current.text;

    if (cappedEnd - start < 0.05) {
      continue;
    }

    events.push({
      start,
      end: cappedEnd,
      text,
    });
  }

  return events;
}

function buildPhraseBlockEvents(words: WordTimestamp[], totalDuration: number, preset: SubtitleRenderSettings["subtitle_style_preset"]) {
  const normalizedWords = words
    .map(normalizeWord)
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);

  const events: SubtitleEvent[] = [];
  let phraseWords: typeof normalizedWords = [];

  const flushPhrase = () => {
    if (!phraseWords.length) return;
    const start = phraseWords[0].start;
    const end = Math.min(totalDuration, phraseWords[phraseWords.length - 1].end + 0.15);
    const text = phraseWords.map((item) => item.text).join(" ");
    events.push({
      start,
      end,
      text: preset === "impact" ? text.toUpperCase() : text,
    });
    phraseWords = [];
  };

  for (let index = 0; index < normalizedWords.length; index += 1) {
    const current = normalizedWords[index];
    const previous = phraseWords[phraseWords.length - 1];
    const gap = previous ? current.start - previous.end : 0;

    if (
      previous &&
      (gap > 0.42 ||
        /[.!?;:]$/.test(previous.text) ||
        phraseWords.length >= 6 ||
        current.end - phraseWords[0].start > 2.8)
    ) {
      flushPhrase();
    }

    phraseWords.push(current);
  }

  flushPhrase();
  return events;
}

function buildSubtitleEvents(words: WordTimestamp[], settings: SubtitleRenderSettings, totalDuration: number) {
  return settings.subtitle_mode === "phrase_block"
    ? buildPhraseBlockEvents(words, totalDuration, settings.subtitle_style_preset)
    : buildWordByWordEvents(words, totalDuration, settings.subtitle_style_preset);
}

function buildAssContent(events: SubtitleEvent[], fontFamily: string, settings: SubtitleRenderSettings) {
  const primaryColour = hexToAssColor(settings.subtitle_font_color, "00");
  const outlineColour = hexToAssColor(settings.subtitle_outline_color, "00");
  const backColour =
    settings.subtitle_style_preset === "soft_box" ? hexToAssColor("#000000", "7A") : hexToAssColor("#000000", "FF");
  const borderStyle = settings.subtitle_style_preset === "soft_box" ? 3 : 1;
  const fontSize = settings.subtitle_style_preset === "impact" ? 28 : settings.subtitle_style_preset === "soft_box" ? 24 : 25;
  const outline = settings.subtitle_style_preset === "impact"
    ? clamp(Number(settings.subtitle_outline_width || 3) + 1, 0, 8)
    : clamp(Number(settings.subtitle_outline_width || 3), 0, 8);
  const marginV = settings.subtitle_style_preset === "impact" ? 180 : settings.subtitle_style_preset === "soft_box" ? 155 : 140;
  const spacing = settings.subtitle_style_preset === "impact" ? 0.4 : 0;
  const bold = Number(settings.subtitle_font_weight) === 400 ? 0 : -1;

  return `[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
PlayResX: 720
PlayResY: 1280
Collisions: Normal

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Subtitle,${fontFamily},${fontSize},${primaryColour},${primaryColour},${outlineColour},${backColour},${bold},0,0,0,100,100,${spacing},0,${borderStyle},${outline},0,2,42,42,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events
  .map(
    (event) =>
      `Dialogue: 0,${formatAssTime(event.start)},${formatAssTime(event.end)},Subtitle,,0,0,0,,${escapeAssText(event.text)}`
  )
  .join("\n")}
`;
}

async function downloadFileIfMissing(url: string, targetPath: string) {
  if (existsSync(targetPath)) {
    return;
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to download subtitle font: ${url}`);
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, fileBuffer);
}

async function ensureSubtitleFontAssets(fontFamilyKey: SubtitleRenderSettings["subtitle_font_family"]) {
  const fontDefinition = SUBTITLE_FONT_OPTIONS[fontFamilyKey] || SUBTITLE_FONT_OPTIONS.pt_sans;
  const fontsDir = path.join("/tmp", "platipo-miru-fonts", fontFamilyKey || "pt_sans");
  await mkdir(fontsDir, { recursive: true });

  try {
    await downloadFileIfMissing(fontDefinition.regularUrl, path.join(fontsDir, "Regular.ttf"));
    await downloadFileIfMissing(fontDefinition.boldUrl, path.join(fontsDir, "Bold.ttf"));
    return {
      fontsDir,
      fontFamily: fontDefinition.family,
    };
  } catch (error) {
    console.warn("Subtitle font download failed, fallback to system font:", error);
    return {
      fontsDir: null,
      fontFamily: SYSTEM_SUBTITLE_FALLBACK_FAMILY,
    };
  }
}

export async function materializeSubtitleTrack(options: {
  settings: Partial<SubtitleRenderSettings> | null | undefined;
  words: WordTimestamp[] | null | undefined;
  totalDuration: number;
  workdir: string;
}) {
  const settings: SubtitleRenderSettings = {
    ...DEFAULT_SUBTITLE_SETTINGS,
    ...(options.settings || {}),
    subtitle_font_color: normalizeHexColor(options.settings?.subtitle_font_color, DEFAULT_SUBTITLE_SETTINGS.subtitle_font_color),
    subtitle_outline_color: normalizeHexColor(options.settings?.subtitle_outline_color, DEFAULT_SUBTITLE_SETTINGS.subtitle_outline_color),
    subtitle_font_weight: Number(options.settings?.subtitle_font_weight) === 400 ? 400 : 700,
    subtitle_outline_width: clamp(Number(options.settings?.subtitle_outline_width || DEFAULT_SUBTITLE_SETTINGS.subtitle_outline_width), 0, 8),
  };

  if (!settings.subtitles_enabled) {
    return null;
  }

  const words = (options.words || []).filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end));
  if (!words.length) {
    throw new Error("Word timestamps are required to render subtitles");
  }

  const events = buildSubtitleEvents(words, settings, options.totalDuration);
  if (!events.length) {
    throw new Error("Failed to build subtitle events from word timestamps");
  }

  const { fontsDir, fontFamily } = await ensureSubtitleFontAssets(settings.subtitle_font_family);
  const assContent = buildAssContent(events, fontFamily, settings);
  const subtitlePath = path.join(options.workdir, "subtitles.ass");
  await writeFile(subtitlePath, assContent, "utf8");

  return {
    subtitlePath,
    fontsDir,
    fontFamily,
  };
}
