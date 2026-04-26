import { NextResponse } from "next/server";

import { pollSavedKieTasks } from "@/lib/server/kie-poll";

const kiePollSignatureCache = new Map<string, string>();

function buildKiePollSignature(updated: { stdout: string; stderr: string }) {
  const combined = `${updated.stdout || ""}\n${updated.stderr || ""}`;
  const refreshMatches = [...combined.matchAll(/KIE task refresh:\s*task_id=([^\s]+).*?state=([^\s]+).*?urls=(\d+)/g)];
  const states = refreshMatches
    .map((match) => `${match[1]}:${match[2]}:urls=${match[3]}`)
    .sort();
  const updatedCountMatch = combined.match(/Updated scenarios:\s*(\d+)/);
  const updatedCount = updatedCountMatch ? Number(updatedCountMatch[1]) : null;
  const errorLines = combined
    .split(/\r?\n/)
    .filter((line) => /\bERROR\b|failed|exception/i.test(line))
    .slice(-2);

  return JSON.stringify({
    updatedCount,
    states,
    errors: errorLines,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const jobId = body?.jobId ? String(body.jobId) : null;
    const limit = Number(body?.limit || 100);

    const updated = await pollSavedKieTasks({ jobId, limit });
    const cacheKey = jobId || `limit:${limit}`;
    const signature = buildKiePollSignature(updated);
    const previousSignature = kiePollSignatureCache.get(cacheKey);
    if (signature !== previousSignature) {
      kiePollSignatureCache.set(cacheKey, signature);
      const parsed = JSON.parse(signature) as {
        updatedCount: number | null;
        states: string[];
        errors: string[];
      };
      console.log(
        `[KIE] poll change: jobId=${jobId || "NULL"} limit=${limit} updatedScenarios=${
          parsed.updatedCount ?? "unknown"
        } states=${parsed.states.length ? parsed.states.join(",") : "none"} errors=${
          parsed.errors.length ? parsed.errors.join(" | ") : "none"
        }`
      );
    }

    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    console.error("KIE poll error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
