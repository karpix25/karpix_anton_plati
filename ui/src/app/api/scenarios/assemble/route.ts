import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import pool from "@/lib/db";
import {
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
  video_generation_prompts:
    | {
        prompts?: Array<{
          slot_start?: number;
          slot_end?: number;
          asset_type?: string | null;
          use_ready_asset?: boolean;
          asset_url?: string | null;
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

const OUTPUT_WIDTH = 720;
const OUTPUT_HEIGHT = 1280;
const OUTPUT_FPS = 30;
const MIN_BROLL_SEGMENT_SECONDS = 2;
const MIN_PRODUCT_SEGMENT_SECONDS = 3;
const FIRST_AVATAR_INTRO_MIN_SECONDS = 2.5;
const FIRST_AVATAR_INTRO_MAX_SECONDS = 3.0;
const AVATAR_PLANS = [
  { start: 1.00, end: 1.20 }, // WIDE (Общий)
  { start: 1.35, end: 1.55 }, // MEDIUM (Средний)
  { start: 1.70, end: 1.90 }, // CLOSE (Крупный)
];
const AVATAR_ZOOM_MIN_SECONDS = 2.6;
const MIN_AVATAR_GAP_SECONDS = 2.0;
const AVATAR_FACE_FALLBACK_Y = 0.40;
const AVATAR_ANIMATE_ZOOM = String(process.env.MONTAGE_AVATAR_ANIMATE_ZOOM || "").trim() === "1";

const VIDEO_URL_HINTS = [".mp4", ".mov", ".webm", ".m4v", ".mkv", ".avi", ".ts", ".m3u8"];
const IMAGE_URL_HINTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".svg"];

function pickFirstAvatarIntroSeconds(totalDuration: number) {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return 0;
  // Use deterministic value aligned with FIRST_ATTENTION_CUT_MIN_SECONDS
  // from visual_keyword_service.py to avoid timing gaps at the first B-roll cut.
  return Math.min(totalDuration, FIRST_AVATAR_INTRO_MIN_SECONDS);
}

type FaceBox = { x: number; y: number; w: number; h: number };

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
  });
}

function escapeFilterExpr(value: string) {
  return value.replace(/,/g, "\\,");
}

async function probeVideoDimensions(filePath: string) {
  const { stdout } = await runCommandCapture("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    filePath,
  ]);
  const raw = stdout.trim();
  const parts = raw.split(",");
  if (parts.length < 2) return null;
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function parseFaceMetadata(raw: string): FaceBox | null {
  const xMatch = raw.match(/lavfi\.facedetect\.x=([0-9.]+)/);
  const yMatch = raw.match(/lavfi\.facedetect\.y=([0-9.]+)/);
  const wMatch = raw.match(/lavfi\.facedetect\.w=([0-9.]+)/);
  const hMatch = raw.match(/lavfi\.facedetect\.h=([0-9.]+)/);
  if (!xMatch || !yMatch || !wMatch || !hMatch) return null;
  const x = Number(xMatch[1]);
  const y = Number(yMatch[1]);
  const w = Number(wMatch[1]);
  const h = Number(hMatch[1]);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

async function detectFaceAtTime(filePath: string, timeSeconds: number): Promise<FaceBox | null> {
  try {
    const { stdout, stderr } = await runCommandCapture("ffmpeg", [
      "-y",
      "-ss",
      timeSeconds.toFixed(3),
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-vf",
      "facedetect=mode=fast,metadata=print:file=-",
      "-f",
      "null",
      "-",
    ]);
    return parseFaceMetadata(`${stdout}\n${stderr}`);
  } catch {
    return null;
  }
}

function chooseStableFaceSampleTime(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const half = duration / 2;
  const maxStart = Math.max(duration - 0.05, 0);
  const candidate = Math.min(1, half, maxStart);
  return candidate > 0 ? candidate : 0;
}

async function detectStableFaceCenter(filePath: string): Promise<FaceBox | null> {
  const duration = await probeDurationSeconds(filePath);
  const sampleTime = chooseStableFaceSampleTime(duration);
  return detectFaceAtTime(filePath, sampleTime);
}

function buildAvatarFilter(options: {
  duration: number;
  faceCenterX: number;
  faceCenterY: number;
  zoomStart: number;
  zoomEnd: number;
}) {
  const duration = Math.max(0.1, options.duration);
  const zoomStart = options.zoomStart;
  const zoomEnd = options.zoomEnd;
  const zoomExprRaw =
    duration >= AVATAR_ZOOM_MIN_SECONDS
      ? `${zoomStart}+(${zoomEnd}-${zoomStart})*min(t,${duration})/${duration}`
      : `${zoomStart}`;
  
  const zoomExpr = escapeFilterExpr(zoomExprRaw);
  
  // Use face position as the anchor point for transformation
  // Formula: target_x = face_x * zoom - screen_center_x
  // We keep the face at the same relative horizontal position or slightly center it
  const xExpr = escapeFilterExpr(
    `max(0,min(iw-ow,${options.faceCenterX}*(${zoomExprRaw})-ow/2))`
  );
  
  // For vertical position, we target slightly above the face center (eyes/forehead area)
  // but keep it within bounds to prevent showing black bars
  const yExpr = escapeFilterExpr(
    `max(0,min(ih-oh,${options.faceCenterY}*(${zoomExprRaw})-oh*0.42))`
  );
  
  return [
    "setpts=PTS-STARTPTS",
    `scale=iw*(${zoomExpr}):-1:eval=frame`, // Use -1 for height to maintain aspect ratio
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:x=${xExpr}:y=${yExpr}`,
    `fps=${OUTPUT_FPS}`,
    "format=yuv420p",
    "setsar=1",
  ].join(",");
}

/**
 * Builds a single continuous avatar filter with time-varying zoom that
 * cycles through AVATAR_PLANS at each B-roll boundary. Since the B-roll
 * overlay hides the avatar during transitions, the zoom change is
 * invisible to the viewer.
 */
function buildCyclingAvatarFilter(options: {
  totalDuration: number;
  faceCenterX: number;
  faceCenterY: number;
  brollEndTimes: number[];
}) {
  const zoomChangePoints: { threshold: number; zoom: number }[] = [
    {
      threshold: 0,
      zoom: AVATAR_ANIMATE_ZOOM ? AVATAR_PLANS[0].start : AVATAR_PLANS[0].end,
    },
  ];
  for (let i = 0; i < options.brollEndTimes.length; i++) {
    const planIdx = (i + 1) % AVATAR_PLANS.length;
    const plan = AVATAR_PLANS[planIdx];
    zoomChangePoints.push({
      threshold: options.brollEndTimes[i],
      zoom: AVATAR_ANIMATE_ZOOM ? plan.start : plan.end,
    });
  }

  // Build nested if() expression: if(lt(t,T1),Z0,if(lt(t,T2),Z1,...,Zn))
  let zoomExprRaw: string;
  if (zoomChangePoints.length <= 1) {
    zoomExprRaw = String(zoomChangePoints[0]?.zoom || 1.35);
  } else {
    zoomExprRaw = String(
      zoomChangePoints[zoomChangePoints.length - 1].zoom
    );
    for (let i = zoomChangePoints.length - 2; i >= 0; i--) {
      const nextT = zoomChangePoints[i + 1].threshold;
      zoomExprRaw = `if(lt(t,${nextT.toFixed(3)}),${zoomChangePoints[i].zoom},${zoomExprRaw})`;
    }
  }

  const zoomExpr = escapeFilterExpr(zoomExprRaw);
  
  // CRITICAL FIX: The anchor point for zoom must be derived from the ORIGINAL person position.
  // We use faceCenterX to keep the person as the center of the viewport regardless of the scale.
  const xExpr = escapeFilterExpr(
    `max(0,min(iw-ow,${options.faceCenterX}*(${zoomExprRaw})-ow/2))`
  );
  const yExpr = escapeFilterExpr(
    `max(0,min(ih-oh,${options.faceCenterY}*(${zoomExprRaw})-oh*0.42))`
  );

  return [
    "setpts=PTS-STARTPTS",
    `scale=iw*(${zoomExpr}):-1:eval=frame`, // Use -1 to keep aspect ratio perfect
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:x=${xExpr}:y=${yExpr}`,
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
        c.subtitle_margin_percent
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

function getTotalDurationSeconds(scenario: ScenarioRow) {
  const wordEnds = (scenario.tts_word_timestamps?.words || [])
    .map((word) => Number(word.end || 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  const promptEnds = (scenario.video_generation_prompts?.prompts || [])
    .map((item) => Number(item.slot_end || 0))
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

function buildTimeline(scenario: ScenarioRow, totalDuration: number): TimelineSegment[] {
  const rawPrompts = (scenario.video_generation_prompts?.prompts || [])
    .map((item) => ({
      start: Number(item.slot_start || 0),
      end: Number(item.slot_end || 0),
      assetType: item.asset_type || null,
      source: resolvePromptSource(item),
    }));

  const withSource = rawPrompts.filter((item) => item.source && item.end > item.start);
  console.log(
    `[montage] Prompts: ${rawPrompts.length} total → ${withSource.length} with source ` +
    `(${rawPrompts.length - withSource.length} dropped: no video_url)`
  );

  let prompts = normalizePromptWindows(
    withSource.sort((a, b) => a.start - b.start),
    totalDuration
  );

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

  const segments: TimelineSegment[] = [];
  let cursor = 0;

  for (const prompt of prompts) {
    const start = Math.max(prompt.start, cursor);
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
  prompts: Array<{ start: number; end: number; assetType: string | null; source: string | null }>,
  totalDuration: number
) {
  const normalized = prompts.map((item) => ({ ...item }));

  for (let index = 0; index < normalized.length; index += 1) {
    const item = normalized[index];
    const minimumDuration = item.assetType === "product_video" ? MIN_PRODUCT_SEGMENT_SECONDS : MIN_BROLL_SEGMENT_SECONDS;
    let start = item.start;
    let end = item.end;
    let needed = minimumDuration - (end - start);

    if (needed <= 0) {
      continue;
    }

    const previousEnd = index > 0 ? normalized[index - 1].end : 0;
    const nextStart = index + 1 < normalized.length ? normalized[index + 1].start : totalDuration;

    const extendRight = Math.min(needed, Math.max(0, nextStart - end));
    end += extendRight;
    needed -= extendRight;

    if (needed > 0) {
      const shiftLeft = Math.min(needed, Math.max(0, start - previousEnd));
      start -= shiftLeft;
      needed -= shiftLeft;
    }

    item.start = Math.max(0, Number(start.toFixed(3)));
    item.end = Math.min(totalDuration, Number(end.toFixed(3)));
  }

  return normalized;
}

function ensureMinimumAvatarGaps(
  prompts: Array<{ start: number; end: number; assetType: string | null; source: string | null }>
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

  const workdir = path.join("/tmp", "platipo-miru-montage", `scenario-${scenarioId}`);
  await mkdir(workdir, { recursive: true });

  const sourceCache = new Map<string, string>();
  const dimensionCache = new Map<string, { width: number; height: number }>();

  const avatarSourcePath =
    sourceCache.get(scenario.heygen_video_url) ||
    (await materializeSource(scenario.heygen_video_url, workdir, "avatar_master"));
  sourceCache.set(scenario.heygen_video_url, avatarSourcePath);
  const stableAvatarFaceBox = await detectStableFaceCenter(avatarSourcePath);

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
    let dims = dimensionCache.get(avatarSourcePath);
    if (!dims) {
      try {
        const probed = await probeVideoDimensions(avatarSourcePath);
        if (probed) {
          dims = probed;
          dimensionCache.set(avatarSourcePath, probed);
        }
      } catch {
        // ignore
      }
    }
    const faceCenterX = stableAvatarFaceBox
      ? stableAvatarFaceBox.x + stableAvatarFaceBox.w / 2
      : dims
        ? dims.width / 2
        : OUTPUT_WIDTH / 2;
    const faceCenterY = stableAvatarFaceBox
      ? stableAvatarFaceBox.y + stableAvatarFaceBox.h / 2
      : dims
        ? dims.height * AVATAR_FACE_FALLBACK_Y
        : OUTPUT_HEIGHT * 0.42;
    const avatarBaseFilter = buildCyclingAvatarFilter({
      totalDuration,
      faceCenterX,
      faceCenterY,
      brollEndTimes: brollSegments.map((s) => s.end),
    });
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
        clipDuration,
        "-an",
        "-vf",
        commonBrollFilter,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        clipPath,
      ]);
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
            (Number(scenario.subtitle_margin_v || 140) / 1280) * 100
          )
      ),
    },
    words: subtitleWords,
    totalDuration: audioDuration > 0 ? audioDuration : totalDuration,
    workdir,
  });

  // 4. Prepare background audio
  const backgroundAudioTag = (scenario.background_audio_tag ||
    "neutral") as BackgroundAudioTag;
  const backgroundAudioTrack =
    await getRandomBackgroundAudioTrack(backgroundAudioTag);
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
  for (const clip of brollClips) {
    ffmpegInputs.push("-i", clip.localPath);
  }
  ffmpegInputs.push("-i", ttsAudioPath);
  ffmpegInputs.push("-stream_loop", "-1", "-i", backgroundAudioPath);

  const ttsInputIdx = brollClips.length + 1;
  const bgInputIdx = brollClips.length + 2;

  // Build filter_complex: overlay B-roll at exact timestamps on avatar base
  const filterParts: string[] = [];

  // Rebase each B-roll clip to its absolute timeline position.
  // Without this offset, the overlay stream can be "consumed" before
  // enable=between(...) becomes true, causing a frozen last frame.
  for (let i = 0; i < brollClips.length; i++) {
    const clip = brollClips[i];
    filterParts.push(
      `[${i + 1}:v]setpts=PTS-STARTPTS+${clip.start.toFixed(3)}/TB[b${i}]`
    );
  }

  // Chain overlays on avatar base at exact timestamps.
  // eof_action=pass ensures avatar shows through when overlay clip ends.
  let currentVideoLabel = "0:v";
  for (let i = 0; i < brollClips.length; i++) {
    const clip = brollClips[i];
    const outLabel = `ov${i}`;
    filterParts.push(
      `[${currentVideoLabel}][b${i}]overlay=0:0:eof_action=pass:enable='between(t,${clip.start.toFixed(3)},${clip.end.toFixed(3)})'[${outLabel}]`
    );
    currentVideoLabel = outLabel;
  }

  // If no B-roll clips, pass avatar base through unchanged
  if (brollClips.length === 0) {
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
    `[montage] Building overlay montage: ${brollClips.length} overlays, ` +
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

  try {
    if (!Number.isFinite(resolvedScenarioId)) {
      return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
    }

    await ensureMontageColumns();
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
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const upload = await uploadFinalVideoToYandexDisk({
          localFilePath: outputPath,
          avatarFolderName: avatarName,
          projectName: clientName || "Unknown Project",
          fileName: `scenario_${resolvedScenarioId}_${timestamp}.mp4`,
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
  }
}
