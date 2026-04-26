import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { PoolClient } from 'pg';
import { spawn } from 'child_process';
import path from 'path';
import { getStableHeygenPreviewUrl } from '@/lib/server/heygen-preview-cache';
import { validateApiRequest } from '@/lib/server/telegram-auth';

async function ensureHeygenLookMotionColumns() {
  const statements = [
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_look_id TEXT',
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_prompt TEXT',
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_type TEXT',
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_status TEXT',
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_error TEXT',
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_updated_at TIMESTAMP',
    'ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS gender TEXT',
    "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'minimax'",
    'ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_voice_id TEXT',
    "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY'",
    'ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_chars_per_minute NUMERIC(10,2)',
    'ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_calibrated_at TIMESTAMP',
    'ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_calibration_error TEXT',
    'ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_calibration_samples_json JSONB',
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }
}

function normalizeAvatarGender(value: unknown): "male" | "female" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["male", "man", "m", "м", "муж", "мужской"].includes(normalized)) return "male";
  if (["female", "woman", "f", "ж", "жен", "женский"].includes(normalized)) return "female";
  return "female";
}

function resolveAvatarVoiceId(
  provider: "minimax" | "elevenlabs",
  ttsVoiceId: unknown,
  elevenlabsVoiceId: unknown
) {
  if (provider === "elevenlabs") {
    return typeof elevenlabsVoiceId === "string" ? elevenlabsVoiceId.trim() : "";
  }
  return typeof ttsVoiceId === "string" ? ttsVoiceId.trim() : "";
}

function buildAvatarVoiceKey(
  avatarId: unknown,
  provider: "minimax" | "elevenlabs",
  ttsVoiceId: unknown,
  elevenlabsVoiceId: unknown
) {
  const normalizedAvatarId = typeof avatarId === "string" ? avatarId.trim() : "";
  const resolvedVoiceId = resolveAvatarVoiceId(provider, ttsVoiceId, elevenlabsVoiceId);
  return `${normalizedAvatarId}::${provider}::${resolvedVoiceId}`;
}

function triggerAvatarVoiceCalibration(clientId: number, avatarIds: number[]) {
  if (!Number.isFinite(clientId) || clientId <= 0 || !avatarIds.length) {
    return;
  }

  const uniqueAvatarIds = Array.from(new Set(avatarIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (!uniqueAvatarIds.length) {
    return;
  }

  const scriptPath = path.resolve(process.cwd(), '..', 'services', 'v1', 'automation', 'calibrate_avatar_voices.py');
  const pythonProcess = spawn(
    'python3',
    [scriptPath, '--client_id', String(clientId), '--avatar_ids', uniqueAvatarIds.join(',')],
    {
      cwd: path.resolve(process.cwd(), '..'),
      env: { ...process.env, PYTHONPATH: '.' },
    }
  );

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[AvatarVoiceCalibration STDOUT] ${String(data).trim()}`);
  });
  pythonProcess.stderr.on('data', (data) => {
    console.error(`[AvatarVoiceCalibration STDERR] ${String(data).trim()}`);
  });
  pythonProcess.on('error', (error) => {
    console.error('Avatar voice calibration process failed to start:', error);
  });
}

export async function GET(request: Request) {
  const { user, errorResponse } = await validateApiRequest(request);
  if (errorResponse) return errorResponse;

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  try {
    await ensureHeygenLookMotionColumns();
    const avatarRows = await pool.query(
      `SELECT *
       FROM client_heygen_avatars
       WHERE client_id = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [clientId]
    );

    const avatars = [];
    for (const avatar of avatarRows.rows) {
      const lookRows = await pool.query(
        `SELECT *
         FROM client_heygen_avatar_looks
         WHERE client_avatar_id = $1
         ORDER BY sort_order ASC, created_at ASC`,
        [avatar.id]
      );

      const stableAvatarPreview = await getStableHeygenPreviewUrl({
        cacheKey: `avatar:${avatar.avatar_id || avatar.id}`,
        sourceUrl: avatar.preview_image_url || "",
      });

      const stableLooks = await Promise.all(
        lookRows.rows.map(async (look) => ({
          ...look,
          preview_image_url: await getStableHeygenPreviewUrl({
            cacheKey: `look:${look.look_id || look.id}`,
            sourceUrl: look.preview_image_url || "",
          }),
        }))
      );

      avatars.push({
        ...avatar,
        preview_image_url: stableAvatarPreview,
        looks: stableLooks,
      });
    }

    return NextResponse.json(avatars);
  } catch (error) {
    console.error('HeyGen avatars GET error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { user, errorResponse } = await validateApiRequest(request);
  if (errorResponse) return errorResponse;

  const client: PoolClient = await pool.connect();

  try {
    await ensureHeygenLookMotionColumns();
    const { clientId, avatars } = await request.json();

    const resolvedClientId = Number(clientId);
    if (!resolvedClientId || resolvedClientId <= 0) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    const existingCalibrationResult = await client.query(
      `SELECT avatar_id, tts_provider, tts_voice_id, elevenlabs_voice_id,
              tts_chars_per_minute, tts_calibrated_at, tts_calibration_error, tts_calibration_samples_json
       FROM client_heygen_avatars
       WHERE client_id = $1`,
      [resolvedClientId]
    );
    const preservedCalibrationByVoice = new Map(
      existingCalibrationResult.rows.map((row) => [
        buildAvatarVoiceKey(
          row.avatar_id,
          row.tts_provider === 'elevenlabs' ? 'elevenlabs' : 'minimax',
          row.tts_voice_id,
          row.elevenlabs_voice_id
        ),
        row,
      ])
    );
    const avatarIdsToCalibrate: number[] = [];

    await client.query('BEGIN');
    await client.query(
      'DELETE FROM client_heygen_avatar_looks WHERE client_avatar_id IN (SELECT id FROM client_heygen_avatars WHERE client_id = $1)',
      [resolvedClientId]
    );
    await client.query('DELETE FROM client_heygen_avatars WHERE client_id = $1', [resolvedClientId]);

    for (let avatarIndex = 0; avatarIndex < (avatars || []).length; avatarIndex += 1) {
      const avatar = avatars[avatarIndex];
      const provider: "minimax" | "elevenlabs" = avatar.tts_provider === 'elevenlabs' ? 'elevenlabs' : 'minimax';
      const calibrationKey = buildAvatarVoiceKey(
        avatar.avatar_id,
        provider,
        avatar.tts_voice_id || null,
        avatar.elevenlabs_voice_id || null
      );
      const preservedCalibration = preservedCalibrationByVoice.get(calibrationKey);
      const preservedCalibrationSamples =
        preservedCalibration?.tts_calibration_samples_json == null
          ? null
          : typeof preservedCalibration.tts_calibration_samples_json === 'string'
            ? preservedCalibration.tts_calibration_samples_json
            : JSON.stringify(preservedCalibration.tts_calibration_samples_json);
      const avatarResult = await client.query(
        `INSERT INTO client_heygen_avatars (
          client_id, avatar_id, avatar_name, folder_name, preview_image_url,
          tts_provider, tts_voice_id, elevenlabs_voice_id,
          tts_chars_per_minute, tts_calibrated_at, tts_calibration_error, tts_calibration_samples_json,
          is_active, usage_count, sort_order, gender
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16)
        RETURNING id`,
        [
          resolvedClientId,
          avatar.avatar_id,
          avatar.avatar_name,
          avatar.folder_name || null,
          avatar.preview_image_url || null,
          provider,
          avatar.tts_voice_id || null,
          avatar.elevenlabs_voice_id || null,
          preservedCalibration?.tts_chars_per_minute ?? null,
          preservedCalibration?.tts_calibrated_at ?? null,
          preservedCalibration?.tts_calibration_error ?? null,
          preservedCalibrationSamples,
          avatar.is_active ?? true,
          avatar.usage_count ?? 0,
          avatar.sort_order ?? avatarIndex,
          normalizeAvatarGender(avatar.gender),
        ]
      );

      const clientAvatarId = avatarResult.rows[0]?.id;
      if ((avatar.is_active ?? true) && !(Number(preservedCalibration?.tts_chars_per_minute) > 0)) {
        avatarIdsToCalibrate.push(clientAvatarId);
      }
      for (let lookIndex = 0; lookIndex < (avatar.looks || []).length; lookIndex += 1) {
        const look = avatar.looks[lookIndex];
        await client.query(
          `INSERT INTO client_heygen_avatar_looks (
            client_avatar_id, look_id, look_name, preview_image_url, motion_look_id, motion_prompt, motion_type, motion_status, motion_error, motion_updated_at, is_active, usage_count, sort_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            clientAvatarId,
            look.look_id,
            look.look_name,
            look.preview_image_url || null,
            look.motion_look_id || null,
            look.motion_prompt || null,
            look.motion_type || null,
            look.motion_status || null,
            look.motion_error || null,
            look.motion_updated_at || null,
            look.is_active ?? true,
            look.usage_count ?? 0,
            look.sort_order ?? lookIndex,
          ]
        );
      }
    }

    await client.query('COMMIT');
    triggerAvatarVoiceCalibration(resolvedClientId, avatarIdsToCalibrate);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('HeyGen avatars PUT error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  } finally {
    client.release();
  }
}
