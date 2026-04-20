import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import pool from "@/lib/db";
import { notifyServicePaymentIssue } from "@/lib/server/notifier";

const HEYGEN_API_BASE = "https://api.heygen.com";
const HEYGEN_UPLOAD_BASE = "https://upload.heygen.com";
const PHOTO_AVATAR_MOTION_PROMPT = `The subject is framed in a natural vertical talking-head shot with a calm, professional, and approachable presence. They maintain steady eye contact with the lens and a soft conversational expression.

The body should feel naturally alive rather than static: subtle breathing, small shoulder adjustments, gentle torso sway, light weight shifts, tiny posture corrections, and restrained hand or arm micro-movements if the hands are visible. Head movement should stay soft and organic, with small natural turns and micro-reactions, never exaggerated.

Avoid broad gestures, repetitive nodding, theatrical emphasis, sudden movements, or anything that feels robotic or over-animated. The performance should look like a real person being filmed, not a frozen photo and not a high-energy presenter.

If the original image includes visible background elements, allow slight natural environmental motion that stays secondary to the speaker, such as faint movement in hair, clothing, foliage, curtains, reflections, or light changes. Background motion should remain subtle, believable, and calm.

Overall direction: natural presenter energy, realistic body life, gentle ambient scene movement, polished but human.`;

type ScenarioRow = {
  id: number;
  client_id: number | null;
  tts_audio_path: string | null;
  heygen_video_id: string | null;
  heygen_status: string | null;
  heygen_avatar_id: string | null;
  heygen_avatar_name: string | null;
  heygen_look_id: string | null;
  heygen_look_name: string | null;
};

type AvatarRow = {
  id: number;
  avatar_id: string;
  avatar_name: string;
};

type LookRow = {
  id: number;
  look_id: string;
  look_name: string;
  motion_look_id: string | null;
  motion_status: string | null;
};

type SelectedTalkingPhoto = {
  talkingPhotoId: string;
  talkingPhotoName: string;
  usedMotionLook: boolean;
};

const AVATAR_RR_LOCK_BASE_KEY = 2026033100;

function getHeygenApiKey() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey || apiKey.includes("your_")) {
    throw new Error("HEYGEN_API_KEY is not configured");
  }
  return apiKey;
}

async function ensureHeygenColumns() {
  const statements = [
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_audio_asset_id TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_video_id TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_status TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_error TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_video_url TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_thumbnail_url TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_avatar_id TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_avatar_name TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_look_id TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_look_name TEXT",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_requested_at TIMESTAMP",
    "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_completed_at TIMESTAMP",
    "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_look_id TEXT",
    "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_prompt TEXT",
    "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_type TEXT",
    "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_status TEXT",
    "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_error TEXT",
    "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_updated_at TIMESTAMP",
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }
}

function extractErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;

  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    return String(errorRecord.message || errorRecord.code || fallback);
  }

  if (typeof record.message === "string" && record.message) {
    return record.message;
  }

  return fallback;
}

function extractFailedVideoError(payload: unknown, data: Record<string, unknown>) {
  const direct = [
    data.error,
    data.error_message,
    data.fail_reason,
    data.fail_message,
    data.failure_reason,
    data.status_detail,
    data.status_msg,
    data.workflow_error,
    data.moderation_msg,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);

  if (direct) {
    return direct;
  }

  const fallback = extractErrorMessage(payload, "HeyGen video generation failed");
  return String(fallback || "").trim().toLowerCase() === "success"
    ? "HeyGen video generation failed"
    : fallback;
}

async function heygenFetch(pathname: string, init: RequestInit = {}) {
  const apiKey = getHeygenApiKey();
  const headers = new Headers(init.headers);
  headers.set("X-Api-Key", apiKey);

  const response = await fetch(`${HEYGEN_API_BASE}${pathname}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, `HeyGen request failed with status ${response.status}`));
  }

  return payload as Record<string, unknown>;
}

async function uploadAudioAsset(filePath: string) {
  const apiKey = getHeygenApiKey();
  const audioBuffer = await readFile(filePath);
  const response = await fetch(`${HEYGEN_UPLOAD_BASE}/v1/asset`, {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audioBuffer.byteLength),
    },
    body: audioBuffer,
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, `HeyGen upload failed with status ${response.status}`));
  }

  const assetId = (payload as { data?: { id?: string } })?.data?.id;
  if (!assetId) {
    throw new Error("HeyGen upload response did not include asset ID");
  }

  return assetId;
}

async function getScenario(scenarioId: number) {
  const { rows } = await pool.query<ScenarioRow>(
    `SELECT id, client_id, tts_audio_path, heygen_video_id, heygen_status,
            heygen_avatar_id, heygen_avatar_name, heygen_look_id, heygen_look_name
     FROM generated_scenarios
     WHERE id = $1`,
    [scenarioId]
  );

  return rows[0] || null;
}

async function selectAvatarVariant(
  clientId: number | null,
  scenarioId: number,
  preferredAvatarId?: string | null,
  preferredLookId?: string | null
) {
  if (!clientId) {
    throw new Error("Scenario is not linked to a client");
  }

  if (preferredAvatarId) {
    const preferredAvatarResult = await pool.query<AvatarRow>(
      `SELECT id, avatar_id, avatar_name
       FROM client_heygen_avatars
       WHERE client_id = $1 AND avatar_id = $2 AND is_active = TRUE
       LIMIT 1`,
      [clientId, preferredAvatarId]
    );

    const preferredAvatar = preferredAvatarResult.rows[0] || null;
    if (preferredAvatar) {
      let preferredLook: LookRow | null = null;
      if (preferredLookId) {
        const preferredLookResult = await pool.query<LookRow>(
          `SELECT id, look_id, look_name, motion_look_id, motion_status
           FROM client_heygen_avatar_looks
           WHERE client_avatar_id = $1 AND look_id = $2 AND is_active = TRUE
           LIMIT 1`,
          [preferredAvatar.id, preferredLookId]
        );
        preferredLook = preferredLookResult.rows[0] || null;
      }

      if (!preferredLook) {
        const fallbackLookResult = await pool.query<LookRow>(
          `SELECT id, look_id, look_name, motion_look_id, motion_status
           FROM client_heygen_avatar_looks
           WHERE client_avatar_id = $1 AND is_active = TRUE
           ORDER BY
             COALESCE(last_used_at, TIMESTAMP '1970-01-01') ASC,
             CASE
               WHEN motion_look_id IS NOT NULL AND COALESCE(motion_status, '') IN ('ready', 'completed') THEN 0
               ELSE 1
             END ASC,
             sort_order ASC,
             created_at ASC,
             id ASC
           LIMIT 1`,
          [preferredAvatar.id]
        );
        preferredLook = fallbackLookResult.rows[0] || null;
      }

      if (preferredLook) {
        return { avatar: preferredAvatar, look: preferredLook, isReservedVariant: true };
      }
    }
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    await dbClient.query("SELECT pg_advisory_xact_lock($1)", [AVATAR_RR_LOCK_BASE_KEY + Number(clientId)]);

    const avatarResult = await dbClient.query<AvatarRow>(
      `SELECT a.id, a.avatar_id, a.avatar_name
       FROM client_heygen_avatars a
       LEFT JOIN (
         SELECT heygen_avatar_id, COUNT(*)::INT AS today_count
         FROM generated_scenarios
         WHERE client_id = $1
           AND heygen_avatar_id IS NOT NULL
           AND DATE_TRUNC('day', created_at) = DATE_TRUNC('day', CURRENT_TIMESTAMP)
         GROUP BY heygen_avatar_id
       ) daily_usage ON daily_usage.heygen_avatar_id = a.avatar_id
       WHERE a.client_id = $1 AND a.is_active = TRUE
       ORDER BY
         COALESCE(daily_usage.today_count, 0) ASC,
         COALESCE(a.last_used_at, TIMESTAMP '1970-01-01') ASC,
         a.sort_order ASC,
         a.created_at ASC,
         a.id ASC`,
      [clientId]
    );

    if (avatarResult.rows.length === 0) {
      throw new Error("No active HeyGen avatar is configured for this client");
    }

    let selectedAvatar: AvatarRow | null = null;
    let selectedLook: LookRow | null = null;

    for (const avatar of avatarResult.rows) {
      const lookResult = await dbClient.query<LookRow>(
        `SELECT id, look_id, look_name, motion_look_id, motion_status
         FROM client_heygen_avatar_looks
         WHERE client_avatar_id = $1 AND is_active = TRUE
         ORDER BY
           COALESCE(last_used_at, TIMESTAMP '1970-01-01') ASC,
           CASE
             WHEN motion_look_id IS NOT NULL AND COALESCE(motion_status, '') IN ('ready', 'completed') THEN 0
             ELSE 1
           END ASC,
           sort_order ASC,
           created_at ASC,
           id ASC
         LIMIT 1`,
        [avatar.id]
      );

      if (lookResult.rows[0]) {
        selectedAvatar = avatar;
        selectedLook = lookResult.rows[0];
        break;
      }
    }

    if (!selectedAvatar || !selectedLook) {
      throw new Error("No active HeyGen look is configured for the active avatar pool");
    }

    // Reserve selected variant on scenario to keep retries idempotent and avoid
    // concurrent jobs collapsing to a single avatar.
    await dbClient.query(
      `UPDATE generated_scenarios
       SET heygen_avatar_id = $1,
           heygen_avatar_name = $2,
           heygen_look_id = $3,
           heygen_look_name = $4
       WHERE id = $5`,
      [selectedAvatar.avatar_id, selectedAvatar.avatar_name, selectedLook.look_id, selectedLook.look_name, scenarioId]
    );

    await dbClient.query(
      `UPDATE client_heygen_avatars
       SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [selectedAvatar.id]
    );
    await dbClient.query(
      `UPDATE client_heygen_avatar_looks
       SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [selectedLook.id]
    );

    await dbClient.query("COMMIT");
    return { avatar: selectedAvatar, look: selectedLook, isReservedVariant: false, usageMarked: true };
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
}

function buildVideoPayload(avatar: AvatarRow, look: LookRow | null, audioAssetId: string) {
  const character = look
    ? {
        type: "talking_photo",
        talking_photo_id: look.look_id,
        talking_photo_style: "square",
        scale: 1,
      }
    : {
        type: "avatar",
        avatar_id: avatar.avatar_id,
        avatar_style: "normal",
        scale: 1,
      };

  return {
    caption: false,
    dimension: {
      width: 720,
      height: 1280,
    },
    aspect_ratio: "9:16",
    video_inputs: [
      {
        character,
        voice: {
          type: "audio",
          audio_asset_id: audioAssetId,
        },
        background: {
          type: "color",
          value: "#F8FAFC",
        },
        ...(look ? { expressiveness: "medium" } : {}),
        ...(look ? { motion_prompt: PHOTO_AVATAR_MOTION_PROMPT } : {}),
      },
    ],
  };
}

async function resolveTalkingPhoto(look: LookRow | null): Promise<SelectedTalkingPhoto | null> {
  if (!look) {
    return null;
  }

  if (!look.motion_look_id) {
    return {
      talkingPhotoId: look.look_id,
      talkingPhotoName: look.look_name,
      usedMotionLook: false,
    };
  }

  try {
    const payload = await heygenFetch(`/v2/photo_avatar/${encodeURIComponent(look.motion_look_id)}`);
    const details = (payload.data || {}) as Record<string, unknown>;
    const motionStatus = String(details.status || "").toLowerCase();
    const isMotionAvatar = details.is_motion === true;

    if (!isMotionAvatar || motionStatus !== "completed") {
      await pool.query(
        `UPDATE client_heygen_avatar_looks
         SET motion_status = $2,
             motion_error = NULL,
             motion_updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [look.id, motionStatus || "pending"]
      );

      return {
        talkingPhotoId: look.look_id,
        talkingPhotoName: look.look_name,
        usedMotionLook: false,
      };
    }

    await pool.query(
      `UPDATE client_heygen_avatar_looks
       SET motion_status = 'ready',
           motion_error = NULL,
           motion_updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [look.id]
    );

    return {
      talkingPhotoId: look.motion_look_id,
      talkingPhotoName: `${look.look_name} (motion)`,
      usedMotionLook: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Motion look is not ready";
    await pool.query(
      `UPDATE client_heygen_avatar_looks
       SET motion_status = 'pending',
           motion_error = $2,
           motion_updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [look.id, message]
    );

    return {
      talkingPhotoId: look.look_id,
      talkingPhotoName: look.look_name,
      usedMotionLook: false,
    };
  }
}

async function markAvatarUsage(avatarId: number, lookId?: number | null) {
  await pool.query(
    `UPDATE client_heygen_avatars
     SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [avatarId]
  );

  if (lookId) {
    await pool.query(
      `UPDATE client_heygen_avatar_looks
       SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [lookId]
    );
  }
}

async function refreshHeygenStatus(scenarioId: number, videoId: string) {
  const payload = await heygenFetch(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
  const data = (payload.data || {}) as Record<string, unknown>;
  const status = String(data.status || "").toLowerCase();
  const videoUrl = typeof data.video_url === "string" ? data.video_url : null;
  const thumbnailUrl = typeof data.thumbnail_url === "string" ? data.thumbnail_url : null;
  const errorMessage = status === "failed" ? extractFailedVideoError(payload, data) : null;

  await pool.query(
    `UPDATE generated_scenarios
     SET heygen_status = $1,
         heygen_video_url = $2,
         heygen_thumbnail_url = $3,
         heygen_error = $4,
         heygen_completed_at = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE heygen_completed_at END
     WHERE id = $5`,
    [status || null, videoUrl, thumbnailUrl, errorMessage, scenarioId]
  );

  return {
    status,
    videoUrl,
    thumbnailUrl,
    error: errorMessage,
    raw: data,
  };
}

export async function POST(request: Request) {
  try {
    await ensureHeygenColumns();

    const { scenarioId } = await request.json();
    const resolvedScenarioId = Number.parseInt(String(scenarioId), 10);

    if (!Number.isFinite(resolvedScenarioId)) {
      return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
    }

    const scenario = await getScenario(resolvedScenarioId);
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    if (!scenario.tts_audio_path || !existsSync(scenario.tts_audio_path)) {
      return NextResponse.json(
        { error: "TTS audio file is missing. Generate or regenerate the audio first." },
        { status: 400 }
      );
    }

    const { avatar, look, isReservedVariant, usageMarked } = await selectAvatarVariant(
      scenario.client_id,
      resolvedScenarioId,
      scenario.heygen_avatar_id,
      scenario.heygen_look_id
    );
    const selectedTalkingPhoto = await resolveTalkingPhoto(look);
    const audioAssetId = await uploadAudioAsset(scenario.tts_audio_path);
    const resolvedLook = look && selectedTalkingPhoto
      ? {
          ...look,
          look_id: selectedTalkingPhoto.talkingPhotoId,
          look_name: selectedTalkingPhoto.talkingPhotoName,
        }
      : look;
    const videoPayload = buildVideoPayload(avatar, resolvedLook, audioAssetId);
    const createPayload = await heygenFetch("/v2/video/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(videoPayload),
    });

    const videoId = (createPayload.data as { video_id?: string } | undefined)?.video_id;
    if (!videoId) {
      throw new Error("HeyGen create video response did not include video_id");
    }

    await pool.query(
      `UPDATE generated_scenarios
       SET heygen_audio_asset_id = $1,
           heygen_video_id = $2,
           heygen_status = 'pending',
           heygen_error = NULL,
           heygen_video_url = NULL,
           heygen_thumbnail_url = NULL,
           heygen_avatar_id = $3,
           heygen_avatar_name = $4,
           heygen_look_id = $5,
           heygen_look_name = $6,
           heygen_requested_at = CURRENT_TIMESTAMP,
           heygen_completed_at = NULL
       WHERE id = $7`,
      [
        audioAssetId,
        videoId,
        avatar.avatar_id,
        avatar.avatar_name,
        selectedTalkingPhoto?.talkingPhotoId || null,
        selectedTalkingPhoto?.talkingPhotoName || null,
        resolvedScenarioId,
      ]
    );

    if (!isReservedVariant && !usageMarked) {
      await markAvatarUsage(avatar.id, look?.id);
    }

    return NextResponse.json({
      status: "pending",
      scenarioId: resolvedScenarioId,
      videoId,
      audioAssetId,
      avatarId: avatar.avatar_id,
      avatarName: avatar.avatar_name,
      lookId: selectedTalkingPhoto?.talkingPhotoId || null,
      lookName: selectedTalkingPhoto?.talkingPhotoName || null,
      usedMotionLook: selectedTalkingPhoto?.usedMotionLook || false,
    });
  } catch (error) {
    console.error("HeyGen avatar video POST error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";

    try {
      const body = await request.clone().json();
      const scenarioId = Number.parseInt(String(body.scenarioId), 10);
      if (Number.isFinite(scenarioId)) {
        const { rows } = await pool.query("SELECT client_id FROM generated_scenarios WHERE id = $1", [scenarioId]);
        const clientId = rows[0]?.client_id;
        if (clientId) {
          await notifyServicePaymentIssue(clientId, "HeyGen (Video)", message);
        }
      }
    } catch (notifierErr) {
      console.error("Failed to trigger payment notification:", notifierErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    await ensureHeygenColumns();

    const { searchParams } = new URL(request.url);
    const scenarioId = Number.parseInt(searchParams.get("scenarioId") || "", 10);

    if (!Number.isFinite(scenarioId)) {
      return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
    }

    const scenario = await getScenario(scenarioId);
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    if (!scenario.heygen_video_id) {
      return NextResponse.json({ error: "HeyGen video was not started for this scenario" }, { status: 400 });
    }

    const result = await refreshHeygenStatus(scenarioId, scenario.heygen_video_id);

    if (result.error) {
      await notifyServicePaymentIssue(scenario.client_id, "HeyGen (Video)", result.error);
    }

    return NextResponse.json({
      scenarioId,
      videoId: scenario.heygen_video_id,
      ...result,
    });
  } catch (error) {
    console.error("HeyGen avatar video GET error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
