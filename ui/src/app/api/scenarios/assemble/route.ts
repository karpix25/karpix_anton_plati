import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import pool from "@/lib/db";
import {
  getBackgroundAudioTrackByDiskPath,
  getRandomBackgroundAudioTrack,
  isYandexDiskConfigured,
  uploadFinalVideoToYandexDisk,
} from "@/lib/server/yandex-disk";
import { materializeSubtitleTrack } from "@/lib/server/subtitles";
import { BackgroundAudioTag, Settings } from "@/types";

type ScenarioRow = {
  id: number;
  tts_audio_path: string | null;
  tts_word_timestamps:
    | {
        transcript?: string;
        words?: Array<{
          word: string;
          punctuated_word?: string;
          start: number;
          end: number;
          confidence?: number | null;
        }>;
        updated_at?: string;
        is_fallback?: boolean;
      }
    | null;
  heygen_video_url: string | null;
  heygen_avatar_id: string | null;
  heygen_avatar_name: string | null;
  resolved_avatar_name: string | null;
  client_name: string | null;
  background_audio_tag: BackgroundAudioTag | null;
  subtitles_enabled: boolean | null;
  subtitle_mode: Settings["subtitle_mode"] | null;
  subtitle_style_preset: Settings["subtitle_style_preset"] | null;
  subtitle_font_family: Settings["subtitle_font_family"] | null;
  subtitle_font_color: string | null;
  subtitle_font_weight: Settings["subtitle_font_weight"] | null;
  subtitle_outline_color: string | null;
  subtitle_outline_width: number | null;
  subtitle_margin_v: number | null;
  subtitle_margin_percent: number | null;
  typography_hook_enabled: boolean | null;
  montage_video_path: string | null;
  montage_status: string | null;
  montage_error: string | null;
  montage_background_audio_name: string | null;
  montage_background_audio_path: string | null;
  montage_yandex_disk_path: string | null;
  montage_yandex_public_url: string | null;
  montage_yandex_status: string | null;
  montage_yandex_error: string | null;
  video_generation_prompts:
    | {
        prompts?: Array<{
          slot_start?: number;
          slot_end?: number;
          word_start?: number;
          word_end?: number;
          asset_type?: string | null;
          use_ready_asset?: boolean;
          asset_url?: string | null;
          asset_duration_seconds?: number | null;
          video_url?: string | null;
          result_urls?: string[] | null;
        }>;
      }
    | null;
};

type TimestampWord = {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence?: number | null;
};

type DeepgramWord = {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
};

type TimelineSegment = {
  kind: "avatar" | "broll";
  start: number;
  end: number;
  source: string;
};

type ScenarioPromptItem = NonNullable<
  NonNullable<ScenarioRow["video_generation_prompts"]>["prompts"]
>[number];

type TimelinePromptWindow = {
  start: number;
  end: number;
  assetType: string | null;
  assetDurationSeconds: number;
  source: string | null;
};

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const OUTPUT_FPS = 30;
const MIN_BROLL_SEGMENT_SECONDS = 2.0;
const MIN_PRODUCT_SEGMENT_SECONDS = 3;
const DEFAULT_PRODUCT_CLIP_SECONDS = 4;
const FRAME_EPSILON_SECONDS = 1 / OUTPUT_FPS;
const FIRST_AVATAR_INTRO_MIN_SECONDS = 2.8;
const FIRST_BROLL_LATEST_START_SECONDS = 3.5;
const MIN_AVATAR_GAP_SECONDS = 2.5;
const ASSEMBLE_SCENARIO_LOCK_KEY = 84244031;

const VIDEO_URL_HINTS = [".mp4", ".mov", ".webm", ".m4v", ".mkv", ".avi", ".ts", ".m3u8"];
const IMAGE_URL_HINTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".svg"];

function pickFirstAvatarIntroSeconds(totalDuration: number) {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return 0;
  // Use deterministic value aligned with FIRST_ATTENTION_CUT_MIN_SECONDS
  // from visual_keyword_service.py to avoid timing gaps at the first B-roll cut.
  return Math.min(totalDuration, FIRST_AVATAR_INTRO_MIN_SECONDS);
}

async function ensureMontageColumns() {
  const statements = [
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitles_enabled BOOLEAN DEFAULT FALSE",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_mode TEXT DEFAULT 'word_by_word'",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_style_preset TEXT DEFAULT 'classic'",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_font_family TEXT DEFAULT 'pt_sans'",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_font_color TEXT DEFAULT '#FFFFFF'",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_font_weight INTEGER DEFAULT 700",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_outline_color TEXT DEFAULT '#111111'",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_outline_width NUMERIC(4,1) DEFAULT 3.0",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_margin_v INTEGER DEFAULT 140",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_margin_percent INTEGER DEFAULT 11",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS typography_hook_enabled BOOLEAN DEFAULT FALSE",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_video_path TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_status TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_error TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_updated_at TIMESTAMP",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS background_audio_tag TEXT DEFAULT 'neutral'",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_background_audio_name TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_background_audio_path TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_disk_path TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_public_url TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_status TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_error TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_uploaded_at TIMESTAMP",
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `${command} failed with code ${code}`));
      }
    });

    child.on("error", reject);
  });
}

function runCommandCapture(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `Command failed: ${command}`));
      }
    });
    child.on("error", reject);
  });
}

function escapeFilterExpr(value: string) {
  return value.replace(/,/g, "\\,");
}

/**
 * Builds a simple static avatar filter without any zoom animations.
 * Ensures the avatar is scaled and cropped to the target 9:16 resolution.
 */
function buildSimpleAvatarFilter() {
  return [
    "setpts=PTS-STARTPTS",
    "setsar=1",
    // Scale and crop to exact 9:16 1080x1920
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(iw-ow)/2:(ih-oh)/2`,
    `fps=${OUTPUT_FPS}`,
    "format=yuv420p",
    "setsar=1",
  ].join(",");
}

async function getScenario(scenarioId: number) {
  const { rows } = await pool.query<ScenarioRow>(
    `SELECT
        gs.id,
        gs.tts_audio_path,
        gs.tts_word_timestamps,
        gs.heygen_video_url,
        gs.heygen_avatar_id,
        gs.heygen_avatar_name,
        a.avatar_name AS resolved_avatar_name,
        c.name as client_name,
        gs.background_audio_tag,
        gs.video_generation_prompts,
        c.subtitles_enabled,
        c.subtitle_mode,
        c.subtitle_style_preset,
        c.subtitle_font_family,
        c.subtitle_font_color,
        c.subtitle_font_weight,
        c.subtitle_outline_color,
        c.subtitle_outline_width,
        c.subtitle_margin_v,
        c.subtitle_margin_percent,
        c.typography_hook_enabled,
        gs.montage_video_path,
        gs.montage_status,
        gs.montage_error,
        gs.montage_background_audio_name,
        gs.montage_background_audio_path,
        gs.montage_yandex_disk_path,
        gs.montage_yandex_public_url,
        gs.montage_yandex_status,
        gs.montage_yandex_error
     FROM generated_scenarios gs
     LEFT JOIN clients c ON c.id = gs.client_id
     LEFT JOIN client_heygen_avatars a
       ON a.client_id = gs.client_id
      AND a.avatar_id = gs.heygen_avatar_id
     WHERE gs.id = $1`,
    [scenarioId]
  );

  return rows[0] || null;
}

function isMontageAlreadyFinal(scenario: ScenarioRow) {
  const montageStatus = String(scenario.montage_status || "").toLowerCase();
  const yandexStatus = String(scenario.montage_yandex_status || "").toLowerCase();
  return montageStatus === "completed" && (yandexStatus === "completed" || yandexStatus === "skipped");
}

async function tryLockScenarioAssemble(scenarioId: number) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [ASSEMBLE_SCENARIO_LOCK_KEY, scenarioId]
    );
    if (!rows[0]?.locked) {
      client.release();
      return null;
    }
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

function getTotalDurationSeconds(scenario: ScenarioRow) {
  const wordEnds = (scenario.tts_word_timestamps?.words || [])
    .map((word) => Number(word.end || 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  const promptEnds = (scenario.video_generation_prompts?.prompts || [])
    .map((item) => Number(item.word_end ?? item.slot_end ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  return Math.max(...wordEnds, ...promptEnds, 0);
}

async function probeDurationSeconds(filePath: string) {
  const { stdout } = await runCommandCapture("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const raw = stdout.trim();

  const duration = Number(raw);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

async function probeDurationSecondsSafe(filePath: string) {
  try {
    return await probeDurationSeconds(filePath);
  } catch (error) {
    console.warn(`[montage] ffprobe failed for ${filePath}:`, error);
    return 0;
  }
}

async function isUsableVideoFile(filePath: string) {
  if (!existsSync(filePath)) return false;

  try {
    const fileStats = await stat(filePath);
    if (fileStats.size < 2_048) {
      return false;
    }
  } catch {
    return false;
  }

  const duration = await probeDurationSecondsSafe(filePath);
  return duration > FRAME_EPSILON_SECONDS;
}

function normalizeTimestampWords(words: TimestampWord[] | DeepgramWord[] = []): TimestampWord[] {
  return words
    .filter((word) => typeof word?.word === "string" && typeof word?.start === "number" && typeof word?.end === "number")
    .map((word) => ({
      word: String(word.word || ""),
      punctuated_word: String(word.punctuated_word || word.word || ""),
      start: Number((word.start as number).toFixed(2)),
      end: Number((word.end as number).toFixed(2)),
      confidence: typeof word.confidence === "number" ? Number(word.confidence.toFixed(3)) : null,
    }))
    .filter((word) => word.end > word.start);
}

function getMaxWordEnd(words: TimestampWord[]): number {
  return words.reduce((acc, word) => Math.max(acc, Number(word.end || 0)), 0);
}

function hasReliableTimestamps(words: TimestampWord[], audioDuration: number): boolean {
  if (!words.length || !Number.isFinite(audioDuration) || audioDuration <= 0) return false;
  if (words.length < 3) return false;

  const maxWordEnd = getMaxWordEnd(words);
  const delta = Math.abs(audioDuration - maxWordEnd);
  const allowedDelta = Math.max(0.65, Math.min(2.2, audioDuration * 0.06));
  const confidenceCount = words.filter((word) => typeof word.confidence === "number").length;
  const confidenceShare = confidenceCount / words.length;

  return delta <= allowedDelta && confidenceShare >= 0.35;
}

async function transcribeAudioWithDeepgramFromFile(filePath: string): Promise<{ transcript: string; words: TimestampWord[] }> {
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
  if (!deepgramApiKey || deepgramApiKey.includes("your_")) {
    throw new Error("DEEPGRAM_API_KEY is not configured");
  }

  const audioBuffer = await readFile(filePath);
  const deepgramUrl = new URL("https://api.deepgram.com/v1/listen");
  deepgramUrl.searchParams.set("model", "nova-2");
  deepgramUrl.searchParams.set("language", "ru");
  deepgramUrl.searchParams.set("smart_format", "true");
  deepgramUrl.searchParams.set("punctuate", "true");

  const response = await fetch(deepgramUrl, {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramApiKey}`,
      "Content-Type": "audio/mpeg",
    },
    body: audioBuffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Deepgram HTTP Error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const alternative = result?.results?.channels?.[0]?.alternatives?.[0];
  return {
    transcript: alternative?.transcript || "",
    words: normalizeTimestampWords(alternative?.words || []),
  };
}

async function refreshScenarioTimestamps(
  scenarioId: number,
  audioPath: string,
  audioDuration: number
): Promise<TimestampWord[]> {
  const refreshed = await transcribeAudioWithDeepgramFromFile(audioPath);
  if (!hasReliableTimestamps(refreshed.words, audioDuration)) {
    throw new Error("Deepgram returned low-confidence or inconsistent timestamps");
  }

  await pool.query(
    `UPDATE generated_scenarios
     SET tts_word_timestamps = $1::jsonb
     WHERE id = $2`,
    [
      JSON.stringify({
        transcript: refreshed.transcript || "",
        words: refreshed.words || [],
        updated_at: new Date().toISOString(),
        is_fallback: false,
      }),
      scenarioId,
    ]
  );

  return refreshed.words;
}

async function resolveAccurateSubtitleWords(
  scenario: ScenarioRow,
  scenarioId: number,
  audioPath: string,
  audioDuration: number
): Promise<TimestampWord[]> {
  const subtitlesEnabled = scenario.subtitles_enabled ?? false;
  const storedWords = normalizeTimestampWords((scenario.tts_word_timestamps?.words || []) as TimestampWord[]);
  const storedIsFallback = Boolean(scenario.tts_word_timestamps?.is_fallback);

  if (!subtitlesEnabled) {
    return storedWords;
  }

  if (!storedIsFallback && hasReliableTimestamps(storedWords, audioDuration)) {
    return storedWords;
  }

  try {
    return await refreshScenarioTimestamps(scenarioId, audioPath, audioDuration);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Не удалось получить точные таймкоды для субтитров (scenarioId=${scenarioId}): ${details}. ` +
      `Сборка остановлена, чтобы не выпустить рассинхрон.`
    );
  }
}

function resolvePromptSource(
  item: ScenarioPromptItem
) {
  const normalizeUrl = (value: string | null | undefined) => String(value || "").trim();
  const toLowerUrl = (value: string) => value.toLowerCase();
  const looksLikeByHints = (url: string, hints: string[]) => {
    const lower = toLowerUrl(url);
    return hints.some((hint) => lower.includes(hint));
  };
  const looksLikeImage = (url: string) => looksLikeByHints(url, IMAGE_URL_HINTS);
  const looksLikeVideo = (url: string) => looksLikeByHints(url, VIDEO_URL_HINTS);

  const candidates = [
    normalizeUrl(item.video_url),
    ...(item.result_urls || []).map((url) => normalizeUrl(url)),
    normalizeUrl(item.asset_url),
  ].filter((url) => Boolean(url));

  const explicitVideo = candidates.find((url) => looksLikeVideo(url));
  if (explicitVideo) return explicitVideo;

  const nonImageCandidate = candidates.find((url) => !looksLikeImage(url));
  if (nonImageCandidate) return nonImageCandidate;

  const firstCandidate = candidates[0];
  if (firstCandidate) return firstCandidate;
  return null;
}

function getPromptMinDurationSeconds(item: TimelinePromptWindow) {
  if (item.assetType === "product_video") {
    return Math.max(
      MIN_PRODUCT_SEGMENT_SECONDS,
      Number.isFinite(item.assetDurationSeconds) && item.assetDurationSeconds > 0
        ? item.assetDurationSeconds
        : DEFAULT_PRODUCT_CLIP_SECONDS
    );
  }
  return MIN_BROLL_SEGMENT_SECONDS;
}

function toFrameTime(value: number) {
  if (!Number.isFinite(value)) return 0;
  const frames = Math.round(Math.max(0, value) * OUTPUT_FPS);
  return Number((frames / OUTPUT_FPS).toFixed(3));
}

function subtractReservedWindow(
  base: TimelinePromptWindow,
  reserved: TimelinePromptWindow
) {
  if (reserved.end <= base.start || reserved.start >= base.end) {
    return [base];
  }
  const chunks: TimelinePromptWindow[] = [];
  if (reserved.start > base.start) {
    chunks.push({ ...base, end: reserved.start });
  }
  if (reserved.end < base.end) {
    chunks.push({ ...base, start: reserved.end });
  }
  return chunks;
}

function enforceEarlyFirstBrollWindow(
  prompts: TimelinePromptWindow[],
  totalDuration: number
) {
  if (!prompts.length || totalDuration <= 0) return prompts;

  const sorted = [...prompts].sort((a, b) => a.start - b.start);
  const introSeconds = pickFirstAvatarIntroSeconds(totalDuration);
  const latestAllowedStart = Math.max(
    introSeconds,
    Math.min(FIRST_BROLL_LATEST_START_SECONDS, totalDuration - MIN_BROLL_SEGMENT_SECONDS)
  );
  if (!Number.isFinite(latestAllowedStart) || latestAllowedStart <= 0) return sorted;

  const first = sorted[0];
  if (!first || first.start <= latestAllowedStart + FRAME_EPSILON_SECONDS) {
    return sorted;
  }

  const donor = sorted.find((item) => item.assetType !== "product_video" && item.source);
  if (!donor) return sorted;

  const minDuration = Math.min(totalDuration, getPromptMinDurationSeconds(donor));
  const start = toFrameTime(introSeconds);
  const end = toFrameTime(Math.min(totalDuration, start + minDuration));
  if (end - start < MIN_BROLL_SEGMENT_SECONDS - FRAME_EPSILON_SECONDS) {
    return sorted;
  }

  const injected: TimelinePromptWindow = {
    ...donor,
    start,
    end,
  };
  console.log(
    `[montage] Enforcing early first b-roll: injected ${start.toFixed(2)}-${end.toFixed(2)}s ` +
    `(previous first: ${first.start.toFixed(2)}s)`
  );

  return [injected, ...sorted].sort((a, b) => a.start - b.start);
}

function buildTimeline(scenario: ScenarioRow, totalDuration: number): TimelineSegment[] {
  const rawPrompts = (scenario.video_generation_prompts?.prompts || [])
    .map((item) => {
      const useReadyAsset =
        item.use_ready_asset === true ||
        String(item.use_ready_asset || "").trim().toLowerCase() === "true";
      const resolvedAssetType = item.asset_type || (useReadyAsset ? "product_video" : null);
      const resolvedAssetDurationSeconds = Number(
        item.asset_duration_seconds || (useReadyAsset ? DEFAULT_PRODUCT_CLIP_SECONDS : 0)
      );
      return {
      // slot_* is post-processed final timing (guardrails/first-cut fixes),
      // so it must have priority over raw word_* timestamps.
      start: Number(item.slot_start ?? item.word_start ?? 0),
      end: Number(item.slot_end ?? item.word_end ?? 0),
      assetType: resolvedAssetType,
      assetDurationSeconds: Number.isFinite(resolvedAssetDurationSeconds) ? resolvedAssetDurationSeconds : 0,
      source: resolvePromptSource(item),
      };
    });

  const withSource = rawPrompts.filter((item) => item.source && item.end > item.start);
  console.log(
    `[montage] Prompts: ${rawPrompts.length} total → ${withSource.length} with source ` +
    `(${rawPrompts.length - withSource.length} dropped: no video_url)`
  );

  let prompts = normalizePromptWindows(
    withSource.sort((a, b) => a.start - b.start),
    totalDuration
  );

  prompts = enforceEarlyFirstBrollWindow(prompts, totalDuration);

  if (scenario.heygen_video_url && prompts.length) {
    const introSeconds = pickFirstAvatarIntroSeconds(totalDuration);
    if (introSeconds > 0) {
      const beforeIntro = prompts.length;
      prompts = prompts
        .filter((p) => p.end > introSeconds)
        .map((p) => ({
          ...p,
          start: Number(Math.max(p.start, introSeconds).toFixed(3)),
          end: Number(Math.min(totalDuration, p.end).toFixed(3)),
        }))
        .sort((a, b) => a.start - b.start);

      const adjusted: typeof prompts = [];
      for (const prompt of prompts) {
        const previousEnd = adjusted.length ? adjusted[adjusted.length - 1].end : introSeconds;
        const start = Math.max(prompt.start, previousEnd);
        const end = prompt.end;
        if (end > start) {
          adjusted.push({ ...prompt, start: Number(start.toFixed(3)) });
        }
      }
      prompts = adjusted;
      if (beforeIntro !== prompts.length) {
        console.log(
          `[montage] Avatar intro (${introSeconds.toFixed(2)}s): ${beforeIntro} → ${prompts.length} prompts ` +
          `(${beforeIntro - prompts.length} trimmed)`
        );
      }
    }
  }

  const beforeGaps = prompts.length;
  prompts = ensureMinimumAvatarGaps(prompts);
  if (beforeGaps !== prompts.length) {
    console.log(
      `[montage] Avatar gaps: ${beforeGaps} → ${prompts.length} prompts`
    );
  }

  if (prompts.length > 0) {
    const last = prompts[prompts.length - 1];
    const tailGap = totalDuration - last.end;
    if (tailGap > 0 && tailGap < MIN_AVATAR_GAP_SECONDS) {
      console.log(
        `[montage] Closing tail avatar gap: ${last.end.toFixed(2)}-${totalDuration.toFixed(2)} ` +
        `(${tailGap.toFixed(2)}s < ${MIN_AVATAR_GAP_SECONDS}s min)`
      );
      last.end = Number(totalDuration.toFixed(3));
    }
  }

  const segments: TimelineSegment[] = [];
  let cursor = 0;

  for (const prompt of prompts) {
    let start = Math.max(prompt.start, cursor);
    const preGap = start - cursor;
    if (preGap > 0 && preGap < MIN_AVATAR_GAP_SECONDS) {
      start = cursor;
    }
    const end = Math.min(prompt.end, totalDuration);
    if (end <= start) continue;

    if (start > cursor && scenario.heygen_video_url) {
      segments.push({
        kind: "avatar",
        start: cursor,
        end: start,
        source: scenario.heygen_video_url,
      });
    }

    segments.push({
      kind: "broll",
      start,
      end,
      source: prompt.source!,
    });
    cursor = end;
  }

  if (cursor < totalDuration && scenario.heygen_video_url) {
    segments.push({
      kind: "avatar",
      start: cursor,
      end: totalDuration,
      source: scenario.heygen_video_url,
    });
  }

  const finalSegments = segments.filter((segment) => segment.end - segment.start > 0.05);
  const brollCount = finalSegments.filter((s) => s.kind === "broll").length;
  const avatarCount = finalSegments.filter((s) => s.kind === "avatar").length;
  console.log(
    `[montage] Final timeline: ${finalSegments.length} segments (${brollCount} b-roll, ${avatarCount} avatar) / ${totalDuration.toFixed(1)}s`
  );

  return finalSegments;
}

function normalizePromptWindows(
  prompts: TimelinePromptWindow[],
  totalDuration: number
) {
  if (!prompts.length || totalDuration <= 0) return [];

  const prepared = prompts
    .map((prompt) => {
      const item = { ...prompt };
      const minDuration = Math.min(totalDuration, getPromptMinDurationSeconds(item));
      let start = Number.isFinite(item.start) ? item.start : 0;
      let end = Number.isFinite(item.end) ? item.end : start;

      start = Math.max(0, Math.min(start, totalDuration));
      end = Math.max(start, Math.min(end, totalDuration));

      if (item.assetType === "product_video") {
        // Hard-fit product clips to full source duration by shifting left near tail.
        const latestStart = Math.max(0, totalDuration - minDuration);
        start = Math.min(start, latestStart);
        end = Math.max(end, start + minDuration);
        if (end > totalDuration) {
          end = totalDuration;
          start = Math.max(0, end - minDuration);
        }
      } else if (end - start < minDuration) {
        end = Math.min(totalDuration, start + minDuration);
      }

      start = toFrameTime(start);
      end = toFrameTime(end);
      if (end <= start) {
        return null;
      }
      return { ...item, start, end };
    })
    .filter((item): item is TimelinePromptWindow => Boolean(item));

  const productWindows = prepared
    .filter((item) => item.assetType === "product_video")
    .sort((a, b) => a.start - b.start);
  const nonProductWindows = prepared
    .filter((item) => item.assetType !== "product_video")
    .sort((a, b) => a.start - b.start);

  // Merge overlapping/nearby product segments (same asset) into one continuous block.
  const mergedProducts: TimelinePromptWindow[] = [];
  for (const product of productWindows) {
    const prev = mergedProducts[mergedProducts.length - 1];
    const sameSource = Boolean(prev?.source && product.source && prev.source === product.source);
    const shouldMerge =
      Boolean(prev) &&
      (product.start <= (prev?.end ?? 0) || (sameSource && product.start - (prev?.end ?? 0) < MIN_AVATAR_GAP_SECONDS));

    if (!prev || !shouldMerge) {
      mergedProducts.push({ ...product });
      continue;
    }

    prev.end = Math.max(prev.end, product.end);
    prev.end = Math.min(totalDuration, toFrameTime(prev.end));
  }

  // Reserve product windows first; carve non-product windows around them.
  const carvedNonProducts: TimelinePromptWindow[] = [];
  for (const nonProduct of nonProductWindows) {
    let fragments: TimelinePromptWindow[] = [{ ...nonProduct }];
    for (const reserved of mergedProducts) {
      const nextFragments: TimelinePromptWindow[] = [];
      for (const fragment of fragments) {
        nextFragments.push(...subtractReservedWindow(fragment, reserved));
      }
      fragments = nextFragments;
      if (!fragments.length) break;
    }

    for (const fragment of fragments) {
      if (fragment.end - fragment.start >= MIN_BROLL_SEGMENT_SECONDS - FRAME_EPSILON_SECONDS) {
        carvedNonProducts.push(fragment);
      }
    }
  }

  const combined = [...mergedProducts, ...carvedNonProducts].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const aPriority = a.assetType === "product_video" ? 1 : 0;
    const bPriority = b.assetType === "product_video" ? 1 : 0;
    return bPriority - aPriority;
  });

  const resolved: TimelinePromptWindow[] = [];
  for (const original of combined) {
    const item = { ...original };
    const minDuration = Math.min(totalDuration, getPromptMinDurationSeconds(item));
    const prev = resolved[resolved.length - 1];

    if (prev && item.start < prev.end) {
      if (item.assetType === "product_video" && prev.assetType !== "product_video") {
        const prevMin = Math.min(totalDuration, getPromptMinDurationSeconds(prev));
        const candidatePrevEnd = item.start;
        if (candidatePrevEnd - prev.start >= prevMin - FRAME_EPSILON_SECONDS) {
          prev.end = toFrameTime(candidatePrevEnd);
        } else {
          resolved.pop();
        }
      } else {
        item.start = toFrameTime(prev.end);
      }
    }

    if (item.end > totalDuration) {
      item.end = toFrameTime(totalDuration);
    }
    if (item.end - item.start < minDuration - FRAME_EPSILON_SECONDS) {
      if (item.assetType !== "product_video") {
        continue;
      }
      // Keep product duration hard guarantee, even if we need to shift left.
      item.end = toFrameTime(Math.min(totalDuration, Math.max(item.end, item.start + minDuration)));
      item.start = toFrameTime(Math.max(0, item.end - minDuration));
      const prevAfterShift = resolved[resolved.length - 1];
      if (prevAfterShift && item.start < prevAfterShift.end) {
        if (prevAfterShift.assetType === "product_video") {
          continue;
        }
        const prevMin = Math.min(totalDuration, getPromptMinDurationSeconds(prevAfterShift));
        const candidatePrevEnd = item.start;
        if (candidatePrevEnd - prevAfterShift.start >= prevMin - FRAME_EPSILON_SECONDS) {
          prevAfterShift.end = toFrameTime(candidatePrevEnd);
        } else {
          resolved.pop();
        }
      }
    }

    if (item.end - item.start > FRAME_EPSILON_SECONDS) {
      resolved.push(item);
    }
  }

  for (let index = 0; index < resolved.length - 1; index += 1) {
    const current = resolved[index];
    const next = resolved[index + 1];
    const gap = next.start - current.end;
    if (gap > 0 && gap < MIN_AVATAR_GAP_SECONDS) {
      current.end = toFrameTime(next.start);
    }
  }

  return resolved
    .map((item) => ({ ...item, start: toFrameTime(item.start), end: toFrameTime(item.end) }))
    .filter((item) => item.end - item.start > FRAME_EPSILON_SECONDS);
}

function ensureMinimumAvatarGaps(
  prompts: TimelinePromptWindow[]
) {
  if (prompts.length <= 1) return prompts;

  const results = prompts.map((p) => ({ ...p }));

  for (let i = 0; i < results.length - 1; i++) {
    const current = results[i];
    const next = results[i + 1];

    const gap = next.start - current.end;

    if (gap > 0 && gap < MIN_AVATAR_GAP_SECONDS) {
      // Gap is too small for a meaningful avatar appearance (< 2s).
      // Close it by extending current b-roll to meet the next one.
      // This allows consecutive b-roll playback without a flickering
      // half-second avatar segment in between.
      console.log(
        `[montage] Closing small avatar gap: ${current.end.toFixed(2)}-${next.start.toFixed(2)} ` +
        `(${gap.toFixed(2)}s < ${MIN_AVATAR_GAP_SECONDS}s min) → extending b-roll`
      );
      current.end = next.start;
      current.end = Number(current.end.toFixed(3));
    }
    // If gap >= MIN_AVATAR_GAP_SECONDS: keep it — avatar fills it naturally.
    // If gap <= 0: segments already adjacent/overlapping — no action needed.
  }

  return results;
}

async function downloadRemoteFile(url: string, targetPath: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to download media: ${url}`);
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, fileBuffer);
}

async function downloadBinaryFile(url: string, targetPath: string, fallbackContentType = "application/octet-stream") {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to download remote file: ${url}`);
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, fileBuffer);
  return response.headers.get("content-type") || fallbackContentType;
}

async function materializeSource(source: string, workdir: string, key: string) {
  if (source.startsWith("/")) {
    const publicPath = path.join(process.cwd(), "public", source.replace(/^\/+/, ""));
    if (!existsSync(publicPath)) {
      throw new Error(`Local asset not found: ${source}`);
    }
    return publicPath;
  }

  if (source.startsWith("file://")) {
    return source.replace("file://", "");
  }

  if (existsSync(source)) {
    return source;
  }

  const targetPath = path.join(workdir, `${key}.mp4`);
  await downloadRemoteFile(source, targetPath);
  return targetPath;
}

async function renderSegment(
  segment: TimelineSegment,
  sourcePath: string,
  outputPath: string,
  avatarFilter?: string
) {
  const duration = (segment.end - segment.start).toFixed(3);
  const commonFilters = `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},fps=${OUTPUT_FPS},format=yuv420p,setsar=1`;
  const avatarFilters = avatarFilter || commonFilters;

  const args =
    segment.kind === "avatar"
      ? [
          "-y",
          "-ss",
          segment.start.toFixed(3),
          "-t",
          duration,
          "-i",
          sourcePath,
          "-an",
          "-vf",
          avatarFilters,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          outputPath,
        ]
      : [
          "-y",
          "-i",
          sourcePath,
          "-t",
          duration,
          "-an",
          "-vf",
          commonFilters,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          outputPath,
        ];

  await runCommand("ffmpeg", args);
}

async function buildMontage(scenarioId: number) {
  await ensureMontageColumns();

  const scenario = await getScenario(scenarioId);
  if (!scenario) {
    throw new Error("Scenario not found");
  }

  if (!scenario.heygen_video_url) {
    throw new Error("HeyGen avatar video is missing");
  }

  const runId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const workdir = path.join("/tmp", "platipo-miru-montage", `scenario-${scenarioId}-${runId}`);
  await mkdir(workdir, { recursive: true });

  const sourceCache = new Map<string, string>();

  const avatarSourcePath =
    sourceCache.get(scenario.heygen_video_url) ||
    (await materializeSource(scenario.heygen_video_url, workdir, "avatar_master"));
  sourceCache.set(scenario.heygen_video_url, avatarSourcePath);

  let ttsAudioPath =
    scenario.tts_audio_path && existsSync(scenario.tts_audio_path)
      ? scenario.tts_audio_path
      : null;
  if (!ttsAudioPath && avatarSourcePath) {
    console.warn(
      "[montage] WARNING: TTS audio file not found, falling back to HeyGen audio. " +
        "B-roll timing may be desynchronized because slots were computed from original TTS timestamps."
    );
    const extractedAudioPath = path.join(workdir, "avatar_audio.m4a");
    try {
      await runCommand("ffmpeg", [
        "-y",
        "-i",
        avatarSourcePath,
        "-vn",
        "-acodec",
        "aac",
        "-b:a",
        "192k",
        extractedAudioPath,
      ]);
      if (existsSync(extractedAudioPath)) {
        ttsAudioPath = extractedAudioPath;
      }
    } catch (error) {
      console.warn("Failed to extract audio from avatar video:", error);
    }
  }
  if (!ttsAudioPath) {
    throw new Error("TTS audio file is missing");
  }

  const audioDuration = await probeDurationSeconds(ttsAudioPath);
  const subtitleWords = await resolveAccurateSubtitleWords(
    scenario,
    scenarioId,
    ttsAudioPath,
    audioDuration
  );
  const timelineDuration = Math.max(getTotalDurationSeconds(scenario), getMaxWordEnd(subtitleWords));
  const totalDuration = Math.max(audioDuration, timelineDuration);
  if (totalDuration <= 0) {
    throw new Error("Timeline data is missing");
  }

  const timeline = buildTimeline(scenario, totalDuration);
  if (!timeline.length) {
    throw new Error("No video segments available for montage");
  }

  // ════════════════════════════════════════════════════════════════════
  // OVERLAY STRATEGY — Eliminates cumulative timing drift
  // ════════════════════════════════════════════════════════════════════
  // Instead of concat (where frame-boundary rounding errors accumulate,
  // causing up to 400ms drift over 10-15 segments), we render the avatar
  // as a continuous base and overlay B-roll clips at their EXACT
  // timestamps via FFmpeg overlay filters.
  const brollSegments = timeline.filter((s) => s.kind === "broll");
  console.log(
    `[montage] Overlay strategy: avatar base + ${brollSegments.length} B-roll overlays`
  );

  // 1. Render continuous avatar base video (full duration with cycling zoom)
  const avatarBasePath = path.join(workdir, "avatar_base.mp4");
  {
    const avatarBaseFilter = buildSimpleAvatarFilter();
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      avatarSourcePath,
      "-t",
      totalDuration.toFixed(3),
      "-an",
      "-vf",
      `${avatarBaseFilter},tpad=stop_mode=clone:stop_duration=30`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      avatarBasePath,
    ]);
    console.log(`[montage] Avatar base rendered: ${totalDuration.toFixed(2)}s`);
  }

  // 2. Render individual B-roll clips (no looping — clip plays once, trimmed)
  const brollClips: { localPath: string; start: number; end: number }[] = [];
  const commonBrollFilter = `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},fps=${OUTPUT_FPS},format=yuv420p,setsar=1`;
  for (let i = 0; i < brollSegments.length; i++) {
    const segment = brollSegments[i];
    try {
      let sourcePath = sourceCache.get(segment.source);
      if (!sourcePath) {
        sourcePath = await materializeSource(
          segment.source,
          workdir,
          `broll-src-${i}`
        );
        sourceCache.set(segment.source, sourcePath);
      }
      const clipPath = path.join(
        workdir,
        `broll_clip_${String(i).padStart(3, "0")}.mp4`
      );
      const clipDuration = (segment.end - segment.start).toFixed(3);
      await runCommand("ffmpeg", [
        "-y",
        "-i",
        sourcePath,
        "-t",
        (segment.end - segment.start + 0.1).toFixed(3),
        "-an",
        "-vf",
        commonBrollFilter,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-movflags",
        "+faststart",
        clipPath,
      ]);

      if (!(await isUsableVideoFile(clipPath))) {
        throw new Error(`Rendered B-roll clip is not a valid video file: ${clipPath}`);
      }

      brollClips.push({
        localPath: clipPath,
        start: segment.start,
        end: segment.end,
      });
    } catch (error) {
      // B-roll failed → avatar shows through naturally (no fallback needed)
      console.warn(
        `[montage] B-roll ${i} (${segment.start.toFixed(2)}-${segment.end.toFixed(2)}s) failed, avatar will show:`,
        error
      );
    }
  }
  console.log(
    `[montage] B-roll clips rendered: ${brollClips.length}/${brollSegments.length}`
  );

  const readyBrollClips: { localPath: string; start: number; end: number }[] = [];
  for (const clip of brollClips) {
    if (await isUsableVideoFile(clip.localPath)) {
      readyBrollClips.push(clip);
      continue;
    }
    console.warn(
      `[montage] Skipping invalid B-roll clip before final overlay: ${clip.localPath}`
    );
  }
  console.log(
    `[montage] B-roll clips validated: ${readyBrollClips.length}/${brollClips.length}`
  );

  // 3. Prepare subtitle track
  const outputPath = path.join(
    workdir,
    `scenario_${scenarioId}_montage.mp4`
  );
  const subtitleTrack = await materializeSubtitleTrack({
    settings: {
      subtitles_enabled: scenario.subtitles_enabled ?? false,
      subtitle_mode: scenario.subtitle_mode || "word_by_word",
      subtitle_style_preset: scenario.subtitle_style_preset || "classic",
      subtitle_font_family: scenario.subtitle_font_family || "pt_sans",
      subtitle_font_color: scenario.subtitle_font_color || "#FFFFFF",
      subtitle_font_weight: scenario.subtitle_font_weight || 700,
      subtitle_outline_color: scenario.subtitle_outline_color || "#111111",
      subtitle_outline_width: Number(scenario.subtitle_outline_width || 3),
      subtitle_margin_v: Number(scenario.subtitle_margin_v || 140),
      subtitle_margin_percent: Number(
        scenario.subtitle_margin_percent ??
          Math.round(
            (Number(scenario.subtitle_margin_v || 140) / OUTPUT_HEIGHT) * 100
          )
      ),
      typography_hook_enabled: !!scenario.typography_hook_enabled,
    },
    words: subtitleWords,
    totalDuration: audioDuration > 0 ? audioDuration : totalDuration,
    workdir,
  });

  // 4. Prepare background audio
  const backgroundAudioTag = (scenario.background_audio_tag ||
    "neutral") as BackgroundAudioTag;
  let backgroundAudioTrack:
    | { name: string; diskPath: string; downloadHref: string }
    | null = null;
  if (scenario.montage_background_audio_path) {
    try {
      backgroundAudioTrack = await getBackgroundAudioTrackByDiskPath(
        scenario.montage_background_audio_path
      );
      console.log(
        `[montage] Reusing background audio: ${backgroundAudioTrack.name} (${backgroundAudioTrack.diskPath})`
      );
    } catch (error) {
      console.warn(
        `[montage] Failed to reuse saved background audio path=${scenario.montage_background_audio_path}, selecting random fallback:`,
        error
      );
    }
  }
  if (!backgroundAudioTrack) {
    backgroundAudioTrack = await getRandomBackgroundAudioTrack(backgroundAudioTag);
    console.log(
      `[montage] Selected random background audio: ${backgroundAudioTrack.name} (${backgroundAudioTag})`
    );
  }
  const backgroundAudioExt =
    path.extname(backgroundAudioTrack.name || "") || ".mp3";
  const backgroundAudioPath = path.join(
    workdir,
    `background_audio${backgroundAudioExt}`
  );
  await downloadBinaryFile(
    backgroundAudioTrack.downloadHref,
    backgroundAudioPath,
    "audio/mpeg"
  );

  // 5. Build final montage with overlay strategy
  //    Inputs: [0]=avatar_base, [1..N]=broll clips, [N+1]=tts, [N+2]=background
  const ffmpegInputs: string[] = [];
  ffmpegInputs.push("-i", avatarBasePath);
  for (const clip of readyBrollClips) {
    ffmpegInputs.push("-i", clip.localPath);
  }
  ffmpegInputs.push("-i", ttsAudioPath);
  ffmpegInputs.push("-stream_loop", "-1", "-i", backgroundAudioPath);

  const ttsInputIdx = readyBrollClips.length + 1;
  const bgInputIdx = readyBrollClips.length + 2;

  // Build filter_complex: overlay B-roll at exact timestamps on avatar base
  const filterParts: string[] = [];

  // Rebase each B-roll clip to its absolute timeline position.
  // Without this offset, the overlay stream can be "consumed" before
  // enable=between(...) becomes true, causing a frozen last frame.
  for (let i = 0; i < readyBrollClips.length; i++) {
    const clip = readyBrollClips[i];
    filterParts.push(
      `[${i + 1}:v]setpts=PTS-STARTPTS+${clip.start.toFixed(3)}/TB[b${i}]`
    );
  }

  // Chain overlays on avatar base at exact timestamps.
  // eof_action=pass ensures avatar shows through when overlay clip ends.
  let currentVideoLabel = "0:v";
  for (let i = 0; i < readyBrollClips.length; i++) {
    const clip = readyBrollClips[i];
    const outLabel = `ov${i}`;
    filterParts.push(
      `[${currentVideoLabel}][b${i}]overlay=0:0:eof_action=pass:enable='between(t,${clip.start.toFixed(3)},${(clip.end + 0.02).toFixed(3)})'[${outLabel}]`
    );
    currentVideoLabel = outLabel;
  }

  // If no B-roll clips, pass avatar base through unchanged
  if (readyBrollClips.length === 0) {
    filterParts.push(`[0:v]null[ov_pass]`);
    currentVideoLabel = "ov_pass";
  }

  // Apply subtitle filter (if enabled)
  const subtitleFilterExpr = subtitleTrack
    ? `subtitles=${subtitleTrack.subtitlePath}${subtitleTrack.fontsDir ? `:fontsdir=${subtitleTrack.fontsDir}` : ""}`
    : null;

  if (subtitleFilterExpr) {
    filterParts.push(`[${currentVideoLabel}]${subtitleFilterExpr}[vfinal]`);
  } else {
    filterParts.push(`[${currentVideoLabel}]null[vfinal]`);
  }

  // Audio mixing: TTS voice + background music
  filterParts.push(`[${ttsInputIdx}:a]volume=1.0[voice]`);
  filterParts.push(`[${bgInputIdx}:a]volume=0.5[bg]`);
  filterParts.push(
    `[voice][bg]amix=inputs=2:duration=first:dropout_transition=0[a]`
  );

  const filterComplex = filterParts.join(";");
  const finalDuration =
    audioDuration > 0 ? audioDuration : totalDuration;

  console.log(
    `[montage] Building overlay montage: ${readyBrollClips.length} overlays, ` +
      `${finalDuration.toFixed(2)}s, filter_complex length: ${filterComplex.length}`
  );

  await runCommand("ffmpeg", [
    "-y",
    ...ffmpegInputs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vfinal]",
    "-map",
    "[a]",
    "-t",
    finalDuration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);

  console.log(`[montage] Final overlay montage complete: ${outputPath}`);

  return {
    outputPath,
    avatarName:
      scenario.resolved_avatar_name ||
      scenario.heygen_avatar_name ||
      scenario.heygen_avatar_id ||
      `avatar-${scenarioId}`,
    clientName: scenario.client_name,
    backgroundAudioName: backgroundAudioTrack.name,
    backgroundAudioPath: backgroundAudioTrack.diskPath,
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const resolvedScenarioId = Number.parseInt(String(body?.scenarioId), 10);
  let lockClient:
    | {
        query: (text: string, values?: unknown[]) => Promise<unknown>;
        release: () => void;
      }
    | null = null;

  try {
    if (!Number.isFinite(resolvedScenarioId)) {
      return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
    }

    await ensureMontageColumns();
    lockClient = await tryLockScenarioAssemble(resolvedScenarioId);
    if (!lockClient) {
      return NextResponse.json(
        { error: "Montage assembly is already in progress for this scenario" },
        { status: 409 }
      );
    }

    const existingScenario = await getScenario(resolvedScenarioId);
    if (!existingScenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    if (isMontageAlreadyFinal(existingScenario)) {
      return NextResponse.json({
        ok: true,
        scenarioId: resolvedScenarioId,
        reused: true,
        montage_video_path: existingScenario.montage_video_path,
        montage_background_audio_name: existingScenario.montage_background_audio_name,
        montage_background_audio_path: existingScenario.montage_background_audio_path,
        montage_yandex_disk_path: existingScenario.montage_yandex_disk_path,
        montage_yandex_public_url: existingScenario.montage_yandex_public_url,
        montage_yandex_status: existingScenario.montage_yandex_status,
        montage_yandex_error: existingScenario.montage_yandex_error,
      });
    }

    await pool.query(
      `UPDATE generated_scenarios
       SET montage_status = 'processing',
           montage_error = NULL,
           montage_yandex_status = NULL,
           montage_yandex_error = NULL,
           montage_updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [resolvedScenarioId]
    );

    const { outputPath, avatarName, clientName, backgroundAudioName, backgroundAudioPath } = await buildMontage(resolvedScenarioId);

    let yandexDiskPath: string | null = null;
    let yandexPublicUrl: string | null = null;
    let yandexStatus = isYandexDiskConfigured() ? "uploading" : "skipped";
    let yandexError: string | null = null;

    if (isYandexDiskConfigured()) {
      await pool.query(
        `UPDATE generated_scenarios
         SET montage_yandex_status = 'uploading',
             montage_yandex_error = NULL,
             montage_updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [resolvedScenarioId]
      );

      try {
        const upload = await uploadFinalVideoToYandexDisk({
          localFilePath: outputPath,
          avatarFolderName: avatarName,
          projectName: clientName || "Unknown Project",
          fileName: `scenario_${resolvedScenarioId}.mp4`,
        });
        yandexDiskPath = upload.filePath;
        yandexPublicUrl = upload.publicUrl;
        yandexStatus = "completed";
      } catch (uploadError) {
        console.error("Yandex Disk upload error:", uploadError);
        yandexStatus = "failed";
        yandexError = uploadError instanceof Error ? uploadError.message : "Yandex Disk upload failed";
      }
    }

    await pool.query(
      `UPDATE generated_scenarios
       SET montage_video_path = $1,
           montage_status = 'completed',
           montage_error = NULL,
           montage_background_audio_name = $2,
           montage_background_audio_path = $3,
           montage_yandex_disk_path = $4,
           montage_yandex_public_url = $5,
           montage_yandex_status = $6,
           montage_yandex_error = $7,
           montage_yandex_uploaded_at = CASE WHEN $6 = 'completed' THEN CURRENT_TIMESTAMP ELSE montage_yandex_uploaded_at END,
           montage_updated_at = CURRENT_TIMESTAMP
       WHERE id = $8`,
      [outputPath, backgroundAudioName, backgroundAudioPath, yandexDiskPath, yandexPublicUrl, yandexStatus, yandexError, resolvedScenarioId]
    );

    return NextResponse.json({
      ok: true,
      scenarioId: resolvedScenarioId,
      montage_video_path: outputPath,
      montage_background_audio_name: backgroundAudioName,
      montage_background_audio_path: backgroundAudioPath,
      montage_yandex_disk_path: yandexDiskPath,
      montage_yandex_public_url: yandexPublicUrl,
      montage_yandex_status: yandexStatus,
      montage_yandex_error: yandexError,
    });
  } catch (error) {
    console.error("Scenario montage POST error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (Number.isFinite(resolvedScenarioId)) {
      await ensureMontageColumns();
      await pool.query(
        `UPDATE generated_scenarios
         SET montage_status = 'failed',
             montage_error = $1,
             montage_updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [message, resolvedScenarioId]
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (lockClient) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [
          ASSEMBLE_SCENARIO_LOCK_KEY,
          resolvedScenarioId,
        ]);
      } catch (unlockError) {
        console.error("Failed to release scenario assemble lock:", unlockError);
      } finally {
        lockClient.release();
      }
    }
  }
}
