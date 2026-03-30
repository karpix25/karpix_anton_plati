import { NextResponse } from "next/server";

import { pollSavedKieTasks } from "@/lib/server/kie-poll";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const jobId = body?.jobId ? String(body.jobId) : null;
    const limit = Number(body?.limit || 100);

    const updated = await pollSavedKieTasks({ jobId, limit });
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    console.error("KIE poll error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
