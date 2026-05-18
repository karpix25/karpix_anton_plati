import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { PoolClient } from 'pg';
import { spawn } from 'child_process';
import path from 'path';
import { getHeygenPreviewSourceUrl, getStableHeygenPreviewUrl } from '@/lib/server/heygen-preview-cache';
import { validateApiRequest } from '@/lib/server/telegram-auth';

async function ensureHeygenLookMotionColumns() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS heygen_avatar_voice_defaults (
      avatar_id TEXT PRIMARY KEY,
      avatar_name TEXT,
      tts_provider TEXT DEFAULT 'minimax',
      tts_voice_id TEXT,
      elevenlabs_voice_id TEXT,
      gender TEXT,
      updated_from_client_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
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
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS avatar_name TEXT',
    "ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'minimax'",
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS tts_voice_id TEXT',
    "ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT",
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS gender TEXT',
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS updated_from_client_id INTEGER',
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    `INSERT INTO heygen_avatar_voice_defaults (
      avatar_id, avatar_name, tts_provider, tts_voice_id, elevenlabs_voice_id,
      gender, updated_from_client_id, created_at, updated_at
    )
    SELECT DISTINCT ON (a.avatar_id)
      a.avatar_id,
      a.avatar_name,
      CASE WHEN a.tts_provider = 'elevenlabs' THEN 'elevenlabs' ELSE 'minimax' END,
      a.tts_voice_id,
      a.elevenlabs_voice_id,
      a.gender,
      a.client_id,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM client_heygen_avatars a
    WHERE a.avatar_id IS NOT NULL AND a.avatar_id <> ''
    ORDER BY a.avatar_id, a.created_at DESC, a.id DESC
    ON CONFLICT (avatar_id) DO NOTHING`,
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

async function saveAvatarVoiceDefault(
  client: PoolClient,
  {
    avatar,
    clientId,
    provider,
  }: {
    avatar: Record<string, unknown>;
    clientId: number;
    provider: "minimax" | "elevenlabs";
  }
) {
  const avatarId = typeof avatar.avatar_id === 'string' ? avatar.avatar_id.trim() : '';
  if (!avatarId) {
    return;
  }

  await client.query(
    `INSERT INTO heygen_avatar_voice_defaults (
      avatar_id, avatar_name, tts_provider, tts_voice_id, elevenlabs_voice_id,
      gender, updated_from_client_id, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (avatar_id) DO UPDATE SET
      avatar_name = EXCLUDED.avatar_name,
      tts_provider = EXCLUDED.tts_provider,
      tts_voice_id = EXCLUDED.tts_voice_id,
      elevenlabs_voice_id = EXCLUDED.elevenlabs_voice_id,
      gender = EXCLUDED.gender,
      updated_from_client_id = EXCLUDED.updated_from_client_id,
      updated_at = CURRENT_TIMESTAMP`,
    [
      avatarId,
      typeof avatar.avatar_name === 'string' && avatar.avatar_name.trim() ? avatar.avatar_name.trim() : null,
      provider,
      typeof avatar.tts_voice_id === 'string' && avatar.tts_voice_id.trim() ? avatar.tts_voice_id.trim() : null,
      typeof avatar.elevenlabs_voice_id === 'string' && avatar.elevenlabs_voice_id.trim()
        ? avatar.elevenlabs_voice_id.trim()
        : null,
      normalizeAvatarGender(avatar.gender),
      clientId,
    ]
  );
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

function isImportedMotionLook(look: Record<string, unknown>) {
  const lookId = typeof look.look_id === 'string' ? look.look_id.trim() : '';
  const motionLookId = typeof look.motion_look_id === 'string' ? look.motion_look_id.trim() : '';

  return Boolean(lookId && motionLookId && lookId === motionLookId);
}

function readLookTimeMs(value: unknown) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function collapseOldImportedMotionLooks<T extends Record<string, unknown>>(looks: T[]) {
  const motionLooks = looks.filter(isImportedMotionLook);
  if (motionLooks.length <= 1) {
    return looks;
  }

  const latestMotionLook = [...motionLooks].sort((a, b) => {
    const sortOrderDiff = Number(b.sort_order ?? 0) - Number(a.sort_order ?? 0);
    if (sortOrderDiff !== 0) return sortOrderDiff;

    const updatedDiff = readLookTimeMs(b.motion_updated_at) - readLookTimeMs(a.motion_updated_at);
    if (updatedDiff !== 0) return updatedDiff;

    const createdDiff = readLookTimeMs(b.created_at) - readLookTimeMs(a.created_at);
    if (createdDiff !== 0) return createdDiff;

    return Number(b.id ?? 0) - Number(a.id ?? 0);
  })[0];

  return looks.filter((look) => !isImportedMotionLook(look) || look.id === latestMotionLook.id);
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
      const visibleLookRows = collapseOldImportedMotionLooks(lookRows.rows);

      const stableAvatarPreview = await getStableHeygenPreviewUrl({
        cacheKey: `avatar:${avatar.avatar_id || avatar.id}`,
        sourceUrl: avatar.preview_image_url || "",
      });

      const stableLooks = await Promise.all(
        visibleLookRows.map(async (look) => ({
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
  const startedAt = Date.now();
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
    const requestedAvatarCount = Array.isArray(avatars) ? avatars.length : 0;
    const requestedLookCount = Array.isArray(avatars)
      ? avatars.reduce((sum, avatar) => sum + (Array.isArray(avatar?.looks) ? avatar.looks.length : 0), 0)
      : 0;
    console.info(
      `[HeyGen avatars] Save request started: client_id=${resolvedClientId}, avatars=${requestedAvatarCount}, looks=${requestedLookCount}`
    );

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
      const avatarPreviewSourceUrl = await getHeygenPreviewSourceUrl(avatar.preview_image_url || null);
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
          avatarPreviewSourceUrl || null,
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
      await saveAvatarVoiceDefault(client, {
        avatar,
        clientId: resolvedClientId,
        provider,
      });

      if ((avatar.is_active ?? true) && !(Number(preservedCalibration?.tts_chars_per_minute) > 0)) {
        avatarIdsToCalibrate.push(clientAvatarId);
      }
      for (let lookIndex = 0; lookIndex < (avatar.looks || []).length; lookIndex += 1) {
        const look = avatar.looks[lookIndex];
        const lookPreviewSourceUrl = await getHeygenPreviewSourceUrl(look.preview_image_url || null);
        await client.query(
          `INSERT INTO client_heygen_avatar_looks (
            client_avatar_id, look_id, look_name, preview_image_url, motion_look_id, motion_prompt, motion_type, motion_status, motion_error, motion_updated_at, is_active, usage_count, sort_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            clientAvatarId,
            look.look_id,
            look.look_name,
            lookPreviewSourceUrl || null,
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
    console.info(
      `[HeyGen avatars] Save request completed: client_id=${resolvedClientId}, avatars=${requestedAvatarCount}, looks=${requestedLookCount}, calibration_queue=${avatarIdsToCalibrate.length}, duration_ms=${Date.now() - startedAt}`
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[HeyGen avatars] Save request failed after ${Date.now() - startedAt}ms:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  } finally {
    client.release();
  }
}
