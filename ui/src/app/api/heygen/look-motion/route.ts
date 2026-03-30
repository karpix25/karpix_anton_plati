import { NextResponse } from "next/server";
import pool from "@/lib/db";

const HEYGEN_API_BASE = "https://api.heygen.com";
const DEFAULT_MOTION_TYPE = "consistent";
const HEYGEN_MOTION_PROMPT_MAX_LENGTH = 500;
const DEFAULT_MOTION_PROMPT = `Create natural, realistic motion from this portrait while preserving identity and framing. Add subtle breathing, soft shoulder adjustments, slight torso sway, and tiny posture corrections. If hands are visible, allow restrained micro-movements only. Keep the performance calm, professional, and believable. Avoid dramatic gestures, exaggerated nodding, sudden motion, or over-animated behavior. If background elements are visible, allow only faint ambient movement.`;
const ALLOWED_MOTION_TYPES = new Set([
  "expressive",
  "consistent",
  "consistent_gen_3",
  "hailuo_2",
  "veo2",
  "seedance_lite",
  "kling",
]);

function getHeygenApiKey() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey || apiKey.includes("your_")) {
    throw new Error("HEYGEN_API_KEY is not configured");
  }
  return apiKey;
}

function normalizeMotionPrompt(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, HEYGEN_MOTION_PROMPT_MAX_LENGTH)
    : DEFAULT_MOTION_PROMPT;
}

async function ensureMotionColumns() {
  const statements = [
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

async function heygenFetch(pathname: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("X-Api-Key", getHeygenApiKey());

  const response = await fetch(`${HEYGEN_API_BASE}${pathname}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMessage =
      (payload as { error?: { message?: string }; message?: string } | null)?.error?.message ||
      (payload as { message?: string } | null)?.message ||
      `HeyGen request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload as Record<string, unknown>;
}

async function saveMotionLookState({
  lookRowId,
  motionLookId,
  motionPrompt,
  motionType,
  motionStatus,
  motionError,
}: {
  lookRowId: number;
  motionLookId: string | null;
  motionPrompt: string;
  motionType: string;
  motionStatus: string;
  motionError?: string | null;
}) {
  await pool.query(
    `UPDATE client_heygen_avatar_looks
     SET motion_look_id = $1,
         motion_prompt = $2,
         motion_type = $3,
         motion_status = $4,
         motion_error = $5,
         is_active = TRUE,
         motion_updated_at = CURRENT_TIMESTAMP
     WHERE id = $6`,
    [motionLookId, motionPrompt, motionType, motionStatus, motionError || null, lookRowId]
  );
}

async function getSavedLook(clientId: number, lookRowId: number) {
  const { rows } = await pool.query<{
    id: number;
    look_id: string;
    look_name: string;
    motion_look_id: string | null;
    motion_prompt: string | null;
    motion_type: string | null;
    motion_status: string | null;
    motion_error: string | null;
  }>(
    `SELECT l.id, l.look_id, l.look_name, l.motion_look_id, l.motion_prompt, l.motion_type, l.motion_status, l.motion_error
     FROM client_heygen_avatar_looks l
     INNER JOIN client_heygen_avatars a ON a.id = l.client_avatar_id
     WHERE l.id = $1 AND a.client_id = $2`,
    [lookRowId, clientId]
  );

  return rows[0] || null;
}

export async function GET(request: Request) {
  try {
    await ensureMotionColumns();

    const { searchParams } = new URL(request.url);
    const clientId = Number.parseInt(String(searchParams.get("clientId")), 10);
    const lookRowId = Number.parseInt(String(searchParams.get("lookRowId")), 10);

    if (!Number.isFinite(clientId) || !Number.isFinite(lookRowId)) {
      return NextResponse.json({ error: "clientId and lookRowId are required" }, { status: 400 });
    }

    const look = await getSavedLook(clientId, lookRowId);
    if (!look) {
      return NextResponse.json({ error: "Saved HeyGen look not found" }, { status: 404 });
    }

    if (!look.motion_look_id) {
      return NextResponse.json({
        ok: true,
        lookRowId,
        motionLookId: null,
        motionPrompt: look.motion_prompt || "",
        motionType: look.motion_type || DEFAULT_MOTION_TYPE,
        motionStatus: look.motion_status || "",
        motionError: look.motion_error || "",
      });
    }

    const payload = await heygenFetch(`/v2/photo_avatar/${encodeURIComponent(look.motion_look_id)}`);
    const details = (payload.data || {}) as Record<string, unknown>;
    const rawStatus = String(details.status || "").toLowerCase();
    const isMotionAvatar = details.is_motion === true;
    const workflowError = typeof details.workflow_error === "string" ? details.workflow_error : "";
    const moderationMessage = typeof details.moderation_msg === "string" ? details.moderation_msg : "";
    const motionError = workflowError || moderationMessage || "";

    const motionStatus =
      isMotionAvatar && rawStatus === "completed"
        ? "ready"
        : rawStatus === "failed"
          ? "failed"
          : rawStatus || "pending";

    await saveMotionLookState({
      lookRowId,
      motionLookId: look.motion_look_id,
      motionPrompt: normalizeMotionPrompt(look.motion_prompt),
      motionType: look.motion_type || DEFAULT_MOTION_TYPE,
      motionStatus,
      motionError: motionStatus === "failed" ? motionError || "HeyGen motion generation failed" : null,
    });

    return NextResponse.json({
      ok: true,
      lookRowId,
      motionLookId: look.motion_look_id,
      motionPrompt: normalizeMotionPrompt(look.motion_prompt),
      motionType: look.motion_type || DEFAULT_MOTION_TYPE,
      motionStatus,
      motionError: motionStatus === "failed" ? motionError || "HeyGen motion generation failed" : "",
      rawStatus,
      isMotionAvatar,
    });
  } catch (error) {
    console.error("HeyGen motion GET error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let resolvedLookRowId: number | null = null;

  try {
    await ensureMotionColumns();

    const { clientId, lookRowId, prompt, motionType } = await request.json();
    const resolvedClientId = Number.parseInt(String(clientId), 10);
    resolvedLookRowId = Number.parseInt(String(lookRowId), 10);
    const resolvedPrompt = normalizeMotionPrompt(prompt);
    const resolvedMotionType =
      typeof motionType === "string" && ALLOWED_MOTION_TYPES.has(motionType.trim())
        ? motionType.trim()
        : DEFAULT_MOTION_TYPE;

    if (!Number.isFinite(resolvedClientId) || !Number.isFinite(resolvedLookRowId)) {
      return NextResponse.json({ error: "clientId and lookRowId are required" }, { status: 400 });
    }

    const look = await getSavedLook(resolvedClientId, resolvedLookRowId);
    if (!look) {
      return NextResponse.json({ error: "Saved HeyGen look not found. Save avatar settings first." }, { status: 404 });
    }

    if (!look.look_id) {
      return NextResponse.json({ error: "Look ID is missing" }, { status: 400 });
    }

    const detailsPayload = await heygenFetch(`/v2/photo_avatar/${encodeURIComponent(look.look_id)}`);
    const details = (detailsPayload.data || {}) as Record<string, unknown>;
    const isMotionAvatar = details.is_motion === true;

    if (isMotionAvatar) {
      await saveMotionLookState({
        lookRowId: resolvedLookRowId,
        motionLookId: look.look_id,
        motionPrompt: resolvedPrompt,
        motionType: resolvedMotionType,
        motionStatus: "ready",
      });

      return NextResponse.json({
        ok: true,
        lookRowId: resolvedLookRowId,
        lookId: look.look_id,
        lookName: look.look_name,
        motionLookId: look.look_id,
        motionPrompt: resolvedPrompt,
        motionType: resolvedMotionType,
        motionStatus: "ready",
        alreadyMotionAvatar: true,
      });
    }

    const payload = await heygenFetch("/v2/photo_avatar/add_motion", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: look.look_id,
        prompt: resolvedPrompt,
        motion_type: resolvedMotionType,
      }),
    });

    const motionLookId = (payload.data as { id?: string } | undefined)?.id;
    if (!motionLookId) {
      throw new Error("HeyGen add_motion response did not include motion look ID");
    }

    await saveMotionLookState({
      lookRowId: resolvedLookRowId,
      motionLookId,
      motionPrompt: resolvedPrompt,
      motionType: resolvedMotionType,
      motionStatus: "pending",
    });

    return NextResponse.json({
      ok: true,
      lookRowId: resolvedLookRowId,
      lookId: look.look_id,
      lookName: look.look_name,
      motionLookId,
      motionPrompt: resolvedPrompt,
      motionType: resolvedMotionType,
      motionStatus: "pending",
    });
  } catch (error) {
    console.error("HeyGen add motion POST error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (resolvedLookRowId) {
      await pool.query(
        `UPDATE client_heygen_avatar_looks
         SET motion_status = 'failed',
             motion_error = $1,
             motion_updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [message, resolvedLookRowId]
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
