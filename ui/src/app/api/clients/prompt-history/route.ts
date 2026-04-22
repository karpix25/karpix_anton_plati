import { NextResponse } from "next/server";
import pool from "@/lib/db";

const CATEGORY_FIELD_MAP: Record<string, string> = {
  scenario: "learned_rules_scenario",
  visual: "learned_rules_visual",
  video: "learned_rules_video",
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const category = searchParams.get("category");
    
    const resolvedClientId = Number.parseInt(String(clientId), 10);

    if (!Number.isFinite(resolvedClientId) || resolvedClientId <= 0) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    if (!category || !CATEGORY_FIELD_MAP[category]) {
      return NextResponse.json({ error: "valid category is required" }, { status: 400 });
    }

    // Ensure history table exists just in case GET is called before any save
    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_learned_rules_history (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        rules_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const { rows } = await pool.query(
      `SELECT id, rules_text, created_at 
       FROM client_learned_rules_history 
       WHERE client_id = $1 AND category = $2 
       ORDER BY created_at DESC`,
      [resolvedClientId, category]
    );

    return NextResponse.json({ history: rows });
  } catch (error) {
    console.error("Get prompt history error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { clientId, category, historyId } = await request.json();
    const resolvedClientId = Number.parseInt(String(clientId), 10);
    const resolvedHistoryId = Number.parseInt(String(historyId), 10);

    if (!Number.isFinite(resolvedClientId) || resolvedClientId <= 0) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    if (!Number.isFinite(resolvedHistoryId) || resolvedHistoryId <= 0) {
      return NextResponse.json({ error: "historyId is required" }, { status: 400 });
    }

    if (!category || !CATEGORY_FIELD_MAP[category]) {
      return NextResponse.json({ error: "valid category is required" }, { status: 400 });
    }

    const dbField = CATEGORY_FIELD_MAP[category];

    // Fetch the history record
    const historyResult = await pool.query(
      `SELECT rules_text FROM client_learned_rules_history WHERE id = $1 AND client_id = $2 AND category = $3`,
      [resolvedHistoryId, resolvedClientId, category]
    );

    if (historyResult.rows.length === 0) {
      return NextResponse.json({ error: "History record not found" }, { status: 404 });
    }

    const historicalRules = historyResult.rows[0].rules_text;

    // Get current rules
    const clientResult = await pool.query(
      `SELECT ${dbField} FROM clients WHERE id = $1`,
      [resolvedClientId]
    );
    const currentRules = clientResult.rows[0]?.[dbField] || "";

    // Save current rules to history before overwriting (if they exist)
    if (currentRules && currentRules.trim().length > 0) {
      await pool.query(
        `INSERT INTO client_learned_rules_history (client_id, category, rules_text) VALUES ($1, $2, $3)`,
        [resolvedClientId, category, currentRules]
      );
    }

    // Restore historical rules
    await pool.query(
      `UPDATE clients SET ${dbField} = $1 WHERE id = $2`,
      [historicalRules, resolvedClientId]
    );

    return NextResponse.json({ ok: true, restoredRules: historicalRules });
  } catch (error) {
    console.error("Rollback prompt history error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
