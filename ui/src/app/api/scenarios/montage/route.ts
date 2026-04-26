import { NextResponse } from "next/server";
import { createReadStream, existsSync } from "fs";
import { stat } from "fs/promises";
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

    const fileStat = await stat(filePath);
    const fileSize = fileStat.size;
    const range = request.headers.get("range");

    if (range) {
      const bytesPrefix = "bytes=";
      if (!range.startsWith(bytesPrefix)) {
        return new NextResponse("Malformed range header", { status: 416 });
      }

      const rangeValue = range.slice(bytesPrefix.length);
      const [startRaw, endRaw] = rangeValue.split("-");
      const start = Number.parseInt(startRaw, 10);
      const end = endRaw ? Number.parseInt(endRaw, 10) : fileSize - 1;

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= fileSize) {
        return new NextResponse("Requested range not satisfiable", {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
          },
        });
      }

      const chunkSize = end - start + 1;
      const stream = createReadStream(filePath, { start, end });

      return new NextResponse(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Content-Length": String(chunkSize),
          "Cache-Control": "no-store",
        },
      });
    }

    const stream = createReadStream(filePath);
    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Content-Length": String(fileSize),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Scenario montage GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
