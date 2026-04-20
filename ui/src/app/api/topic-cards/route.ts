import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getTelegramSessionUserFromRequest } from '@/lib/server/telegram-auth';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        tc.*,
        COUNT(*) OVER() AS total_count
      FROM topic_cards tc
      WHERE tc.client_id = $1
      ORDER BY tc.canonical_topic_family NULLS LAST, tc.created_at DESC
      `,
      [clientId]
    );

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
      return NextResponse.json({ error: 'Only super admin can delete topic cards' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id');
    const topicCardId = Number(rawId);

    if (!Number.isFinite(topicCardId) || topicCardId <= 0) {
      return NextResponse.json({ error: 'Valid topic card id is required' }, { status: 400 });
    }

    const { rowCount, rows } = await pool.query(
      'DELETE FROM topic_cards WHERE id = $1 RETURNING id, topic_short, topic_angle',
      [topicCardId]
    );

    if (!rowCount) {
      return NextResponse.json({ error: 'Topic card not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: rows[0] });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
