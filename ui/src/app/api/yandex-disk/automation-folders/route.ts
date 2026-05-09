import { NextResponse } from "next/server";
import { getAutomationVideoFolderTree, isYandexDiskConfigured } from "@/lib/server/yandex-disk";
import { validateApiRequest } from "@/lib/server/telegram-auth";

export async function GET(request: Request) {
  try {
    const { errorResponse } = await validateApiRequest(request);
    if (errorResponse) return errorResponse;

    if (!isYandexDiskConfigured()) {
      return NextResponse.json({ error: "Yandex Disk token is not configured" }, { status: 503 });
    }

    const tree = await getAutomationVideoFolderTree();
    return NextResponse.json({ root: tree });
  } catch (error) {
    console.error("Yandex Disk automation folders error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Yandex Disk folders" },
      { status: 500 }
    );
  }
}
