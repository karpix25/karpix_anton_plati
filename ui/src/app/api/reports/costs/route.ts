import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  try {
    // We calculate costs based on prompt counts and heygen duration stored in processed_content table
    // For prompt counts, we look into scenario_json->'video_generation_prompts'->'prompts'
    // For heygen, we look into heygen_video_id and tts_audio_duration_seconds
    
    // Note: This matches the logic in @/lib/generation-costs.ts but implemented in SQL for performance
    
    const query = `
      WITH scenario_data AS (
        SELECT 
          id,
          (
            SELECT count(*) 
            FROM jsonb_array_elements(COALESCE(scenario_json->'video_generation_prompts'->'prompts', '[]'::jsonb)) as p
            WHERE (p->>'use_ready_asset')::boolean IS NOT TRUE 
            AND (
              p->>'video_url' IS NOT NULL 
              OR jsonb_array_length(COALESCE(p->'result_urls', '[]'::jsonb)) > 0
              OR p->>'task_id' IS NOT NULL
              OR LOWER(p->>'task_state') IN ('success', 'fail')
              OR LOWER(p->>'submission_status') IN ('submitted', 'success', 'completed', 'failed')
            )
          ) as prompt_count,
          (
            CASE 
              WHEN heygen_requested_at IS NOT NULL 
                   OR heygen_video_id IS NOT NULL 
                   OR heygen_video_url IS NOT NULL 
                   OR LOWER(heygen_status) IN ('pending', 'waiting', 'processing', 'queued', 'in_progress', 'completed', 'success', 'failed')
              THEN COALESCE(tts_audio_duration_seconds, 0)
              ELSE 0
            END
          ) as heygen_duration,
          COALESCE(scenario_json->'video_generation_prompts'->>'generator_model', 'veo3_lite') as model
        FROM processed_content
        WHERE client_id = $1
        AND COALESCE(TRIM(scenario_json->>'script'), '') <> ''
        AND COALESCE(scenario_json->>'script', '') NOT ILIKE 'Error %'
      )
      SELECT 
        SUM(prompt_count) as total_prompts,
        SUM(heygen_duration) as total_heygen_duration,
        -- Approximate total cost calculation in SQL
        -- models: seedance_15_pro: 0.07, grok: 0.1, veo3: 0.15, fast: 0.08, lite: 0.04, other: 0.03
        SUM(
          prompt_count * (
            CASE 
              WHEN model = 'bytedance/seedance-1.5-pro' THEN 0.07
              WHEN model = 'grok-imagine/text-to-video' THEN 0.1
              WHEN model = 'veo3' THEN 0.15
              WHEN model = 'veo3_fast' THEN 0.08
              WHEN model = 'veo3_lite' THEN 0.04
              ELSE 0.03
            END
          ) + (heygen_duration / 60.0) * 1.0
        ) as total_cost_usd
      FROM scenario_data;
    `;

    const { rows } = await pool.query(query, [clientId]);
    const stats = rows[0];

    return NextResponse.json({
      totalPrompts: parseInt(stats.total_prompts || '0', 10),
      totalHeygenDuration: parseFloat(stats.total_heygen_duration || '0'),
      totalCostUsd: parseFloat(stats.total_cost_usd || '0')
    });
  } catch (error) {
    console.error('Error fetching cost stats:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
