import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function POST(request: Request) {
  try {
    const { scenarioId, rating, comment, categories } = await request.json();
    const resolvedId = Number.parseInt(String(scenarioId), 10);

    if (!Number.isFinite(resolvedId) || resolvedId <= 0) {
      return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
    }

    const allowedRatings = new Set(["like", "dislike", null, ""]);
    if (!allowedRatings.has(rating ?? null)) {
      return NextResponse.json({ error: "rating must be 'like', 'dislike', or empty" }, { status: 400 });
    }

    const categoriesStr = Array.isArray(categories) ? categories.join(",") : "";

    const { rows } = await pool.query(
      `UPDATE generated_scenarios
       SET feedback_rating = $1,
           feedback_comment = $2,
           feedback_categories = $3
       WHERE id = $4
       RETURNING id, feedback_rating, feedback_comment, feedback_categories`,
      [rating || null, (comment || "").slice(0, 2000), categoriesStr || null, resolvedId]
    );

    if (!rows[0]) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ...rows[0] });
  } catch (error) {
    console.error("Scenario feedback error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
