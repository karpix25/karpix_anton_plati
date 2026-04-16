import { NextResponse } from "next/server";
import pool from "@/lib/db";

const AUTO_OPTIMIZE_MIN_COMMENT_LENGTH = 20;
const OPTIMIZABLE_CATEGORIES = new Set(["scenario", "visual", "video"]);

function normalizeCategories(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  for (const raw of input) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
  }
  return Array.from(seen);
}

function resolveOptimizationCategories(
  rating: string | null,
  comment: string,
  categories: string[]
): string[] {
  if (rating !== "dislike") {
    return [];
  }

  if (comment.trim().length < AUTO_OPTIMIZE_MIN_COMMENT_LENGTH) {
    return [];
  }

  const selected = categories.filter((category) => OPTIMIZABLE_CATEGORIES.has(category));
  if (selected.length > 0) {
    return selected;
  }

  // Если категория не выбрана, считаем это общим фидбэком по тексту сценария.
  return ["scenario"];
}

async function runOptimization(
  request: Request,
  clientId: number,
  categories: string[]
): Promise<{ attempted: string[]; succeeded: string[]; failed: Array<{ category: string; error: string }> }> {
  const origin = new URL(request.url).origin;
  const attempted = [...new Set(categories)];
  const results = await Promise.allSettled(
    attempted.map(async (category) => {
      const response = await fetch(`${origin}/api/clients/optimize-prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, category }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const errorText =
          (payload && typeof payload.error === "string" ? payload.error : "") ||
          `HTTP ${response.status}`;
        throw new Error(errorText);
      }
      return category;
    })
  );

  const succeeded: string[] = [];
  const failed: Array<{ category: string; error: string }> = [];
  results.forEach((result, index) => {
    const category = attempted[index];
    if (result.status === "fulfilled") {
      succeeded.push(category);
      return;
    }
    failed.push({
      category,
      error: result.reason instanceof Error ? result.reason.message : "Unknown optimization error",
    });
  });

  return { attempted, succeeded, failed };
}

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

    const normalizedRating = rating || null;
    const commentText = String(comment ?? "").slice(0, 2000);
    const normalizedCategories = normalizeCategories(categories);
    const categoriesStr = normalizedCategories.join(",");

    const { rows } = await pool.query(
      `UPDATE generated_scenarios
       SET feedback_rating = $1,
           feedback_comment = $2,
           feedback_categories = $3
       WHERE id = $4
       RETURNING id, client_id, feedback_rating, feedback_comment, feedback_categories`,
      [normalizedRating, commentText, categoriesStr || null, resolvedId]
    );

    if (!rows[0]) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const optimizeCategories = resolveOptimizationCategories(
      normalizedRating,
      commentText,
      normalizedCategories
    );

    const resolvedClientId = Number.parseInt(String(rows[0].client_id), 10);

    let optimization:
      | { attempted: string[]; succeeded: string[]; failed: Array<{ category: string; error: string }> }
      | null = null;
    if (Number.isFinite(resolvedClientId) && resolvedClientId > 0 && optimizeCategories.length > 0) {
      optimization = await runOptimization(request, resolvedClientId, optimizeCategories);
    }

    return NextResponse.json({ ok: true, ...rows[0], optimization });
  } catch (error) {
    console.error("Scenario feedback error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
