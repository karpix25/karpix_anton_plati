import { NextResponse } from 'next/server';
import pool from '@/lib/db';

let isDbInitialized = false;

async function ensureScenarioDurationColumn() {
  if (isDbInitialized) return;
  
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
  
  isDbInitialized = true;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const niche = searchParams.get('niche');
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const q = searchParams.get('q');

  try {
    await ensureScenarioDurationColumn();

    if (!clientId) {
      return NextResponse.json(
        { error: 'clientId is required.' },
        { status: 400 }
      );
    }

    const whereClauses: string[] = [];
    const values: any[] = [];

    values.push(clientId);
    whereClauses.push(`client_id = $${values.length}`);

    if (niche) {
      values.push(niche);
      whereClauses.push(`niche = $${values.length}`);
    }

    if (q) {
      values.push(`%${q}%`);
      whereClauses.push(`(scenario_json->>'script' ILIKE $${values.length} OR tts_script ILIKE $${values.length})`);
    }

    whereClauses.push(`COALESCE(TRIM(scenario_json->>'script'), TRIM(tts_script), '') <> ''`);
    whereClauses.push(
      `COALESCE(scenario_json->>'script', tts_script, '') NOT ILIKE 'Error %'`
    );

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    // 1. Total Count for Pagination
    const countQuery = `SELECT COUNT(*) as total FROM generated_scenarios ${whereSql}`;
    const { rows: countRows } = await pool.query(countQuery, values);
    const totalCount = parseInt(countRows[0].total, 10);

    // 2. Summary for Dashboard (Costs, Duration)
    const summaryQuery = `
      SELECT 
        SUM(CASE 
          WHEN (scenario_json->>'script') IS NOT NULL 
          THEN (scenario_json->>'script')::text 
          ELSE '' 
        END) as dummy_sum, -- Placeholder if needed
        COUNT(*) as scenarios_count
      FROM generated_scenarios ${whereSql}`;
    
    // Note: Costs calculation is complex and client-side usually. 
    // We'll return the total count and the paginated rows.
    
    // 3. Paginated Data
    const dataQuery = `
      SELECT * FROM generated_scenarios 
      ${whereSql} 
      ORDER BY created_at DESC, id DESC 
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
