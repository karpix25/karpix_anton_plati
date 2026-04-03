import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
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
        words?: Array<{
          word: string;
          punctuated_word?: string;
          start: number;
          end: number;
          confidence?: number | null;
        }>;
      }
    | null;
  heygen_video_url: string | null;
  heygen_avatar_id: string | null;
  heygen_avatar_name: string | null;
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
const MIN_FIRST_AVATAR_SECONDS = 2.6;
const AVATAR_PLANS = [
  { start: 1.00, end: 1.20 }, // WIDE (Общий)
  { start: 1.35, end: 1.55 }, // MEDIUM (Средний)
  { start: 1.70, end: 1.90 }, // CLOSE (Крупный)
];
const AVATAR_ZOOM_MIN_SECONDS = 2.6;
const AVATAR_FACE_FALLBACK_Y = 0.40;

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
  const xExpr = escapeFilterExpr(
    `max(0,min(iw-ow,${options.faceCenterX}*(${zoomExprRaw})-ow/2))`
  );
  const yExpr = escapeFilterExpr(
    `max(0,min(ih-oh,${options.faceCenterY}*(${zoomExprRaw})-oh*0.40))`
  );
  return [
    "setpts=PTS-STARTPTS",
    `scale=iw*(${zoomExpr}):ih*(${zoomExpr}):eval=frame`,
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

function resolvePromptSource(
  item: ScenarioPromptItem
) {
  if (item.use_ready_asset && item.asset_url) return item.asset_url;
  if (item.video_url) return item.video_url;
  if (item.result_urls?.length) return item.result_urls[0];
  if (item.asset_url) return item.asset_url;
  return null;
}

function buildTimeline(scenario: ScenarioRow, totalDuration: number): TimelineSegment[] {
  const prompts = normalizePromptWindows(
    (scenario.video_generation_prompts?.prompts || [])
    .map((item) => ({
      start: Number(item.slot_start || 0),
      end: Number(item.slot_end || 0),
      assetType: item.asset_type || null,
      source: resolvePromptSource(item),
    }))
    .filter((item) => item.source && item.end > item.start)
    .sort((a, b) => a.start - b.start),
    totalDuration
  );

  if (scenario.heygen_video_url && prompts.length) {
    const firstPrompt = prompts[0];
    if (firstPrompt.start < MIN_FIRST_AVATAR_SECONDS) {
      const originalDuration = Math.max(0, firstPrompt.end - firstPrompt.start);
      const shiftedStart = MIN_FIRST_AVATAR_SECONDS;
      let shiftedEnd = shiftedStart + originalDuration;
      const nextStart = prompts.length > 1 ? prompts[1].start : totalDuration;
      const minDuration = firstPrompt.assetType === "product_video" ? MIN_PRODUCT_SEGMENT_SECONDS : MIN_BROLL_SEGMENT_SECONDS;
      if (shiftedEnd > nextStart) {
        shiftedEnd = nextStart;
      }
      if (shiftedEnd - shiftedStart < minDuration) {
        const extra = minDuration - (shiftedEnd - shiftedStart);
        const extendedEnd = Math.min(totalDuration, nextStart, shiftedEnd + extra);
        shiftedEnd = Math.max(shiftedEnd, extendedEnd);
      }
      if (shiftedEnd > shiftedStart) {
        firstPrompt.start = Number(shiftedStart.toFixed(3));
        firstPrompt.end = Number(shiftedEnd.toFixed(3));
      }
    }
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

  return segments.filter((segment) => segment.end - segment.start > 0.05);
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
          "-stream_loop",
          "-1",
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
  const faceCache = new Map<string, FaceBox | null>();
  let avatarPlanIndex = 0;
  const segmentPaths: string[] = [];
  const avatarSourcePath =
    sourceCache.get(scenario.heygen_video_url) ||
    (await materializeSource(scenario.heygen_video_url, workdir, "avatar_master"));
  sourceCache.set(scenario.heygen_video_url, avatarSourcePath);

  let ttsAudioPath =
    scenario.tts_audio_path && existsSync(scenario.tts_audio_path)
      ? scenario.tts_audio_path
      : null;
  if (!ttsAudioPath && avatarSourcePath) {
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
  const timelineDuration = getTotalDurationSeconds(scenario);
  const totalDuration = Math.max(audioDuration, timelineDuration);
  if (totalDuration <= 0) {
    throw new Error("Timeline data is missing");
  }

  const timeline = buildTimeline(scenario, totalDuration);
  if (!timeline.length) {
    throw new Error("No video segments available for montage");
  }

  for (let index = 0; index < timeline.length; index += 1) {
    const segment = timeline[index];
    let renderSegmentData = segment;
    let sourcePath = sourceCache.get(segment.source);

    try {
      if (!sourcePath) {
        const sourceKey = `${segment.kind}-${index}`;
        sourcePath = await materializeSource(segment.source, workdir, sourceKey);
        sourceCache.set(segment.source, sourcePath);
      }
    } catch (error) {
      if (segment.kind !== "broll") {
        throw error;
      }

      console.warn(`Montage fallback to avatar for slot ${segment.start}-${segment.end}:`, error);
      renderSegmentData = {
        kind: "avatar",
        start: segment.start,
        end: segment.end,
        source: scenario.heygen_video_url,
      };
      sourcePath = avatarSourcePath;
    }

    const outputPath = path.join(workdir, `segment_${String(index).padStart(3, "0")}.mp4`);
    let avatarFilter: string | undefined;
    if (renderSegmentData.kind === "avatar" && sourcePath) {
      const durationSeconds = Math.max(0.1, renderSegmentData.end - renderSegmentData.start);
      let dims = dimensionCache.get(sourcePath);
      if (!dims) {
        try {
          const probed = await probeVideoDimensions(sourcePath);
          if (probed) {
            dims = probed;
            dimensionCache.set(sourcePath, probed);
          }
        } catch {
          dims = undefined;
        }
      }
      const key = `${sourcePath}|${renderSegmentData.start.toFixed(2)}-${renderSegmentData.end.toFixed(2)}`;
      let faceBox = faceCache.get(key) ?? null;
      if (!faceCache.has(key)) {
        const sampleTime = renderSegmentData.start + Math.min(durationSeconds * 0.45, 1.2);
        faceBox = await detectFaceAtTime(sourcePath, sampleTime);
        faceCache.set(key, faceBox);
      }
      const faceCenterX = faceBox ? faceBox.x + faceBox.w / 2 : (dims ? dims.width / 2 : OUTPUT_WIDTH / 2);
      const faceCenterY = faceBox ? faceBox.y + faceBox.h / 2 : (dims ? dims.height * AVATAR_FACE_FALLBACK_Y : OUTPUT_HEIGHT * 0.4);
      const plan = AVATAR_PLANS[avatarPlanIndex % AVATAR_PLANS.length];
      avatarPlanIndex += 1;
      avatarFilter = buildAvatarFilter({
        duration: durationSeconds,
        faceCenterX,
        faceCenterY,
        zoomStart: plan.start,
        zoomEnd: plan.end,
      });
    }
    await renderSegment(renderSegmentData, sourcePath, outputPath, avatarFilter);
    segmentPaths.push(outputPath);
  }

  const concatListPath = path.join(workdir, "segments.txt");
  await writeFile(
    concatListPath,
    segmentPaths.map((segmentPath) => `file '${segmentPath.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8"
  );

  const outputPath = path.join(workdir, `scenario_${scenarioId}_montage.mp4`);
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
      subtitle_margin_percent: Number(scenario.subtitle_margin_percent ?? Math.round((Number(scenario.subtitle_margin_v || 140) / 1280) * 100)),
    },
    words: scenario.tts_word_timestamps?.words || [],
    totalDuration: audioDuration > 0 ? audioDuration : totalDuration,
    workdir,
  });
  const subtitleFilter = subtitleTrack
    ? `,subtitles=${subtitleTrack.subtitlePath}${subtitleTrack.fontsDir ? `:fontsdir=${subtitleTrack.fontsDir}` : ""}`
    : "";
  const backgroundAudioTag = (scenario.background_audio_tag || "neutral") as BackgroundAudioTag;
  const backgroundAudioTrack = await getRandomBackgroundAudioTrack(backgroundAudioTag);
  const backgroundAudioExt = path.extname(backgroundAudioTrack.name || "") || ".mp3";
  const backgroundAudioPath = path.join(workdir, `background_audio${backgroundAudioExt}`);
  await downloadBinaryFile(backgroundAudioTrack.downloadHref, backgroundAudioPath, "audio/mpeg");

  await runCommand("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-i",
    ttsAudioPath,
    "-stream_loop",
    "-1",
    "-i",
    backgroundAudioPath,
    "-filter_complex",
    `[0:v]tpad=stop_mode=clone:stop_duration=600${subtitleFilter}[v];[1:a]volume=1.0[voice];[2:a]volume=0.5[bg];[voice][bg]amix=inputs=2:duration=first:dropout_transition=0[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    audioDuration > 0 ? audioDuration.toFixed(3) : totalDuration.toFixed(3),
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

  return {
    outputPath,
    avatarName: scenario.heygen_avatar_name || scenario.heygen_avatar_id || `avatar-${scenarioId}`,
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
