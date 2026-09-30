import { NextResponse } from "next/server";
import { listEngines, syncEngines } from "@/lib/server/heygen-engines";

// GET  — список движков для выпадающего списка в настройках проекта.
// POST — переспросить у HeyGen актуальные коды и дописать новые (0 кредитов).
export async function GET() {
  try {
    return NextResponse.json({ engines: await listEngines() });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("[HEYGEN] engines list error:", error);
    return NextResponse.json({ error: `Не удалось получить список движков: ${details}` }, { status: 500 });
  }
}

export async function POST() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "HEYGEN_API_KEY не настроен" }, { status: 500 });
  }

  try {
    const { known, added } = await syncEngines(apiKey);
    if (!known) {
      // Формат ответа HeyGen изменился — молча «0 новых» здесь было бы враньём.
      return NextResponse.json(
        { error: "HeyGen не вернул список движков в ожидаемом виде. Список оставлен без изменений." },
        { status: 502 }
      );
    }
    console.log(`[HEYGEN] engines sync: known=${known} added=${added.join(",") || "-"}`);
    return NextResponse.json({ known, added, engines: await listEngines() });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("[HEYGEN] engines sync error:", error);
    return NextResponse.json({ error: `Не удалось обновить список движков: ${details}` }, { status: 500 });
  }
}
