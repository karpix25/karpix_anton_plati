import { NextResponse } from "next/server";
import { revokeTelegramSession, TELEGRAM_SESSION_COOKIE } from "@/lib/server/telegram-auth";

function extractSessionToken(cookieHeader: string) {
  return cookieHeader
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(`${TELEGRAM_SESSION_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=")
    .trim();
}

export async function POST(request: Request) {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const sessionToken = extractSessionToken(cookieHeader);
    if (sessionToken) {
      await revokeTelegramSession(decodeURIComponent(sessionToken));
    }

    const response = NextResponse.json({ ok: true }, { status: 200 });
    response.cookies.set({
      name: TELEGRAM_SESSION_COOKIE,
      value: "",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error("Telegram auth logout error:", error);
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}

