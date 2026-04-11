import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getTelegramSessionUserFromRequest } from '@/lib/server/telegram-auth';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const niche = searchParams.get('niche');
  const topic = searchParams.get('topic');
  const angle = searchParams.get('angle');

  try {
    if (!clientId) {
      return NextResponse.json(
        { error: 'clientId is required. References are isolated per product.' },
        { status: 400 }
      );
    }

    const whereClauses: string[] = [];
    const values: string[] = [];

    values.push(clientId);
    whereClauses.push(`client_id = $${values.length}`);

    if (niche) {
      values.push(niche);
      whereClauses.push(`niche = $${values.length}`);
    }

    if (topic) {
      values.push(topic);
      whereClauses.push(`audit_json->'reference_strategy'->>'topic_cluster' = $${values.length}`);
    }

    if (angle) {
      values.push(angle);
      whereClauses.push(`audit_json->'reference_strategy'->>'topic_angle' = $${values.length}`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `SELECT * FROM processed_content ${whereSql} ORDER BY created_at DESC`;

    const { rows } = await pool.query(query, values);
    return NextResponse.json(rows);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getTelegramSessionUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isSuperAdmin) {
      return NextResponse.json({ error: 'Only super admin can delete references' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id');
    const referenceId = Number(rawId);

    if (!Number.isFinite(referenceId) || referenceId <= 0) {
      return NextResponse.json({ error: 'Valid reference id is required' }, { status: 400 });
    }

    const { rowCount, rows } = await pool.query(
      'DELETE FROM processed_content WHERE id = $1 RETURNING id, reels_url',
      [referenceId]
    );

    if (!rowCount) {
      return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: rows[0] });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
