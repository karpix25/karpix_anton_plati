import { NextResponse } from "next/server";

import pool from "@/lib/db";
import { submitSavedKieTasks } from "@/lib/server/kie-submit";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const scenarioId = Number(body?.scenarioId);
    console.log(`[KIE] submit start: scenarioId=${String(body?.scenarioId ?? "NULL")}`);

    if (!Number.isFinite(scenarioId) || scenarioId <= 0) {
      return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
    }

    const { rows } = await pool.query<{ id: number; job_id: string | null }>(
      "SELECT id, job_id FROM generated_scenarios WHERE id = $1 LIMIT 1",
      [scenarioId]
    );

    const scenario = rows[0];
    if (!scenario?.job_id) {
      return NextResponse.json({ error: "Scenario or job_id not found" }, { status: 404 });
    }

    const result = await submitSavedKieTasks(scenario.job_id);
    console.log(
      `[KIE] submit success: scenarioId=${scenarioId} jobId=${scenario.job_id} stdoutLength=${result.stdout.length} stderrLength=${result.stderr.length}`
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("KIE submit error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
