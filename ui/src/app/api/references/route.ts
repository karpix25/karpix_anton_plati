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

    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const q = searchParams.get('q');
    const filter = searchParams.get('filter') || 'all';

    const whereClauses: string[] = [];
    const values: any[] = [];

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

    if (q) {
      values.push(`%${q}%`);
      whereClauses.push(`(transcript ILIKE $${values.length} OR audit_json->'atoms'->>'verbal_hook' ILIKE $${values.length})`);
    }

    if (filter === 'with') {
      whereClauses.push(`COALESCE(scenario_json->>'script', '') <> ''`);
    } else if (filter === 'without') {
      whereClauses.push(`COALESCE(scenario_json->>'script', '') = ''`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    // 1. Total Count
    const countQuery = `SELECT COUNT(*) as total FROM processed_content ${whereSql}`;
    const { rows: countRows } = await pool.query(countQuery, values);
    const totalCount = parseInt(countRows[0].total, 10);

    // 2. Paginated Data
    const dataQuery = `
      SELECT * FROM processed_content 
      ${whereSql} 
      ORDER BY created_at DESC 
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;

    const { rows } = await pool.query(dataQuery, [...values, limit, offset]);
    
    return NextResponse.json({
      data: rows,
      totalCount
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const client = await pool.connect();
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

    await client.query('BEGIN');

    const referenceResult = await client.query<{
      id: number;
      reels_url: string;
      client_id: number | null;
      topic_card_id: number | null;
      structure_card_id: number | null;
    }>(
      `
      SELECT id, reels_url, client_id, topic_card_id, structure_card_id
      FROM processed_content
      WHERE id = $1
      FOR UPDATE
      `,
      [referenceId]
    );

    if (!referenceResult.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
    }

    const reference = referenceResult.rows[0];

    await client.query('DELETE FROM processed_content WHERE id = $1', [referenceId]);

    // Delete topic card tied to this reference.
    if (reference.topic_card_id) {
      await client.query('DELETE FROM topic_cards WHERE id = $1', [reference.topic_card_id]);
    }
    await client.query(
      'DELETE FROM topic_cards WHERE source_content_id = $1',
      [referenceId]
    );

    // Delete structure card tied to this reference.
    if (reference.structure_card_id) {
      await client.query('DELETE FROM structure_cards WHERE id = $1', [reference.structure_card_id]);
    }
    await client.query(
      'DELETE FROM structure_cards WHERE source_content_id = $1',
      [referenceId]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      deleted: {
        id: reference.id,
        reels_url: reference.reels_url,
      },
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  } finally {
    client.release();
  }
}
