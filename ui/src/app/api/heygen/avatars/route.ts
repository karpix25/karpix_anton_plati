import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { PoolClient } from 'pg';

async function ensureHeygenLookMotionColumns() {
  const statements = [
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_look_id TEXT',
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_prompt TEXT',
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_type TEXT',
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_status TEXT',
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_error TEXT',
    'ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_updated_at TIMESTAMP',
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }
}

export async function GET(request: Request) {
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
      avatars.push({
        ...avatar,
        looks: lookRows.rows,
      });
    }

    return NextResponse.json(avatars);
  } catch (error) {
    console.error('HeyGen avatars GET error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const client: PoolClient = await pool.connect();

  try {
    await ensureHeygenLookMotionColumns();
    const { clientId, avatars } = await request.json();

    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    await client.query('BEGIN');
    await client.query(
      'DELETE FROM client_heygen_avatar_looks WHERE client_avatar_id IN (SELECT id FROM client_heygen_avatars WHERE client_id = $1)',
      [clientId]
    );
    await client.query('DELETE FROM client_heygen_avatars WHERE client_id = $1', [clientId]);

    for (let avatarIndex = 0; avatarIndex < (avatars || []).length; avatarIndex += 1) {
      const avatar = avatars[avatarIndex];
      const avatarResult = await client.query(
        `INSERT INTO client_heygen_avatars (
          client_id, avatar_id, avatar_name, folder_name, preview_image_url, is_active, usage_count, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [
          clientId,
          avatar.avatar_id,
          avatar.avatar_name,
          avatar.folder_name || null,
          avatar.preview_image_url || null,
          avatar.is_active ?? true,
          avatar.usage_count ?? 0,
          avatar.sort_order ?? avatarIndex,
        ]
      );

      const clientAvatarId = avatarResult.rows[0]?.id;
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
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('HeyGen avatars PUT error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  } finally {
    client.release();
  }
}
