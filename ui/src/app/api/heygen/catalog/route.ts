import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getStableHeygenPreviewUrl } from "@/lib/server/heygen-preview-cache";

type HeygenAvatarGroup = {
  id: string;
  name?: string;
  group_type?: string;
  preview_image?: string;
  preview_image_url?: string;
};

type HeygenAvatarLook = {
  id: string;
  avatar_id?: string;
  look_id?: string;
  photo_avatar_id?: string;
  name?: string;
  created_at?: string | number;
  create_time?: string | number;
  updated_at?: string | number;
  update_time?: string | number;
  image_url?: string | null;
  preview_image?: string | null;
  preview_image_url?: string | null;
  gender?: string;
};

type HeygenPhotoAvatarDetails = {
  id?: string;
  is_motion?: boolean;
  status?: string;
  created_at?: string | number;
  create_time?: string | number;
  updated_at?: string | number;
  update_time?: string | number;
};

type HeygenPaginationParam = { key: string; value: string | number } | null;

type AvatarVoiceDefault = {
  avatar_id: string;
  tts_provider: "minimax" | "elevenlabs";
  tts_voice_id: string | null;
  elevenlabs_voice_id: string | null;
  gender: "male" | "female" | null;
};

const IMAGE_KEYS = [
  "preview_image_url",
  "preview_image",
  "image_url",
  "image",
  "thumbnail_url",
  "thumbnail",
  "cover_image_url",
  "cover_image",
  "url",
] as const;

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeImageUrl(value: string) {
  if (!value) {
    return "";
  }
  if (value.startsWith("//")) {
    return `https:${value}`;
  }
  return value;
}

function readImageUrl(value: unknown): string {
  if (typeof value === "string") {
    return normalizeImageUrl(value.trim());
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const record = value as Record<string, unknown>;
  const direct = pickString(...IMAGE_KEYS.map((key) => record[key]));
  if (direct) {
    return normalizeImageUrl(direct);
  }

  const nested = [
    record.preview,
    record.image,
    record.thumbnail,
    record.cover,
    record.avatar,
  ];

  for (const item of nested) {
    const nestedUrl = readImageUrl(item);
    if (nestedUrl) {
      return nestedUrl;
    }
  }

  return "";
}

async function heygenFetch(path: string) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    throw new Error("HEYGEN_API_KEY is not configured");
  }

  const response = await fetch(`https://api.heygen.com${path}`, {
    headers: {
      "X-Api-Key": apiKey,
    },
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `HeyGen request failed with status ${response.status}`);
  }

  return data;
}

async function ensureAvatarVoiceDefaultColumns() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS heygen_avatar_voice_defaults (
      avatar_id TEXT PRIMARY KEY,
      avatar_name TEXT,
      tts_provider TEXT DEFAULT 'minimax',
      tts_voice_id TEXT,
      elevenlabs_voice_id TEXT,
      gender TEXT,
      updated_from_client_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS avatar_name TEXT',
    "ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'minimax'",
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS tts_voice_id TEXT',
    "ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT",
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS gender TEXT',
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS updated_from_client_id INTEGER',
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    'ALTER TABLE heygen_avatar_voice_defaults ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    `INSERT INTO heygen_avatar_voice_defaults (
      avatar_id, avatar_name, tts_provider, tts_voice_id, elevenlabs_voice_id,
      gender, updated_from_client_id, created_at, updated_at
    )
    SELECT DISTINCT ON (a.avatar_id)
      a.avatar_id,
      a.avatar_name,
      CASE WHEN a.tts_provider = 'elevenlabs' THEN 'elevenlabs' ELSE 'minimax' END,
      a.tts_voice_id,
      a.elevenlabs_voice_id,
      a.gender,
      a.client_id,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM client_heygen_avatars a
    WHERE a.avatar_id IS NOT NULL AND a.avatar_id <> ''
    ORDER BY a.avatar_id, a.created_at DESC, a.id DESC
    ON CONFLICT (avatar_id) DO NOTHING`,
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }
}

async function loadAvatarVoiceDefaults() {
  const defaults = new Map<string, AvatarVoiceDefault>();
  try {
    await ensureAvatarVoiceDefaultColumns();
    const { rows } = await pool.query<AvatarVoiceDefault>(
      `SELECT avatar_id,
              CASE WHEN tts_provider = 'elevenlabs' THEN 'elevenlabs' ELSE 'minimax' END AS tts_provider,
              tts_voice_id,
              elevenlabs_voice_id,
              CASE WHEN gender = 'male' THEN 'male' WHEN gender = 'female' THEN 'female' ELSE NULL END AS gender
       FROM heygen_avatar_voice_defaults
       WHERE avatar_id IS NOT NULL AND avatar_id <> ''`
    );

    for (const row of rows) {
      defaults.set(row.avatar_id, row);
    }
  } catch (error) {
    console.warn("[HeyGen catalog] Voice defaults unavailable, continuing without them:", error);
  }

  return defaults;
}

function applyVoiceDefault<T extends Record<string, unknown>>(
  avatar: T,
  voiceDefault?: AvatarVoiceDefault | null
) {
  if (!voiceDefault) {
    return avatar;
  }

  return {
    ...avatar,
    tts_provider: voiceDefault.tts_provider,
    tts_voice_id: voiceDefault.tts_voice_id || "",
    elevenlabs_voice_id: voiceDefault.elevenlabs_voice_id || "",
    gender: voiceDefault.gender || avatar.gender,
  };
}

function appendQuery(path: string, params: Record<string, string | number | boolean | null | undefined>) {
  const [pathname, query = ""] = path.split("?");
  const searchParams = new URLSearchParams(query);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  });
  const nextQuery = searchParams.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

function readCursorValue(value: unknown): string | number | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function readNextPageParam(payload: unknown): HeygenPaginationParam {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : {};
  const pagination = data.pagination && typeof data.pagination === "object" && !Array.isArray(data.pagination)
    ? data.pagination as Record<string, unknown>
    : {};
  const meta = data.meta && typeof data.meta === "object" && !Array.isArray(data.meta)
    ? data.meta as Record<string, unknown>
    : {};

  const candidates: Array<[string, unknown]> = [
    ["page_token", data.next_page_token],
    ["page_token", data.nextPageToken],
    ["cursor", data.next_cursor],
    ["cursor", data.nextCursor],
    ["page_token", pagination.next_page_token],
    ["page_token", pagination.nextPageToken],
    ["cursor", pagination.next_cursor],
    ["cursor", pagination.nextCursor],
    ["page_token", meta.next_page_token],
    ["page_token", meta.nextPageToken],
    ["cursor", meta.next_cursor],
    ["cursor", meta.nextCursor],
  ];

  for (const [key, rawValue] of candidates) {
    const value = readCursorValue(rawValue);
    if (value !== null) {
      return { key, value };
    }
  }

  return null;
}

async function fetchPaginatedHeygenList<T>(
  basePath: string,
  readItems: (payload: unknown) => T[],
  options?: { maxPages?: number }
) {
  const maxPages = options?.maxPages || 20;
  const collected: T[] = [];
  let nextPageParam: HeygenPaginationParam = null;
  let page = 0;

  do {
    const pagePath = nextPageParam
      ? appendQuery(basePath, { [nextPageParam.key]: nextPageParam.value })
      : basePath;
    const payload = await heygenFetch(pagePath);
    const items = readItems(payload);
    collected.push(...items);
    nextPageParam = readNextPageParam(payload);
    page += 1;
  } while (nextPageParam && page < maxPages);

  return collected;
}

function resolveLookId(look: HeygenAvatarLook) {
  return pickString(look.id, look.look_id, look.photo_avatar_id, look.avatar_id);
}

function readTimeMs(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 10_000_000_000 ? value : value * 1000;
    }
    if (typeof value === "string" && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric > 10_000_000_000 ? numeric : numeric * 1000;
      }

      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

export async function GET() {
  const startedAt = Date.now();
  console.info("[HeyGen catalog] Import request started");

  try {
    const voiceDefaults = await loadAvatarVoiceDefaults();
    const groups = await fetchPaginatedHeygenList<HeygenAvatarGroup>(
      "/v2/avatar_group.list",
      (payload) => {
        const data = payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).data
          : null;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          return [];
        }
        const list = (data as Record<string, unknown>).avatar_group_list;
        return Array.isArray(list) ? list as HeygenAvatarGroup[] : [];
      }
    );
    console.info(`[HeyGen catalog] Loaded avatar groups: ${groups.length}`);

    const groupLookResults = await Promise.all(
      groups.map(async (group, index) => {
        try {
          const looks = await fetchPaginatedHeygenList<HeygenAvatarLook>(
            `/v2/avatar_group/${encodeURIComponent(group.id)}/avatars`,
            (payload) => {
              const data = payload && typeof payload === "object" && !Array.isArray(payload)
                ? (payload as Record<string, unknown>).data
                : null;
              if (!data || typeof data !== "object" || Array.isArray(data)) {
                return [];
              }
              const list = (data as Record<string, unknown>).avatar_list;
              return Array.isArray(list) ? list as HeygenAvatarLook[] : [];
            }
          );
          const lookDetails = await Promise.all(
            looks.map(async (look, lookIndex) => {
              const resolvedLookId = resolveLookId(look);
              if (!resolvedLookId) {
                return {
                  look,
                  resolvedLookId: "",
                  isMotion: false,
                  status: "",
                  createdAtMs: 0,
                  index: lookIndex,
                };
              }
              try {
                const detailsPayload = await heygenFetch(`/v2/photo_avatar/${encodeURIComponent(resolvedLookId)}`);
                const details = (detailsPayload?.data || {}) as HeygenPhotoAvatarDetails;
                return {
                  look,
                  resolvedLookId,
                  isMotion: details.is_motion === true,
                  status: String(details.status || "").toLowerCase(),
                  createdAtMs: readTimeMs(
                    details.updated_at,
                    details.update_time,
                    details.created_at,
                    details.create_time,
                    look.updated_at,
                    look.update_time,
                    look.created_at,
                    look.create_time
                  ),
                  index: lookIndex,
                };
              } catch {
                // Not all looks are photo avatars (some are studio/regular),
                // so "Photar not found" is expected — treat as non-motion.
                return {
                  look,
                  resolvedLookId,
                  isMotion: false,
                  status: "",
                  createdAtMs: readTimeMs(
                    look.updated_at,
                    look.update_time,
                    look.created_at,
                    look.create_time
                  ),
                  index: lookIndex,
                };
              }
            })
          );
          const nonMotionLookDetails = lookDetails.filter((item) => item.resolvedLookId && !item.isMotion);
          const latestMotionLookDetail = lookDetails
            .filter((item) => item.resolvedLookId && item.isMotion)
            .sort((a, b) => (b.createdAtMs || b.index) - (a.createdAtMs || a.index))[0];
          const importableLookDetails = nonMotionLookDetails.length
            ? nonMotionLookDetails
            : latestMotionLookDetail
              ? [latestMotionLookDetail]
              : [];

          const avatarPreviewSourceUrl = readImageUrl(group)
            || readImageUrl(importableLookDetails[0]?.look)
            || readImageUrl(looks[0]);

          const stableAvatarPreviewImageUrl = await getStableHeygenPreviewUrl({
            cacheKey: `avatar:${group.id}`,
            sourceUrl: avatarPreviewSourceUrl,
            refresh: true,
          });

          const stableLooks = await Promise.all(
            importableLookDetails.map(async (item, lookIndex) => {
              const look = {
                ...item.look,
                id: item.resolvedLookId,
              };
              const motionStatus = item.isMotion
                ? item.status === "completed"
                  ? "ready"
                  : item.status || "pending"
                : "";

              return {
                look_id: look.id,
                look_name: look.name || `${group.name || group.id} look ${lookIndex + 1}`,
                preview_image_url: await getStableHeygenPreviewUrl({
                  cacheKey: `look:${look.id}`,
                  sourceUrl: readImageUrl(look),
                  refresh: true,
                }),
                ...(item.isMotion
                  ? {
                      motion_look_id: look.id,
                      motion_status: motionStatus,
                      motion_updated_at: new Date().toISOString(),
                    }
                  : {}),
                is_active: true,
                sort_order: lookIndex,
              };
            })
          );

          return {
            ...applyVoiceDefault(
              {
                avatar_id: group.id,
                avatar_name: group.name || group.id,
                folder_name: group.group_type || "HEYGEN",
                preview_image_url: stableAvatarPreviewImageUrl,
                is_active: true,
                sort_order: index,
                gender: importableLookDetails[0]?.look?.gender || looks[0]?.gender || "female",
                looks: stableLooks,
              },
              voiceDefaults.get(group.id)
            ),
          };
        } catch (error) {
          console.error(`HeyGen group import failed for ${group.id}:`, error);
          const fallbackPreview = await getStableHeygenPreviewUrl({
            cacheKey: `avatar:${group.id}`,
            sourceUrl: readImageUrl(group),
            refresh: true,
          });
          return {
            ...applyVoiceDefault(
              {
                avatar_id: group.id,
                avatar_name: group.name || group.id,
                folder_name: group.group_type || "HEYGEN",
                preview_image_url: fallbackPreview,
                is_active: true,
                sort_order: index,
                looks: [],
              },
              voiceDefaults.get(group.id)
            ),
          };
        }
      })
    );

    const catalog = groupLookResults.filter(Boolean);
    const lookCount = catalog.reduce((sum, avatar) => {
      const looks = avatar && "looks" in avatar && Array.isArray(avatar.looks) ? avatar.looks.length : 0;
      return sum + looks;
    }, 0);

    console.info(
      `[HeyGen catalog] Import request completed: avatars=${catalog.length}, looks=${lookCount}, duration_ms=${Date.now() - startedAt}`
    );

    return NextResponse.json(catalog);
  } catch (error) {
    console.error(`[HeyGen catalog] Import request failed after ${Date.now() - startedAt}ms:`, error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
