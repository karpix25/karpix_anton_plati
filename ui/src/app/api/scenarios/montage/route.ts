import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import pool from "@/lib/db";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const scenarioId = searchParams.get("scenarioId");

    if (!scenarioId) {
      return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
    }

    await pool.query("ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_video_path TEXT");

    const { rows } = await pool.query<{ montage_video_path: string | null }>(
      `SELECT montage_video_path
       FROM generated_scenarios
       WHERE id = $1`,
      [scenarioId]
    );

    const filePath = rows[0]?.montage_video_path;
    if (!filePath || !existsSync(filePath)) {
      return NextResponse.json({ error: "Montage video not found" }, { status: 404 });
    }

    const buffer = await readFile(filePath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Scenario montage GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
