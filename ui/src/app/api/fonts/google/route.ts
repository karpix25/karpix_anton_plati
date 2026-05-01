import { NextResponse } from "next/server";
import { buildGoogleFontFamilyList } from "@/lib/subtitles";

const GOOGLE_FONTS_METADATA_URL = "https://fonts.google.com/metadata/fonts";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let memoryCache: { expiresAt: number; fonts: string[] } | null = null;

function parseGoogleFontsMetadata(raw: string) {
  const clean = raw.replace(/^\)\]\}'\n?/, "");
  const parsed = JSON.parse(clean) as {
    familyMetadataList?: Array<{ family?: unknown }>;
  };

  if (!Array.isArray(parsed.familyMetadataList)) {
    return [];
  }

  return parsed.familyMetadataList
    .map((item) => (typeof item?.family === "string" ? item.family.trim() : ""))
    .filter(Boolean);
}

export async function GET() {
  const now = Date.now();
  if (memoryCache && memoryCache.expiresAt > now) {
    return NextResponse.json({ fonts: memoryCache.fonts, source: "cache" });
  }

  try {
    const response = await fetch(GOOGLE_FONTS_METADATA_URL, {
      cache: "no-store",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!response.ok) {
      throw new Error(`Google Fonts metadata request failed with status ${response.status}`);
    }

    const text = await response.text();
    const remoteFamilies = parseGoogleFontsMetadata(text);
    const fonts = buildGoogleFontFamilyList(remoteFamilies);
    memoryCache = {
      fonts,
      expiresAt: now + CACHE_TTL_MS,
    };
    return NextResponse.json({ fonts, source: "remote" });
  } catch (error) {
    console.warn("Failed to fetch Google Fonts metadata list, using fallback list:", error);
    const fonts = buildGoogleFontFamilyList();
    memoryCache = {
      fonts,
      expiresAt: now + Math.min(CACHE_TTL_MS, 30 * 60 * 1000),
    };
    return NextResponse.json({ fonts, source: "fallback" });
  }
}
