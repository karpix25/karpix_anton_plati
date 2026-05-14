import { createHash } from "crypto";
import pool from "@/lib/db";

type CachedPreviewMeta = {
  cacheKey: string;
  sourceUrl: string;
  contentHash: string;
  updatedAt: string;
};

type CachedPreviewRow = CachedPreviewMeta & {
  mimeType: string;
};

type CachedPreviewBlob = {
  mimeType: string;
  contentHash: string;
  updatedAt: string;
  data: Buffer;
};

type HeygenAvatarGroup = {
  id?: string;
  preview_image?: unknown;
  preview_image_url?: unknown;
  [key: string]: unknown;
};

type HeygenAvatarLook = {
  id?: unknown;
  avatar_id?: unknown;
  look_id?: unknown;
  photo_avatar_id?: unknown;
  preview_image?: unknown;
  preview_image_url?: unknown;
  image_url?: unknown;
  [key: string]: unknown;
};

let isCacheTableReady = false;
let cacheDisabledUntil = 0;

const CACHE_ERROR_COOLDOWN_MS = 60_000;
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

function isPreviewCacheTemporarilyDisabled(): boolean {
  return Date.now() < cacheDisabledUntil;
}

function markPreviewCacheFailure(error: unknown): void {
  cacheDisabledUntil = Date.now() + CACHE_ERROR_COOLDOWN_MS;
  console.error("HeyGen preview cache disabled temporarily:", error);
}

function normalizeUrlCandidate(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  return trimmed;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeImageMimeType(contentType: string | null, sourceUrl: string): string {
  const candidate = (contentType || "").toLowerCase().split(";")[0].trim();
  if (candidate.startsWith("image/")) {
    return candidate;
  }

  const lowerUrl = sourceUrl.toLowerCase();
  if (lowerUrl.includes(".png")) return "image/png";
  if (lowerUrl.includes(".webp")) return "image/webp";
  if (lowerUrl.includes(".gif")) return "image/gif";
  if (lowerUrl.includes(".avif")) return "image/avif";
  return "image/jpeg";
}

function toVersionToken(contentHash: string, updatedAt: string): string {
  const shortHash = contentHash.slice(0, 12);
  const timestamp = Number.isFinite(Date.parse(updatedAt)) ? Date.parse(updatedAt).toString(36) : "";
  return timestamp ? `${shortHash}-${timestamp}` : shortHash;
}

export function isHeygenPreviewProxyUrl(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("/api/heygen/preview?");
}

function extractPreviewProxyKey(value: unknown): string {
  if (!isHeygenPreviewProxyUrl(value)) {
    return "";
  }

  try {
    const parsed = new URL(value as string, "http://localhost");
    return parsed.searchParams.get("key")?.trim() || "";
  } catch {
    return "";
  }
}

export function buildHeygenPreviewProxyUrl(cacheKey: string, versionToken?: string): string {
  const params = new URLSearchParams({ key: cacheKey });
  if (versionToken) {
    params.set("v", versionToken);
  }
  return `/api/heygen/preview?${params.toString()}`;
}

async function ensurePreviewCacheTable(): Promise<void> {
  if (isCacheTableReady) {
    return;
  }
  if (isPreviewCacheTemporarilyDisabled()) {
    throw new Error("HeyGen preview cache temporarily disabled");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS heygen_preview_cache (
      cache_key TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      image_data BYTEA NOT NULL,
      content_hash TEXT NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  isCacheTableReady = true;
}

async function readCachedPreviewMeta(cacheKey: string): Promise<CachedPreviewRow | null> {
  if (isPreviewCacheTemporarilyDisabled()) {
    return null;
  }

  await ensurePreviewCacheTable();

  const result = await pool.query<{
    cache_key: string;
    source_url: string;
    mime_type: string;
    content_hash: string;
    updated_at: Date | string;
  }>(
    `
      SELECT cache_key, source_url, mime_type, content_hash, updated_at
      FROM heygen_preview_cache
      WHERE cache_key = $1
      LIMIT 1
    `,
    [cacheKey]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    cacheKey: row.cache_key,
    sourceUrl: row.source_url,
    mimeType: row.mime_type,
    contentHash: row.content_hash,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}

async function savePreviewCache(cacheKey: string, sourceUrl: string, mimeType: string, data: Buffer): Promise<CachedPreviewMeta> {
  if (isPreviewCacheTemporarilyDisabled()) {
    throw new Error("HeyGen preview cache temporarily disabled");
  }

  await ensurePreviewCacheTable();

  const contentHash = createHash("sha1").update(data).digest("hex");
  const result = await pool.query<{
    cache_key: string;
    source_url: string;
    content_hash: string;
    updated_at: Date | string;
  }>(
    `
      INSERT INTO heygen_preview_cache (cache_key, source_url, mime_type, image_data, content_hash, byte_size, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (cache_key)
      DO UPDATE SET
        source_url = EXCLUDED.source_url,
        mime_type = EXCLUDED.mime_type,
        image_data = EXCLUDED.image_data,
        content_hash = EXCLUDED.content_hash,
        byte_size = EXCLUDED.byte_size,
        updated_at = NOW()
      RETURNING cache_key, source_url, content_hash, updated_at
    `,
    [cacheKey, sourceUrl, mimeType, data, contentHash, data.byteLength]
  );

  const row = result.rows[0];
  return {
    cacheKey: row.cache_key,
    sourceUrl: row.source_url,
    contentHash: row.content_hash,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}

async function downloadPreviewBinary(sourceUrl: string): Promise<{ mimeType: string; data: Buffer } | null> {
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    redirect: "follow",
  });

  if (!response.ok) {
    return null;
  }

  const mimeType = normalizeImageMimeType(response.headers.get("content-type"), sourceUrl);
  const arrayBuffer = await response.arrayBuffer();
  const data = Buffer.from(arrayBuffer);
  if (!data.byteLength) {
    return null;
  }

  return { mimeType, data };
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readImageUrl(value: unknown): string {
  if (typeof value === "string") {
    return normalizeUrlCandidate(value);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const record = value as Record<string, unknown>;
  const direct = pickString(...IMAGE_KEYS.map((key) => record[key]));
  if (direct) {
    return normalizeUrlCandidate(direct);
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
    return null;
  }

  const response = await fetch(`https://api.heygen.com${path}`, {
    headers: {
      "X-Api-Key": apiKey,
    },
    cache: "no-store",
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `HeyGen request failed with status ${response.status}`;
    console.warn(`HeyGen preview recovery failed for ${path}: ${message}`);
    return null;
  }

  return data;
}

function resolveLookId(look: HeygenAvatarLook) {
  return pickString(look.id, look.look_id, look.photo_avatar_id, look.avatar_id);
}

async function findHeygenPreviewSourceUrl(cacheKey: string): Promise<string> {
  const [kind, ...idParts] = cacheKey.split(":");
  const targetId = idParts.join(":").trim();
  if (!targetId || (kind !== "avatar" && kind !== "look")) {
    return "";
  }

  const groupsPayload = await heygenFetch("/v2/avatar_group.list");
  const groups: HeygenAvatarGroup[] = groupsPayload?.data?.avatar_group_list || [];

  for (const group of groups) {
    if (kind === "avatar" && group.id === targetId) {
      const groupImage = readImageUrl(group);
      if (groupImage) {
        return groupImage;
      }
    }

    if (!group.id) {
      continue;
    }

    const looksPayload = await heygenFetch(`/v2/avatar_group/${encodeURIComponent(group.id)}/avatars`);
    const looks: HeygenAvatarLook[] = looksPayload?.data?.avatar_list || [];

    if (kind === "avatar" && group.id === targetId) {
      const firstLookImage = readImageUrl(looks[0]);
      if (firstLookImage) {
        return firstLookImage;
      }
    }

    if (kind === "look") {
      const matchedLook = looks.find((look) => resolveLookId(look) === targetId);
      const lookImage = readImageUrl(matchedLook);
      if (lookImage) {
        return lookImage;
      }
    }
  }

  return "";
}

async function recoverHeygenPreviewCache(cacheKey: string): Promise<CachedPreviewBlob | null> {
  const sourceUrl = await findHeygenPreviewSourceUrl(cacheKey);
  if (!sourceUrl || !isHttpUrl(sourceUrl)) {
    return null;
  }

  const downloaded = await downloadPreviewBinary(sourceUrl);
  if (!downloaded) {
    return null;
  }

  const saved = await savePreviewCache(cacheKey, sourceUrl, downloaded.mimeType, downloaded.data);
  return {
    mimeType: downloaded.mimeType,
    contentHash: saved.contentHash,
    updatedAt: saved.updatedAt,
    data: downloaded.data,
  };
}

function stableUrlFromMeta(meta: CachedPreviewMeta): string {
  return buildHeygenPreviewProxyUrl(meta.cacheKey, toVersionToken(meta.contentHash, meta.updatedAt));
}

export async function getHeygenPreviewSourceUrl(value: unknown): Promise<string> {
  const normalized = normalizeUrlCandidate(value);
  if (!normalized) {
    return "";
  }
  if (!isHeygenPreviewProxyUrl(normalized)) {
    return normalized;
  }

  const cacheKey = extractPreviewProxyKey(normalized);
  if (!cacheKey || isPreviewCacheTemporarilyDisabled()) {
    return normalized;
  }

  try {
    const existing = await readCachedPreviewMeta(cacheKey);
    return existing?.sourceUrl || normalized;
  } catch (error) {
    markPreviewCacheFailure(error);
    return normalized;
  }
}

export async function getStableHeygenPreviewUrl(params: {
  cacheKey: string;
  sourceUrl: unknown;
  refresh?: boolean;
}): Promise<string> {
  const cacheKey = typeof params.cacheKey === "string" ? params.cacheKey.trim() : "";
  const sourceUrl = normalizeUrlCandidate(params.sourceUrl);
  const refresh = Boolean(params.refresh);

  if (!cacheKey) {
    return sourceUrl;
  }

  if (isHeygenPreviewProxyUrl(sourceUrl)) {
    const proxyKey = extractPreviewProxyKey(sourceUrl);
    if (!proxyKey || proxyKey === cacheKey) {
      return sourceUrl;
    }
  }

  let existing: CachedPreviewRow | null = null;

  try {
    existing = await readCachedPreviewMeta(cacheKey);
  } catch (error) {
    markPreviewCacheFailure(error);
    return sourceUrl;
  }

  if (
    existing &&
    (!refresh || !sourceUrl || existing.sourceUrl === sourceUrl)
  ) {
    return stableUrlFromMeta(existing);
  }

  if (sourceUrl && isHttpUrl(sourceUrl)) {
    try {
      const downloaded = await downloadPreviewBinary(sourceUrl);
      if (downloaded) {
        const saved = await savePreviewCache(cacheKey, sourceUrl, downloaded.mimeType, downloaded.data);
        return stableUrlFromMeta(saved);
      }
    } catch (error) {
      markPreviewCacheFailure(error);
    }
  }

  if (existing) {
    return stableUrlFromMeta(existing);
  }

  return sourceUrl;
}

export async function getCachedHeygenPreviewBlob(cacheKeyInput: unknown): Promise<CachedPreviewBlob | null> {
  const cacheKey = typeof cacheKeyInput === "string" ? cacheKeyInput.trim() : "";
  if (!cacheKey) {
    return null;
  }
  if (isPreviewCacheTemporarilyDisabled()) {
    return null;
  }

  let result;
  try {
    await ensurePreviewCacheTable();
    result = await pool.query<{
      mime_type: string;
      content_hash: string;
      updated_at: Date | string;
      image_data: Buffer;
    }>(
      `
        SELECT mime_type, content_hash, updated_at, image_data
        FROM heygen_preview_cache
        WHERE cache_key = $1
        LIMIT 1
      `,
      [cacheKey]
    );
  } catch (error) {
    markPreviewCacheFailure(error);
    return null;
  }

  const row = result.rows[0];
  if (!row) {
    try {
      return await recoverHeygenPreviewCache(cacheKey);
    } catch (error) {
      console.error("HeyGen preview cache recovery error:", error);
      return null;
    }
  }

  return {
    mimeType: row.mime_type || "image/jpeg",
    contentHash: row.content_hash || "",
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
    data: Buffer.isBuffer(row.image_data) ? row.image_data : Buffer.from(row.image_data),
  };
}
