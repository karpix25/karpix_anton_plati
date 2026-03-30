import { NextResponse } from 'next/server';
import pool from '@/lib/db';

async function ensureClientVoiceColumn() {
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'minimax'");
  await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_voice_id TEXT');
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY'");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS auto_generate_final_videos BOOLEAN DEFAULT FALSE");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS monthly_final_video_limit INTEGER DEFAULT 30");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_timing_mode TEXT DEFAULT 'semantic_pause'");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_pacing_profile TEXT DEFAULT 'balanced'");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_pause_threshold_seconds NUMERIC(3,2) DEFAULT 0.45");
}

export async function GET() {
  try {
    await ensureClientVoiceColumn();
    const { rows } = await pool.query(`
      SELECT
        c.*,
        COALESCE(stats.monthly_final_video_count, 0) AS monthly_final_video_count
      FROM clients c
      LEFT JOIN (
        SELECT
          client_id,
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
      broll_interval_seconds,
      broll_timing_mode,
      broll_pacing_profile,
      broll_pause_threshold_seconds,
      product_keyword,
      product_video_url,
      tts_provider,
      tts_voice_id,
      elevenlabs_voice_id,
      auto_generate_final_videos,
      monthly_final_video_limit,
    } = await request.json();
    const { rows } = await pool.query(
      'INSERT INTO clients (name, niche, product_info, brand_voice, target_audience, auto_generate, monthly_limit, target_duration_seconds, broll_interval_seconds, broll_timing_mode, broll_pacing_profile, broll_pause_threshold_seconds, product_keyword, product_video_url, tts_provider, tts_voice_id, elevenlabs_voice_id, auto_generate_final_videos, monthly_final_video_limit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *',
      [
        name,
        niche,
        product_info,
        brand_voice,
        target_audience,
        auto_generate || false,
        monthly_limit || 30,
        target_duration_seconds || 50,
        broll_interval_seconds || 3,
        broll_timing_mode || 'semantic_pause',
        broll_pacing_profile || 'balanced',
        broll_pause_threshold_seconds || 0.45,
        product_keyword || null,
        product_video_url || null,
        tts_provider || 'minimax',
        tts_voice_id || 'Russian_Engaging_Podcaster_v1',
        elevenlabs_voice_id || '0ArNnoIAWKlT4WweaVMY',
        auto_generate_final_videos || false,
        monthly_final_video_limit || 30,
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
      broll_interval_seconds,
      broll_timing_mode,
      broll_pacing_profile,
      broll_pause_threshold_seconds,
      product_keyword,
      product_video_url,
      tts_provider,
      tts_voice_id,
      elevenlabs_voice_id,
      auto_generate_final_videos,
      monthly_final_video_limit,
    } = await request.json();
    const { rows } = await pool.query(
      'UPDATE clients SET brand_voice = $1, product_info = $2, target_audience = $3, auto_generate = $4, monthly_limit = $5, target_duration_seconds = $6, broll_interval_seconds = $7, broll_timing_mode = $8, broll_pacing_profile = $9, broll_pause_threshold_seconds = $10, product_keyword = $11, product_video_url = $12, tts_provider = $13, tts_voice_id = $14, elevenlabs_voice_id = $15, auto_generate_final_videos = $16, monthly_final_video_limit = $17 WHERE id = $18 RETURNING *',
      [
        brand_voice,
        product_info,
        target_audience,
        auto_generate,
        monthly_limit,
        target_duration_seconds || 50,
        broll_interval_seconds || 3,
        broll_timing_mode || 'semantic_pause',
        broll_pacing_profile || 'balanced',
        broll_pause_threshold_seconds || 0.45,
        product_keyword || null,
        product_video_url || null,
        tts_provider || 'minimax',
        tts_voice_id || 'Russian_Engaging_Podcaster_v1',
        elevenlabs_voice_id || '0ArNnoIAWKlT4WweaVMY',
        auto_generate_final_videos || false,
        monthly_final_video_limit || 30,
        id,
      ]
    );
    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
