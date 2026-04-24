import { NextResponse } from "next/server";
import pool from "@/lib/db";

import { processOptimization } from "@/lib/optimize-prompts-service";

export async function POST(request: Request) {
  try {
    const { clientId, category } = await request.json();
    const result = await processOptimization(clientId, category);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Optimize prompts error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: error instanceof Error && error.message.includes("Нет фидбэка") ? 400 : 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const resolvedClientId = Number.parseInt(String(clientId), 10);

    if (!Number.isFinite(resolvedClientId) || resolvedClientId <= 0) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    const { rows } = await pool.query(
      `SELECT learned_rules_scenario, learned_rules_visual, learned_rules_video FROM clients WHERE id = $1`,
      [resolvedClientId]
    );

    if (!rows[0]) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Get feedback stats
    const statsResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE feedback_rating = 'like') as likes,
         COUNT(*) FILTER (WHERE feedback_rating = 'dislike') as dislikes,
         COUNT(*) FILTER (WHERE feedback_rating IS NOT NULL) as total
       FROM generated_scenarios
       WHERE client_id = $1`,
      [resolvedClientId]
    );

    return NextResponse.json({
      rules: {
        scenario: rows[0].learned_rules_scenario || "",
        visual: rows[0].learned_rules_visual || "",
        video: rows[0].learned_rules_video || "",
      },
      stats: {
        likes: Number(statsResult.rows[0]?.likes || 0),
        dislikes: Number(statsResult.rows[0]?.dislikes || 0),
        total: Number(statsResult.rows[0]?.total || 0),
      },
    });
  } catch (error) {
    console.error("Get prompt rules error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
