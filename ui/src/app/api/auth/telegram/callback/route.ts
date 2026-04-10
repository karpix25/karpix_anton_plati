import { NextResponse } from "next/server";
import {
  consumeTelegramAuthCallback,
  TELEGRAM_SESSION_COOKIE,
} from "@/lib/server/telegram-auth";

function resolvePublicOrigin(request: Request) {
  const explicitBaseUrl = String(process.env.WEBAPP_BASE_URL || process.env.UI_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (explicitBaseUrl) {
    try {
      return new URL(explicitBaseUrl).origin;
    } catch (error) {
      console.error("Invalid WEBAPP_BASE_URL/UI_BASE_URL:", error);
    }
  }

  const forwardedHost = String(request.headers.get("x-forwarded-host") || "")
    .split(",")[0]
    .trim();
  const forwardedProto = String(request.headers.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim();
  if (forwardedHost) {
    const protocol = forwardedProto || "https";
    return `${protocol}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

function buildErrorRedirect(request: Request, code: string) {
  const origin = resolvePublicOrigin(request);
  return `${origin}/?auth_error=${encodeURIComponent(code)}`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const publicOrigin = resolvePublicOrigin(request);
    const requestId = String(url.searchParams.get("requestId") || "").trim();
    const token = String(url.searchParams.get("token") || "").trim();

    if (!requestId || !token) {
      return NextResponse.redirect(buildErrorRedirect(request, "invalid_callback"), { status: 302 });
    }

    const result = await consumeTelegramAuthCallback(requestId, token);
    if (!result.ok) {
      return NextResponse.redirect(buildErrorRedirect(request, result.error), { status: 302 });
    }

    const redirectUrl = new URL(result.redirectPath || "/", `${publicOrigin}/`);
    const response = NextResponse.redirect(redirectUrl, { status: 302 });
    response.cookies.set({
      name: TELEGRAM_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: result.sessionExpiresAt,
    });
    return response;
  } catch (error) {
    console.error("Telegram auth callback error:", error);
    return NextResponse.redirect(buildErrorRedirect(request, "callback_failed"), { status: 302 });
  }
}
