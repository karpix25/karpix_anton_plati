import { NextResponse } from 'next/server';
import pool from '@/lib/db';

async function ensureScenarioDurationColumn() {
  await pool.query('ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS tts_audio_duration_seconds NUMERIC(10,3)');
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS background_audio_tag TEXT DEFAULT 'neutral'");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_background_audio_name TEXT");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_background_audio_path TEXT");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS feedback_rating TEXT");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS feedback_comment TEXT");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS feedback_categories TEXT");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS learned_rules_scenario TEXT");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS learned_rules_visual TEXT");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS learned_rules_video TEXT");
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_generated_scenarios_client_created_at ON generated_scenarios (client_id, created_at DESC, id DESC)"
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const niche = searchParams.get('niche');

  try {
    await ensureScenarioDurationColumn();

    if (!clientId) {
      return NextResponse.json(
        { error: 'clientId is required.' },
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

    whereClauses.push(`COALESCE(TRIM(scenario_json->>'script'), '') <> ''`);
    whereClauses.push(`COALESCE(scenario_json->>'script', '') NOT ILIKE 'Error %'`);

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `SELECT * FROM generated_scenarios ${whereSql} ORDER BY created_at DESC, id DESC`;

    const { rows } = await pool.query(query, values);

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await ensureScenarioDurationColumn();
    const { scenarioId, backgroundAudioTag } = await request.json();
    const resolvedScenarioId = Number.parseInt(String(scenarioId), 10);
    const allowedTags = new Set(["disturbing", "inspiring", "neutral", "relax"]);

    if (!Number.isFinite(resolvedScenarioId) || resolvedScenarioId <= 0) {
      return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
    }

    if (!allowedTags.has(String(backgroundAudioTag || ""))) {
      return NextResponse.json({ error: "backgroundAudioTag is invalid" }, { status: 400 });
    }

    const { rows } = await pool.query(
      `UPDATE generated_scenarios
       SET background_audio_tag = $1
       WHERE id = $2
       RETURNING *`,
      [backgroundAudioTag, resolvedScenarioId]
    );

    if (!rows[0]) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error("Scenario update error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
