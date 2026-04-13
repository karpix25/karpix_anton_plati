import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { scenarioId, transcript, words } = await request.json();

    if (!scenarioId) {
      return NextResponse.json({ error: 'scenarioId is required' }, { status: 400 });
    }

    const payload = {
      transcript: transcript || '',
      words: Array.isArray(words) ? words : [],
      updated_at: new Date().toISOString(),
      is_fallback: false,
    };

    await pool.query(
      `UPDATE generated_scenarios
       SET tts_word_timestamps = $1::jsonb
       WHERE id = $2`,
      [JSON.stringify(payload), scenarioId]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Scenario timestamp save error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
