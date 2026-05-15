import { NextResponse } from "next/server";
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
  image_url?: string | null;
  preview_image?: string | null;
  preview_image_url?: string | null;
  gender?: string;
};

type HeygenPhotoAvatarDetails = {
  id?: string;
  is_motion?: boolean;
  status?: string;
};

type HeygenPaginationParam = { key: string; value: string | number } | null;

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

export async function GET() {
  const startedAt = Date.now();
  console.info("[HeyGen catalog] Import request started");

  try {
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
            looks.map(async (look) => {
              const resolvedLookId = resolveLookId(look);
              if (!resolvedLookId) {
                return {
                  look,
                  resolvedLookId: "",
                  isMotion: false,
                };
              }
              try {
                const detailsPayload = await heygenFetch(`/v2/photo_avatar/${encodeURIComponent(resolvedLookId)}`);
                const details = (detailsPayload?.data || {}) as HeygenPhotoAvatarDetails;
                return {
                  look,
                  resolvedLookId,
                  isMotion: details.is_motion === true,
                };
              } catch {
                // Not all looks are photo avatars (some are studio/regular),
                // so "Photar not found" is expected — treat as non-motion.
                return {
                  look,
                  resolvedLookId,
                  isMotion: false,
                };
              }
            })
          );
          const nonMotionLooks = lookDetails
            .filter((item) => item.resolvedLookId && !item.isMotion)
            .map((item) => ({
              ...item.look,
              id: item.resolvedLookId,
            }));

          if (looks.length > 0 && nonMotionLooks.length === 0) {
            return null;
          }

          const avatarPreviewSourceUrl = readImageUrl(group)
            || readImageUrl(nonMotionLooks[0])
            || readImageUrl(looks[0]);

          const stableAvatarPreviewImageUrl = await getStableHeygenPreviewUrl({
            cacheKey: `avatar:${group.id}`,
            sourceUrl: avatarPreviewSourceUrl,
            refresh: true,
          });

          const stableLooks = await Promise.all(
            nonMotionLooks.map(async (look, lookIndex) => ({
              look_id: look.id,
              look_name: look.name || `${group.name || group.id} look ${lookIndex + 1}`,
              preview_image_url: await getStableHeygenPreviewUrl({
                cacheKey: `look:${look.id}`,
                sourceUrl: readImageUrl(look),
                refresh: true,
              }),
              is_active: true,
              sort_order: lookIndex,
            }))
          );

          return {
            avatar_id: group.id,
            avatar_name: group.name || group.id,
            folder_name: group.group_type || "HEYGEN",
            preview_image_url: stableAvatarPreviewImageUrl,
            is_active: true,
            sort_order: index,
            gender: nonMotionLooks[0]?.gender || looks[0]?.gender || "female",
            looks: stableLooks,
          };
        } catch (error) {
          console.error(`HeyGen group import failed for ${group.id}:`, error);
          const fallbackPreview = await getStableHeygenPreviewUrl({
            cacheKey: `avatar:${group.id}`,
            sourceUrl: readImageUrl(group),
            refresh: true,
          });
          return {
            avatar_id: group.id,
            avatar_name: group.name || group.id,
            folder_name: group.group_type || "HEYGEN",
            preview_image_url: fallbackPreview,
            is_active: true,
            sort_order: index,
            looks: [],
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
