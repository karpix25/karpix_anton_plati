import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { Settings, WordTimestamp, SubtitleFontFamily } from "@/types";
import {
  SUBTITLE_FONT_OPTIONS,
  SUBTITLE_PRESET_DEFAULT_MARGIN_PERCENT,
  SUBTITLE_PRESET_DEFAULT_MARGIN_V,
  SYSTEM_SUBTITLE_FALLBACK_FAMILY,
} from "@/lib/subtitles";

const SUBTITLE_PLAY_RES_X = 1080;
const SUBTITLE_PLAY_RES_Y = 1920;

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
  | "subtitle_margin_v"
  | "subtitle_margin_percent"
  | "typography_hook_enabled"
>;

type SubtitleEvent = {
  start: number;
  end: number;
  text: string;
  isHook?: boolean;
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
  subtitle_margin_v: SUBTITLE_PRESET_DEFAULT_MARGIN_V.classic,
  subtitle_margin_percent: SUBTITLE_PRESET_DEFAULT_MARGIN_PERCENT.classic,
  typography_hook_enabled: false,
};

const WORD_SUBTITLE_LEAD_IN_SECONDS = 0.04;
const WORD_SUBTITLE_MIN_DURATION_SECONDS = 0.28;
const WORD_SUBTITLE_MAX_DURATION_SECONDS = 1.0;
const WORD_SUBTITLE_MIN_GAP_SECONDS = 0.01;
const WORD_SUBTITLE_MAX_BURST_WORDS = 3;
const WORD_SUBTITLE_BURST_JOIN_GAP_SECONDS = 0.18;

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
  let previousEventEnd = 0;
  let index = 0;

  while (index < normalizedWords.length) {
    const startWord = normalizedWords[index];
    let burstEnd = startWord.end;
    const burstWords = [startWord.text];
    let lastIndex = index;

    // Merge ultra-fast neighboring words into mini-phrases for readability.
    while (lastIndex + 1 < normalizedWords.length && burstWords.length < WORD_SUBTITLE_MAX_BURST_WORDS) {
      const nextWord = normalizedWords[lastIndex + 1];
      const joinGap = nextWord.start - normalizedWords[lastIndex].end;
      const burstDurationIfJoined = nextWord.end - startWord.start;
      if (
        joinGap <= WORD_SUBTITLE_BURST_JOIN_GAP_SECONDS &&
        burstDurationIfJoined <= WORD_SUBTITLE_MIN_DURATION_SECONDS
      ) {
        burstWords.push(nextWord.text);
        burstEnd = nextWord.end;
        lastIndex += 1;
        continue;
      }
      break;
    }

    const nextAfterBurst = normalizedWords[lastIndex + 1];
    const start = Math.max(0, Math.max(startWord.start - WORD_SUBTITLE_LEAD_IN_SECONDS, previousEventEnd));
    const naturalEnd = nextAfterBurst ? Math.max(burstEnd, nextAfterBurst.start - 0.02) : burstEnd + 0.55;
    let end = Math.max(start + WORD_SUBTITLE_MIN_DURATION_SECONDS, naturalEnd);
    end = Math.min(totalDuration, Math.min(end, start + WORD_SUBTITLE_MAX_DURATION_SECONDS));

    if (nextAfterBurst) {
      const safeBeforeNext = nextAfterBurst.start + 0.12;
      end = Math.min(end, safeBeforeNext);
    }

    if (end - start >= 0.08) {
      const text = preset === "impact" ? burstWords.join(" ").toUpperCase() : burstWords.join(" ");
      events.push({
        start,
        end,
        text,
      });
      previousEventEnd = Math.max(previousEventEnd, end + WORD_SUBTITLE_MIN_GAP_SECONDS);
    }

    index = lastIndex + 1;
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

function applyMagicCharacterAnimation(text: string, baseDelayMs: number = 25) {
  // We use ASS tags to animate each character:
  // \alpha&HFF& - start invisible
  // \blur6 - start blurry
  // \fscy80 - start slightly squashed (simulates coming from below)
  // \t(delay, delay+duration, ...) - animate to clear and full size
  const chars = Array.from(text);
  let result = "";
  let currentDelay = 0;

  chars.forEach((char) => {
    if (char === " ") {
      result += " ";
      // Spaces don't need animation tags, but we keep a small delay for rhythm
      currentDelay += baseDelayMs;
      return;
    }
    
    const duration = 220;
    const tags = `{\\alpha&HFF&\\blur6\\fscy80\\t(${currentDelay},${currentDelay + duration},\\alpha&H00&\\blur0\\fscy100)}`;
    result += `${tags}${char}`;
    currentDelay += baseDelayMs;
  });

  return result;
}

function buildSubtitleEvents(words: WordTimestamp[], settings: SubtitleRenderSettings, totalDuration: number) {
  const regularEvents = settings.subtitle_mode === "phrase_block"
    ? buildPhraseBlockEvents(words, totalDuration, settings.subtitle_style_preset)
    : buildWordByWordEvents(words, totalDuration, settings.subtitle_style_preset);

  // Apply "Magic" animation to regular word-by-word events if enabled
  if (settings.subtitle_mode === "word_by_word") {
    regularEvents.forEach(event => {
      // For regular subtitles, we use a faster character delay to keep it readable
      event.text = `{\\b1}${applyMagicCharacterAnimation(event.text, 15)}`;
    });
  }

  if (!settings.typography_hook_enabled) {
    return regularEvents;
  }

  // Typography Hook Logic: 0-3 seconds
  const HOOK_LIMIT = 3.0;
  const hookWords = words
    .map(normalizeWord)
    .filter((w) => w.start < HOOK_LIMIT && w.text);

  if (hookWords.length === 0) {
    return regularEvents;
  }

  // Russian stop words to ignore in high-impact typography hooks
  const RUSSIAN_HOOK_STOP_WORDS = new Set([
    "и", "в", "во", "не", "на", "с", "со", "как", "а", "то", "все", "она", "так", "его", "но", "да", "ты", "от", "же", "вы", "за", "бы", "по", "только", "ее", "её", "мне", "было", "вот", "от", "меня", "еще", "ещё", "о", "из", "ему", "теперь", "когда", "даже", "вдруг", "ли", "если", "уже", "или", "ни", "быть", "был", "него", "до", "вас", "нибудь", "опять", "у", "вам", "ведь", "там", "потом", "себя", "ничего", "ей", "они", "тут", "где", "есть", "надо", "ней", "для", "мы", "тебя", "их", "чем", "была", "сам", "чтоб", "без", "будто", "чего", "раз", "тоже", "себе", "под", "будет", "ж", "тогда", "кто", "этот", "того", "потому", "этого", "какой", "совсем", "ним", "здесь", "этом", "один", "почти", "про", "через", "над", "об", "мой", "моя", "мое", "мои", "моим", "моей", "моих", "твой", "твоя", "твое", "твои", "свой", "своя", "свое", "свои"
  ]);

  const valuableHookWords = hookWords.filter(w => {
    const clean = w.text.toLowerCase().replace(/[^а-яёa-z0-9]/g, "");
    return clean && !RUSSIAN_HOOK_STOP_WORDS.has(clean);
  });

  // Limit hook to first 4 valuable words for maximum impact
  const maxHookWords = 4;
  const activeHookWords = valuableHookWords.length > 0 
    ? valuableHookWords.slice(0, maxHookWords)
    : hookWords.slice(0, maxHookWords);

  const hookEvents: SubtitleEvent[] = [];
  const accumulatedWords: string[] = [];

  for (let i = 0; i < activeHookWords.length; i++) {
    const word = activeHookWords[i];
    accumulatedWords.push(word.text.toUpperCase());
    
    const start = word.start;
    const nextWord = activeHookWords[i+1];
    const end = nextWord ? Math.min(nextWord.start, HOOK_LIMIT) : HOOK_LIMIT;
    
    if (end > start) {
      let formattedText = "";
      accumulatedWords.forEach((w, idx) => {
        const isLast = idx === accumulatedWords.length - 1;
        const needsNewline = (idx + 1) % 2 === 0 && !isLast;
        
        // Only the NEW word (isLast) gets the character-by-character "Magic" animation.
        // Previous words stay static to prevent visual noise.
        const content = isLast 
          ? applyMagicCharacterAnimation(w, 35) 
          : `{\\alpha&H00&\\blur0\\fscy100}${w}`;

        const style = `{\\b1}${content}`;
        formattedText += `${style}${needsNewline ? "{\\fscy40}\\N{\\fscy100}" : " "}`;
      });

      hookEvents.push({
        start,
        end,
        text: formattedText.trim(),
        isHook: true,
      });
    }
  }

  // Filter out regular events that overlap with the hook
  const filteredRegular = regularEvents.filter(e => e.start >= HOOK_LIMIT);

  return [...hookEvents, ...filteredRegular];
}

function buildAssContent(events: SubtitleEvent[], fontFamily: string, settings: SubtitleRenderSettings) {
  const primaryColour = hexToAssColor(settings.subtitle_font_color, "00");
  const outlineColour = hexToAssColor(settings.subtitle_outline_color, "00");
  const backColour =
    settings.subtitle_style_preset === "soft_box" ? hexToAssColor("#000000", "7A") : hexToAssColor("#000000", "FF");
  const borderStyle = settings.subtitle_style_preset === "soft_box" ? 3 : 1;
  const fontSize = settings.subtitle_style_preset === "impact" ? 42 : settings.subtitle_style_preset === "soft_box" ? 36 : 38;
  const outline = settings.subtitle_style_preset === "impact"
    ? clamp(Number(settings.subtitle_outline_width || 3) + 1, 0, 8)
    : clamp(Number(settings.subtitle_outline_width || 3), 0, 8);
  const presetMargin = SUBTITLE_PRESET_DEFAULT_MARGIN_V[settings.subtitle_style_preset] || 140;
  const presetMarginPercent = SUBTITLE_PRESET_DEFAULT_MARGIN_PERCENT[settings.subtitle_style_preset] || 11;
  const explicitPercent = Number(settings.subtitle_margin_percent);
  const derivedPercent = (Number(settings.subtitle_margin_v ?? presetMargin) / SUBTITLE_PLAY_RES_Y) * 100;
  const resolvedPercent = clamp(
    Number.isFinite(explicitPercent)
      ? explicitPercent
      : Number.isFinite(derivedPercent)
        ? derivedPercent
        : presetMarginPercent,
    0,
    100
  );
  const marginV = clamp(Math.round((resolvedPercent / 100) * SUBTITLE_PLAY_RES_Y), 0, SUBTITLE_PLAY_RES_Y - 100);
  const spacing = settings.subtitle_style_preset === "impact" ? 0.4 : 0;
  const bold = Number(settings.subtitle_font_weight) === 400 ? 0 : -1;

  return `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${SUBTITLE_PLAY_RES_X}
PlayResY: ${SUBTITLE_PLAY_RES_Y}
Collisions: Normal

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Subtitle,${fontFamily},${fontSize},${primaryColour},${primaryColour},${outlineColour},${backColour},${bold},0,0,0,100,100,${spacing},0,${borderStyle},${outline},0,2,63,63,${marginV},1
Style: Hook,${fontFamily},110,&H00FFFFFF,&H00FFFFFF,&H00111111,&H00000000,-1,0,0,0,100,100,0.5,0,1,4,0,5,120,120,140,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events
  .map(
    (event) => {
      const style = event.isHook ? "Hook" : "Subtitle";
      return `Dialogue: 0,${formatAssTime(event.start)},${formatAssTime(event.end)},${style},,0,0,0,,${escapeAssText(event.text)}`;
    }
  )
  .join("\n")}
`;
}

function buildFontFallbackUrls(
  url: string,
  fontFamilyKey: SubtitleFontFamily
) {
  const fallbacks: string[] = [];

  // Try jsDelivr mirror as primary fallback
  if (url.startsWith("https://raw.githubusercontent.com/google/fonts/main/")) {
    fallbacks.push(
      url.replace(
        "https://raw.githubusercontent.com/google/fonts/main/",
        "https://cdn.jsdelivr.net/gh/google/fonts@main/"
      )
    );
    fallbacks.push(
      url.replace(
        "https://raw.githubusercontent.com/google/fonts/main/",
        "https://github.com/google/fonts/raw/main/"
      )
    );
  }

  // Handle common "static" folder migration in Google Fonts repo
  const isBold = url.toLowerCase().includes("bold");
  const weight = isBold ? "Bold" : "Regular";
  
  if (fontFamilyKey === "montserrat") {
    fallbacks.push(
      `https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/static/Montserrat-${weight}.ttf`,
      `https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/montserrat/static/Montserrat-${weight}.ttf`,
      `https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat-${weight}.ttf`,
      `https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat-${weight}.ttf`
    );
  } else if (fontFamilyKey === "pt_sans") {
    fallbacks.push(
      `https://raw.githubusercontent.com/paratype/pt-sans/master/fonts/ttf/PTSans-${weight}.ttf`,
      `https://github.com/paratype/pt-sans/raw/master/fonts/ttf/PTSans-${weight}.ttf`,
      `https://raw.githubusercontent.com/google/fonts/main/ofl/ptsans/PT_Sans-Web-${weight}.ttf`
    );
  } else {
    // General fallback: try swapping static/ part
    if (url.includes("/static/")) {
      fallbacks.push(url.replace("/static/", "/"));
    } else {
      const parts = url.split("/");
      const fileName = parts.pop();
      fallbacks.push([...parts, "static", fileName].join("/"));
    }
  }

  return [...new Set(fallbacks)]; // Unique fallbacks
}

async function downloadFileIfMissing(urls: string[], targetPath: string) {
  if (existsSync(targetPath)) {
    return;
  }

  const candidates = urls.filter(Boolean);
  let lastError: Error | null = null;

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`Failed to download subtitle font: ${url} (status ${response.status})`);
      }

      const fileBuffer = Buffer.from(await response.arrayBuffer());
      await writeFile(targetPath, fileBuffer);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error("Failed to download subtitle font: no valid URLs");
}

async function ensureSubtitleFontAssets(fontFamilyKey: SubtitleRenderSettings["subtitle_font_family"]) {
  const fontDefinition = SUBTITLE_FONT_OPTIONS[fontFamilyKey] || SUBTITLE_FONT_OPTIONS.pt_sans;
  const fontsDir = path.join("/tmp", "platipo-miru-fonts", fontFamilyKey || "pt_sans");
  await mkdir(fontsDir, { recursive: true });

  try {
    await downloadFileIfMissing(
      [
        fontDefinition.regularUrl,
        ...buildFontFallbackUrls(fontDefinition.regularUrl, fontFamilyKey),
      ],
      path.join(fontsDir, "Regular.ttf")
    );
    await downloadFileIfMissing(
      [
        fontDefinition.boldUrl,
        ...buildFontFallbackUrls(fontDefinition.boldUrl, fontFamilyKey),
      ],
      path.join(fontsDir, "Bold.ttf")
    );
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
    subtitle_margin_v: Number(options.settings?.subtitle_margin_v ?? DEFAULT_SUBTITLE_SETTINGS.subtitle_margin_v),
    subtitle_margin_percent: Number(options.settings?.subtitle_margin_percent ?? DEFAULT_SUBTITLE_SETTINGS.subtitle_margin_percent),
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
