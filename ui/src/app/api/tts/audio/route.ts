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

    const { rows } = await pool.query(
      `SELECT tts_audio_path
       FROM generated_scenarios
       WHERE id = $1`,
      [scenarioId]
    );

    const filePath = rows[0]?.tts_audio_path;
    if (!filePath || !existsSync(filePath)) {
      return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
    }

    const audioBuffer = await readFile(filePath);

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Scenario audio GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
