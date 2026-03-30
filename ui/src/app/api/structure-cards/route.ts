import { NextResponse } from 'next/server';
import pool from '@/lib/db';

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
        sc.*,
        COUNT(*) OVER() AS total_count
      FROM structure_cards sc
      WHERE sc.client_id = $1
      ORDER BY sc.created_at DESC
      `,
      [clientId]
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
