import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

let isDbInitialized = false;

async function ensureDashboardColumns() {
  if (isDbInitialized) return;

  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_status TEXT");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_updated_at TIMESTAMP");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_uploaded_at TIMESTAMP");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS video_generation_prompts JSONB");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS tts_audio_duration_seconds NUMERIC(10,3)");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_requested_at TIMESTAMP");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_video_id TEXT");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_video_url TEXT");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_status TEXT");

  isDbInitialized = true;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientIdRaw = searchParams.get("clientId");
  const monthRaw = String(searchParams.get("month") || "").trim();

  const clientId = Number(clientIdRaw);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: "Valid clientId is required" }, { status: 400 });
  }
  if (monthRaw && !MONTH_RE.test(monthRaw)) {
    return NextResponse.json({ error: "month must be in YYYY-MM format" }, { status: 400 });
  }

  try {
    await ensureDashboardColumns();

    const query = `
      WITH bounds AS (
        SELECT
          date_trunc(
            'month',
            COALESCE(to_date(NULLIF($2, ''), 'YYYY-MM'), CURRENT_DATE)::timestamp
          ) AS month_start
      ),
      range_msk AS (
        SELECT
          month_start,
          month_start + interval '1 month' AS month_end
        FROM bounds
      ),
      refs AS (
        SELECT COUNT(*)::int AS reference_count
        FROM processed_content pc, range_msk r
        WHERE pc.client_id = $1
          AND ((pc.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow') >= r.month_start
          AND ((pc.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow') < r.month_end
      ),
      topics AS (
        SELECT COUNT(*)::int AS topic_count
        FROM topic_cards tc, range_msk r
        WHERE tc.client_id = $1
          AND ((tc.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow') >= r.month_start
          AND ((tc.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow') < r.month_end
      ),
      scenarios AS (
        SELECT COUNT(*)::int AS scenario_count
        FROM generated_scenarios gs, range_msk r
        WHERE gs.client_id = $1
          AND COALESCE(TRIM(gs.scenario_json->>'script'), TRIM(gs.tts_script), '') <> ''
          AND COALESCE(gs.scenario_json->>'script', gs.tts_script, '') NOT ILIKE 'Error %'
          AND ((gs.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow') >= r.month_start
          AND ((gs.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow') < r.month_end
      ),
      finals AS (
        SELECT COUNT(*)::int AS final_video_count
        FROM generated_scenarios gs, range_msk r
        WHERE gs.client_id = $1
          AND gs.montage_status = 'completed'
          AND ((COALESCE(gs.montage_yandex_uploaded_at, gs.montage_updated_at, gs.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow') >= r.month_start
          AND ((COALESCE(gs.montage_yandex_uploaded_at, gs.montage_updated_at, gs.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow') < r.month_end
      ),
      scenario_data AS (
        SELECT
          (
            SELECT count(*)
            FROM jsonb_array_elements(
              COALESCE(
                gs.video_generation_prompts->'prompts',
                gs.scenario_json->'video_generation_prompts'->'prompts',
                '[]'::jsonb
              )
            ) as p
            WHERE (p->>'use_ready_asset')::boolean IS NOT TRUE
              AND (
                p->>'video_url' IS NOT NULL
                OR jsonb_array_length(COALESCE(p->'result_urls', '[]'::jsonb)) > 0
                OR p->>'task_id' IS NOT NULL
                OR LOWER(p->>'task_state') IN ('success', 'fail')
                OR LOWER(p->>'submission_status') IN ('submitted', 'success', 'completed', 'failed')
              )
          ) AS prompt_count,
          (
            CASE
              WHEN gs.heygen_requested_at IS NOT NULL
                OR gs.heygen_video_id IS NOT NULL
                OR gs.heygen_video_url IS NOT NULL
                OR LOWER(gs.heygen_status) IN ('pending', 'waiting', 'processing', 'queued', 'in_progress', 'completed', 'success', 'failed')
              THEN COALESCE(gs.tts_audio_duration_seconds, 0)
              ELSE 0
            END
          ) AS heygen_duration,
          COALESCE(
            gs.video_generation_prompts->>'generator_model',
            gs.scenario_json->'video_generation_prompts'->>'generator_model',
            'veo3_lite'
          ) AS model
        FROM generated_scenarios gs, range_msk r
        WHERE gs.client_id = $1
          AND COALESCE(TRIM(gs.scenario_json->>'script'), TRIM(gs.tts_script), '') <> ''
          AND COALESCE(gs.scenario_json->>'script', gs.tts_script, '') NOT ILIKE 'Error %'
          AND ((gs.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow') >= r.month_start
          AND ((gs.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow') < r.month_end
      ),
      costs AS (
        SELECT
          COALESCE(SUM(prompt_count), 0)::int AS total_prompts,
          COALESCE(SUM(heygen_duration), 0)::float8 AS total_heygen_duration,
          COALESCE(
            SUM(
              prompt_count * (
                CASE
                  WHEN model = 'bytedance/seedance-1.5-pro' THEN 0.07
                  WHEN model = 'grok-imagine/text-to-video' THEN 0.1
                  WHEN model = 'veo3' THEN 0.15
                  WHEN model = 'veo3_fast' THEN 0.08
                  WHEN model = 'veo3_lite' THEN 0.15
                  ELSE 0.03
                END
              ) + (heygen_duration / 60.0) * 1.0
            ),
            0
          )::float8 AS total_cost_usd
        FROM scenario_data
      )
      SELECT
        to_char(r.month_start, 'YYYY-MM') AS month,
        refs.reference_count,
        scenarios.scenario_count,
        topics.topic_count,
        finals.final_video_count,
        costs.total_prompts,
        costs.total_heygen_duration,
        costs.total_cost_usd
      FROM range_msk r
      CROSS JOIN refs
      CROSS JOIN scenarios
      CROSS JOIN topics
      CROSS JOIN finals
      CROSS JOIN costs
    `;

    const { rows } = await pool.query(query, [clientId, monthRaw || null]);
    const row = rows[0] || {};

    return NextResponse.json({
      month: String(row.month || monthRaw || ""),
      referenceCount: Number(row.reference_count || 0),
      scenarioCount: Number(row.scenario_count || 0),
      topicCount: Number(row.topic_count || 0),
      finalVideoCount: Number(row.final_video_count || 0),
      totalPrompts: Number(row.total_prompts || 0),
      totalHeygenDuration: Number(row.total_heygen_duration || 0),
      totalCostUsd: Number(row.total_cost_usd || 0),
    });
  } catch (error) {
    console.error("Error fetching monthly dashboard stats:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

