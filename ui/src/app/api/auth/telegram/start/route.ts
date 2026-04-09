import { NextResponse } from "next/server";
import { buildTelegramBotUrl, createTelegramAuthRequest, sanitizeReturnPath } from "@/lib/server/telegram-auth";

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const returnTo = sanitizeReturnPath((payload as { returnTo?: unknown })?.returnTo);
    const authRequest = await createTelegramAuthRequest(returnTo);
    const botUrl = buildTelegramBotUrl(authRequest.payload);

    return NextResponse.json({
      ok: true,
      requestId: authRequest.requestId,
      botUrl,
      expiresAt: authRequest.expiresAt,
    });
  } catch (error) {
    console.error("Telegram auth start error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to create Telegram auth request",
      },
      { status: 500 }
    );
  }
}

