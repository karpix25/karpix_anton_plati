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

let isCacheTableReady = false;

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

function stableUrlFromMeta(meta: CachedPreviewMeta): string {
  return buildHeygenPreviewProxyUrl(meta.cacheKey, toVersionToken(meta.contentHash, meta.updatedAt));
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
    return sourceUrl;
  }

  let existing: CachedPreviewRow | null = null;

  try {
    existing = await readCachedPreviewMeta(cacheKey);
  } catch (error) {
    console.error("HeyGen preview cache read error:", error);
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
      console.error("HeyGen preview cache write error:", error);
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

  await ensurePreviewCacheTable();
  const result = await pool.query<{
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

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    mimeType: row.mime_type || "image/jpeg",
    contentHash: row.content_hash || "",
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
    data: Buffer.isBuffer(row.image_data) ? row.image_data : Buffer.from(row.image_data),
  };
}
