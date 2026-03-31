import { NextResponse } from 'next/server';
import pool from '@/lib/db';

async function ensureClientVoiceColumn() {
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'minimax'");
  await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_voice_id TEXT');
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY'");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS auto_generate_final_videos BOOLEAN DEFAULT FALSE");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS daily_final_video_limit INTEGER DEFAULT 3");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS monthly_final_video_limit INTEGER DEFAULT 30");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_duration_min_seconds INTEGER DEFAULT 50");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_duration_max_seconds INTEGER DEFAULT 50");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_timing_mode TEXT DEFAULT 'semantic_pause'");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_pacing_profile TEXT DEFAULT 'balanced'");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_pause_threshold_seconds NUMERIC(3,2) DEFAULT 0.45");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_coverage_percent NUMERIC(4,1) DEFAULT 35.0");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_semantic_relevance_priority TEXT DEFAULT 'balanced'");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_product_clip_policy TEXT DEFAULT 'contextual'");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_generator_model TEXT DEFAULT 'bytedance/v1-pro-text-to-video'");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS product_media_assets JSONB DEFAULT '[]'::jsonb");
}

async function ensureScenarioStatsColumns() {
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_status TEXT");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_updated_at TIMESTAMP");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_uploaded_at TIMESTAMP");
}

function resolveFinalVideoLimits(dailyLimit: unknown, monthlyLimit: unknown) {
  const resolvedDailyLimit = Math.max(1, Number.parseInt(String(dailyLimit || 3), 10) || 3);
  const resolvedMonthlyLimit = Math.max(
    resolvedDailyLimit,
    Number.parseInt(String(monthlyLimit || 30), 10) || 30
  );
  return {
    resolvedDailyLimit,
    resolvedMonthlyLimit,
  };
}

export async function GET() {
  try {
    await ensureClientVoiceColumn();
    await ensureScenarioStatsColumns();
    const { rows } = await pool.query(`
      SELECT
        c.*,
        COALESCE(stats.daily_final_video_count, 0) AS daily_final_video_count,
        COALESCE(stats.monthly_final_video_count, 0) AS monthly_final_video_count
      FROM clients c
      LEFT JOIN (
        SELECT
          client_id,
          COUNT(*) FILTER (
            WHERE DATE_TRUNC('day', COALESCE(montage_yandex_uploaded_at, montage_updated_at, created_at)) = DATE_TRUNC('day', CURRENT_TIMESTAMP)
          )::int AS daily_final_video_count,
          COUNT(*)::int AS monthly_final_video_count
        FROM generated_scenarios
        WHERE montage_status = 'completed'
          AND DATE_TRUNC('month', COALESCE(montage_yandex_uploaded_at, montage_updated_at, created_at)) = DATE_TRUNC('month', CURRENT_TIMESTAMP)
        GROUP BY client_id
      ) stats ON stats.client_id = c.id
      ORDER BY c.created_at DESC
    `);
    return NextResponse.json(rows);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureClientVoiceColumn();
    const {
      name,
      niche,
      product_info,
      brand_voice,
      target_audience,
      auto_generate,
      monthly_limit,
      target_duration_seconds,
      target_duration_min_seconds,
      target_duration_max_seconds,
      broll_interval_seconds,
      broll_timing_mode,
      broll_pacing_profile,
      broll_pause_threshold_seconds,
      broll_coverage_percent,
      broll_semantic_relevance_priority,
      broll_product_clip_policy,
      broll_generator_model,
      product_media_assets,
      product_keyword,
      product_video_url,
      tts_provider,
      tts_voice_id,
      elevenlabs_voice_id,
      auto_generate_final_videos,
      daily_final_video_limit,
      monthly_final_video_limit,
    } = await request.json();
    const resolvedTargetDurationMinSeconds = Math.max(
      15,
      Number(target_duration_min_seconds || target_duration_seconds || 50)
    );
    const resolvedTargetDurationMaxSeconds = Math.max(
      resolvedTargetDurationMinSeconds,
      Number(target_duration_max_seconds || target_duration_seconds || resolvedTargetDurationMinSeconds)
    );
    const resolvedTargetDurationSeconds = Math.round(
      (resolvedTargetDurationMinSeconds + resolvedTargetDurationMaxSeconds) / 2
    );
    const { resolvedDailyLimit, resolvedMonthlyLimit } = resolveFinalVideoLimits(
      daily_final_video_limit,
      monthly_final_video_limit
    );
    const { rows } = await pool.query(
      'INSERT INTO clients (name, niche, product_info, brand_voice, target_audience, auto_generate, monthly_limit, target_duration_seconds, target_duration_min_seconds, target_duration_max_seconds, broll_interval_seconds, broll_timing_mode, broll_pacing_profile, broll_pause_threshold_seconds, broll_coverage_percent, broll_semantic_relevance_priority, broll_product_clip_policy, broll_generator_model, product_media_assets, product_keyword, product_video_url, tts_provider, tts_voice_id, elevenlabs_voice_id, auto_generate_final_videos, daily_final_video_limit, monthly_final_video_limit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27) RETURNING *',
      [
        name,
        niche,
        product_info,
        brand_voice,
        target_audience,
        auto_generate || false,
        monthly_limit || 30,
        resolvedTargetDurationSeconds,
        resolvedTargetDurationMinSeconds,
        resolvedTargetDurationMaxSeconds,
        broll_interval_seconds || 3,
        broll_timing_mode || 'semantic_pause',
        broll_pacing_profile || 'balanced',
        broll_pause_threshold_seconds || 0.45,
        broll_coverage_percent || 35,
        broll_semantic_relevance_priority || 'balanced',
        broll_product_clip_policy || 'contextual',
        broll_generator_model || 'bytedance/v1-pro-text-to-video',
        product_media_assets || [],
        product_keyword || null,
        product_video_url || null,
        tts_provider || 'minimax',
        tts_voice_id || 'Russian_Engaging_Podcaster_v1',
        elevenlabs_voice_id || '0ArNnoIAWKlT4WweaVMY',
        auto_generate_final_videos || false,
        resolvedDailyLimit,
        resolvedMonthlyLimit,
      ]
    );
    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await ensureClientVoiceColumn();
    const {
      id,
      brand_voice,
      product_info,
      target_audience,
      auto_generate,
      monthly_limit,
      target_duration_seconds,
      target_duration_min_seconds,
      target_duration_max_seconds,
      broll_interval_seconds,
      broll_timing_mode,
      broll_pacing_profile,
      broll_pause_threshold_seconds,
      broll_coverage_percent,
      broll_semantic_relevance_priority,
      broll_product_clip_policy,
      broll_generator_model,
      product_media_assets,
      product_keyword,
      product_video_url,
      tts_provider,
      tts_voice_id,
      elevenlabs_voice_id,
      auto_generate_final_videos,
      daily_final_video_limit,
      monthly_final_video_limit,
    } = await request.json();
    const resolvedTargetDurationMinSeconds = Math.max(
      15,
      Number(target_duration_min_seconds || target_duration_seconds || 50)
    );
    const resolvedTargetDurationMaxSeconds = Math.max(
      resolvedTargetDurationMinSeconds,
      Number(target_duration_max_seconds || target_duration_seconds || resolvedTargetDurationMinSeconds)
    );
    const resolvedTargetDurationSeconds = Math.round(
      (resolvedTargetDurationMinSeconds + resolvedTargetDurationMaxSeconds) / 2
    );
    const { resolvedDailyLimit, resolvedMonthlyLimit } = resolveFinalVideoLimits(
      daily_final_video_limit,
      monthly_final_video_limit
    );
    const { rows } = await pool.query(
      'UPDATE clients SET brand_voice = $1, product_info = $2, target_audience = $3, auto_generate = $4, monthly_limit = $5, target_duration_seconds = $6, target_duration_min_seconds = $7, target_duration_max_seconds = $8, broll_interval_seconds = $9, broll_timing_mode = $10, broll_pacing_profile = $11, broll_pause_threshold_seconds = $12, broll_coverage_percent = $13, broll_semantic_relevance_priority = $14, broll_product_clip_policy = $15, broll_generator_model = $16, product_media_assets = $17, product_keyword = $18, product_video_url = $19, tts_provider = $20, tts_voice_id = $21, elevenlabs_voice_id = $22, auto_generate_final_videos = $23, daily_final_video_limit = $24, monthly_final_video_limit = $25 WHERE id = $26 RETURNING *',
      [
        brand_voice,
        product_info,
        target_audience,
        auto_generate,
        monthly_limit,
        resolvedTargetDurationSeconds,
        resolvedTargetDurationMinSeconds,
        resolvedTargetDurationMaxSeconds,
        broll_interval_seconds || 3,
        broll_timing_mode || 'semantic_pause',
        broll_pacing_profile || 'balanced',
        broll_pause_threshold_seconds || 0.45,
        broll_coverage_percent || 35,
        broll_semantic_relevance_priority || 'balanced',
        broll_product_clip_policy || 'contextual',
        broll_generator_model || 'bytedance/v1-pro-text-to-video',
        product_media_assets || [],
        product_keyword || null,
        product_video_url || null,
        tts_provider || 'minimax',
        tts_voice_id || 'Russian_Engaging_Podcaster_v1',
        elevenlabs_voice_id || '0ArNnoIAWKlT4WweaVMY',
        auto_generate_final_videos || false,
        resolvedDailyLimit,
        resolvedMonthlyLimit,
        id,
      ]
    );
    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureClientVoiceColumn();
    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get("id");
    const clientId = Number(rawId);

    if (!Number.isFinite(clientId) || clientId <= 0) {
      return NextResponse.json({ error: "Valid client id is required" }, { status: 400 });
    }

    const { rowCount, rows } = await pool.query(
      "DELETE FROM clients WHERE id = $1 RETURNING id, name",
      [clientId]
    );

    if (!rowCount) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: rows[0] });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
