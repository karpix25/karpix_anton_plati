import { NextResponse } from "next/server";
import {
  extractTelegramSessionToken,
  getTelegramSessionUser,
  TELEGRAM_SESSION_COOKIE,
} from "@/lib/server/telegram-auth";

export async function GET(request: Request) {
  try {
    const sessionToken = extractTelegramSessionToken(request);
    if (!sessionToken) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const user = await getTelegramSessionUser(sessionToken);
    if (!user) {
      const response = NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
      response.cookies.set({
        name: TELEGRAM_SESSION_COOKIE,
        value: "",
        path: "/",
        maxAge: 0,
      });
      return response;
    }

    return NextResponse.json({ ok: true, user }, { status: 200 });
  } catch (error) {
    console.error("Telegram auth session error:", error);
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}
