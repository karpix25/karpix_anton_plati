import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

let isDbInitialized = false;

async function ensureMontageColumns() {
  if (isDbInitialized) return;

  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_status TEXT");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_updated_at TIMESTAMP");
  await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_uploaded_at TIMESTAMP");

  isDbInitialized = true;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    await ensureMontageColumns();

    const query = `
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')) - interval '11 months',
          date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')),
          interval '1 month'
        ) AS month_start
      )
      SELECT
        to_char(m.month_start, 'YYYY-MM') AS month_key,
        to_char(m.month_start, 'YYYY-MM-01') AS month_start,
        COALESCE(stats.completed_count, 0)::int AS completed_count
      FROM months m
      LEFT JOIN (
        SELECT
          date_trunc(
            'month',
            ((COALESCE(gs.montage_yandex_uploaded_at, gs.montage_updated_at, gs.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')
          ) AS month_start,
          COUNT(*)::int AS completed_count
        FROM generated_scenarios gs
        WHERE gs.client_id = $1
          AND gs.montage_status = 'completed'
        GROUP BY 1
      ) stats ON stats.month_start = m.month_start
      ORDER BY m.month_start DESC
    `;

    const { rows } = await pool.query(query, [Number(clientId)]);
    return NextResponse.json(
      rows.map((row) => ({
        month: String(row.month_key || ""),
        monthStart: String(row.month_start || ""),
        completed: Number(row.completed_count || 0),
      }))
    );
  } catch (error) {
    console.error("Error fetching monthly final video stats:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
