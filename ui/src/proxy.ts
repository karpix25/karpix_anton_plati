import { NextResponse } from "next/server";
import { getFMIdentity, isAutomationRequest, validateApiRequest } from "@/lib/server/telegram-auth";
import { validProviderAsset } from "@/lib/server/provider-assets";

export async function proxy(request: Request) {
  if (request.headers.has("x-fm-identity")) {
    return getFMIdentity(request) ? NextResponse.next() : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (new URL(request.url).searchParams.has("fm_asset")) {
    return validProviderAsset(request) ? NextResponse.next() : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.headers.has("x-automation-token")) {
    return isAutomationRequest(request) ? NextResponse.next() : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (["/api/tts", "/api/heygen/avatar-video", "/api/scenarios/assemble"].includes(new URL(request.url).pathname)) {
    const { errorResponse } = await validateApiRequest(request);
    if (errorResponse) return errorResponse;
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };
