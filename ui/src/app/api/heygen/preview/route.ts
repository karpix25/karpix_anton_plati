import { NextResponse } from "next/server";
import { getCachedHeygenPreviewBlob } from "@/lib/server/heygen-preview-cache";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    const hasVersion = Boolean(searchParams.get("v"));

    if (!key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    const cached = await getCachedHeygenPreviewBlob(key);
    if (!cached) {
      return NextResponse.json({ error: "Preview not found" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(cached.data), {
      status: 200,
      headers: {
        "Content-Type": cached.mimeType,
        "ETag": cached.contentHash || "",
        "Cache-Control": hasVersion
          ? "public, max-age=31536000, immutable"
          : "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("HeyGen preview GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
