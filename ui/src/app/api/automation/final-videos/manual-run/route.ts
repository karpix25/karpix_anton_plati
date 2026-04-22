import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getTelegramSessionUserFromRequest } from "@/lib/server/telegram-auth";

const MANUAL_FINAL_VIDEO_RUN_LOCK_KEY = 84244002;

export async function POST(request: Request) {
  try {
    const user = await getTelegramSessionUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await request.json().catch(() => ({}));
    const clientId = Number(payload?.clientId);
    if (!Number.isFinite(clientId) || clientId <= 0) {
      return NextResponse.json({ error: "Valid clientId is required" }, { status: 400 });
    }

    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");

      const lockRes = await dbClient.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock($1, $2) AS locked",
        [MANUAL_FINAL_VIDEO_RUN_LOCK_KEY, clientId]
      );

      if (!lockRes.rows[0]?.locked) {
        await dbClient.query("ROLLBACK");
        return NextResponse.json(
          { error: "Manual run is already in progress for this project" },
          { status: 409 }
        );
      }

      const statsRes = await dbClient.query<{
        id: number;
        daily_limit: number;
        monthly_limit: number;
        monthly_job_count: number;
      }>(
        `
        SELECT
          c.id,
          GREATEST(0, COALESCE(c.daily_final_video_limit, 0))::int AS daily_limit,
          GREATEST(0, COALESCE(c.monthly_final_video_limit, 0))::int AS monthly_limit,
          COALESCE((
            SELECT COUNT(*)::int
            FROM final_video_jobs fvj
            WHERE fvj.client_id = c.id
              AND DATE_TRUNC(
                    'month',
                    ((fvj.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')
                  ) = DATE_TRUNC('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow'))
          ), 0)::int AS monthly_job_count
        FROM clients c
        WHERE c.id = $1
        FOR UPDATE
        `,
        [clientId]
      );

      const stats = statsRes.rows[0];
      if (!stats) {
        await dbClient.query("ROLLBACK");
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }

      const dailyLimit = Number(stats.daily_limit || 0);
      const monthlyLimit = Number(stats.monthly_limit || 0);
      const monthlyJobCount = Number(stats.monthly_job_count || 0);

      if (dailyLimit <= 0 || monthlyLimit <= 0) {
        await dbClient.query("ROLLBACK");
        return NextResponse.json(
          { error: "Set daily and monthly final video limits above zero first" },
          { status: 400 }
        );
      }

      const remainingMonthly = Math.max(0, monthlyLimit - monthlyJobCount);
      const requestedBatchSize = dailyLimit;
      const toEnqueue = Math.min(requestedBatchSize, remainingMonthly);

      if (toEnqueue > 0) {
        await dbClient.query(
          `INSERT INTO final_video_jobs (client_id)
           SELECT $1
           FROM generate_series(1, $2)`,
          [clientId, toEnqueue]
        );
      }

      await dbClient.query("COMMIT");

      return NextResponse.json({
        ok: true,
        clientId,
        requestedBatchSize,
        queuedCount: toEnqueue,
        monthlyLimit,
        monthlyJobCountBefore: monthlyJobCount,
        monthlyJobCountAfter: monthlyJobCount + toEnqueue,
        remainingMonthlyAfter: remainingMonthly - toEnqueue,
        skippedDueToMonthlyLimit: toEnqueue === 0,
      });
    } catch (error) {
      await dbClient.query("ROLLBACK");
      throw error;
    } finally {
      dbClient.release();
    }
  } catch (error) {
    console.error("Manual final video run error:", error);
    return NextResponse.json({ error: "Failed to start manual automation run" }, { status: 500 });
  }
}
