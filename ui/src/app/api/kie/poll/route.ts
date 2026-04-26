import { NextResponse } from "next/server";

import { pollSavedKieTasks } from "@/lib/server/kie-poll";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const jobId = body?.jobId ? String(body.jobId) : null;
    const limit = Number(body?.limit || 100);
    console.log(`[KIE] poll start: jobId=${jobId || "NULL"} limit=${limit}`);

    const updated = await pollSavedKieTasks({ jobId, limit });
    console.log(
      `[KIE] poll success: jobId=${jobId || "NULL"} stdoutLength=${updated.stdout.length} stderrLength=${updated.stderr.length}`
    );
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    console.error("KIE poll error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
