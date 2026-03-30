import { NextResponse } from 'next/server';
import pool from '@/lib/db';

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
