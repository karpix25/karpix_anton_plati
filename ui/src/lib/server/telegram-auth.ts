import crypto from "crypto";
import pool from "@/lib/db";
import { rateLimit, getClientIp } from "./rate-limit";
import { NextResponse } from "next/server";

export const TELEGRAM_SESSION_COOKIE = "tg_session";

const AUTH_REQUEST_TTL_MINUTES = 20;
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

type SessionRow = {
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  expires_at: string | Date;
  revoked_at: string | Date | null;
  access_status: string | null;
  is_admin: boolean | null;
};

type CallbackRow = {
  id: number;
  status: string;
  redirect_path: string | null;
  expires_at: string | Date | null;
  session_expires_at: string | Date | null;
  row_session_expires_at: string | Date | null;
  row_session_revoked_at: string | Date | null;
};

export type TelegramSessionUser = {
  telegramUserId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  expiresAt: string;
};

const FM_PUBLIC_HOST = "n8n-ai-avatars.ap2dy7.easypanel.host";
type FMIdentity = { host: string; method: string; uri: string; exp: number; roleId: string; telegramId: string; username: string };

export function getFMIdentity(request: Request): FMIdentity | null {
  if (!request.headers.has("x-fm-identity")) return null;
  try {
    // Fetch Headers combines duplicates with a comma; the strict alphabet rejects them.
    const token = request.headers.get("x-fm-identity") || "";
    const secret = process.env.FM_AUTH_SECRET || "";
    if (Buffer.byteLength(secret) < 32 || token.length > 16384 || request.headers.get("host") !== FM_PUBLIC_HOST) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null;
    const expected = crypto.createHmac("sha256", secret).update(`v1.${parts[1]}`).digest();
    const signature = Buffer.from(parts[2], "base64url");
    if (signature.toString("base64url") !== parts[2] || signature.length !== expected.length || !crypto.timingSafeEqual(expected, signature)) return null;
    const decoded = Buffer.from(parts[1], "base64url");
    if (decoded.toString("base64url") !== parts[1]) return null;
    const claim = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
    const now = Date.now() / 1000;
    const rawURI = request.url.match(/^https?:\/\/[^/]+(\/[^#]*)$/)?.[1];
    if (!claim || Array.isArray(claim) || !Number.isSafeInteger(claim.exp) || claim.exp - now < 0 || claim.exp - now > 35 ||
        claim.host !== FM_PUBLIC_HOST || claim.method !== request.method || claim.uri !== rawURI) return null;
    for (const field of ["roleId", "telegramId"]) {
      if (typeof claim[field] !== "string" || !/^[1-9][0-9]{0,18}$/.test(claim[field]) || BigInt(claim[field]) > BigInt("9223372036854775807")) return null;
    }
    if (!Number.isSafeInteger(Number(claim.telegramId)) || typeof claim.username !== "string" || !/^[a-z0-9_]{5,32}$/.test(claim.username)) return null;
    return claim;
  } catch {
    return null;
  }
}

export function isAutomationRequest(request: Request) {
  const token = request.headers.get("x-automation-token") || "";
  const secret = (process.env.AUTOMATION_INTERNAL_TOKEN || "").trim();
  const path = new URL(request.url).pathname;
  const scope = `${request.method} ${path}`;
  if (!["POST /api/tts", "POST /api/heygen/avatar-video", "GET /api/heygen/avatar-video", "POST /api/scenarios/assemble"].includes(scope) ||
      !secret || !token || token.includes(",") || Buffer.byteLength(token) !== Buffer.byteLength(secret)) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

function parseTelegramIds(rawValue: string) {
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

const SUPER_ADMIN_TELEGRAM_IDS = new Set<number>([
  ...parseTelegramIds(String(process.env.TELEGRAM_SUPER_ADMIN_IDS || "")),
  ...parseTelegramIds(String(process.env.TELEGRAM_SUPER_ADMIN_ID || "")),
]);

function randomId(length: number) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return out;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf-8").digest("hex");
}

function parseDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function sanitizeReturnPath(candidate: unknown) {
  const value = typeof candidate === "string" ? candidate.trim() : "";
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function resolveBotUsername() {
  const raw = String(process.env.TELEGRAM_BOT_USERNAME || "").trim();
  const normalized = raw.startsWith("@") ? raw.slice(1) : raw;
  return normalized.replace(/\s+/g, "");
}

export function buildTelegramBotUrl(payload: string) {
  const botUsername = resolveBotUsername();
  if (!botUsername) {
    throw new Error("TELEGRAM_BOT_USERNAME is not configured");
  }
  return `https://t.me/${botUsername}?start=${payload}`;
}

export function extractTelegramSessionToken(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const sessionToken = cookieHeader
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(`${TELEGRAM_SESSION_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=")
    .trim();

  return sessionToken ? decodeURIComponent(sessionToken) : null;
}

export function isTelegramSuperAdmin(telegramUserId: number) {
  return SUPER_ADMIN_TELEGRAM_IDS.has(Number(telegramUserId));
}

export async function ensureTelegramAuthTables() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS telegram_user_access (
      id SERIAL PRIMARY KEY,
      telegram_user_id BIGINT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      approved_at TIMESTAMP,
      approved_by BIGINT,
      rejected_at TIMESTAMP,
      rejected_by BIGINT,
      notes TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS telegram_web_auth_requests (
      id SERIAL PRIMARY KEY,
      request_id TEXT UNIQUE NOT NULL,
      nonce TEXT NOT NULL,
      telegram_user_id BIGINT,
      status TEXT NOT NULL DEFAULT 'pending',
      redirect_path TEXT NOT NULL DEFAULT '/',
      session_token_hash TEXT,
      session_expires_at TIMESTAMP,
      approved_at TIMESTAMP,
      used_at TIMESTAMP,
      expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '20 minutes'),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    "CREATE INDEX IF NOT EXISTS idx_telegram_web_auth_requests_status ON telegram_web_auth_requests(status)",
    "CREATE INDEX IF NOT EXISTS idx_telegram_web_auth_requests_expires ON telegram_web_auth_requests(expires_at)",
    `CREATE TABLE IF NOT EXISTS telegram_web_sessions (
      id SERIAL PRIMARY KEY,
      session_token_hash TEXT UNIQUE NOT NULL,
      telegram_user_id BIGINT NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    "CREATE INDEX IF NOT EXISTS idx_telegram_web_sessions_user ON telegram_web_sessions(telegram_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_telegram_web_sessions_expires ON telegram_web_sessions(expires_at)",
    "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS redirect_path TEXT NOT NULL DEFAULT '/'",
    "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS session_token_hash TEXT",
    "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMP",
    "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP",
    "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS used_at TIMESTAMP",
    "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '20 minutes')",
    "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE telegram_web_sessions ADD COLUMN IF NOT EXISTS username TEXT",
    "ALTER TABLE telegram_web_sessions ADD COLUMN IF NOT EXISTS first_name TEXT",
    "ALTER TABLE telegram_web_sessions ADD COLUMN IF NOT EXISTS last_name TEXT",
    "ALTER TABLE telegram_web_sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP",
    "ALTER TABLE telegram_web_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }
}

export async function createTelegramAuthRequest(redirectPathInput: unknown) {
  await ensureTelegramAuthTables();
  const redirectPath = sanitizeReturnPath(redirectPathInput);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const requestId = randomId(16);
    const nonce = randomId(12);
    const payload = `wa_${requestId}_${nonce}`;

    const { rows } = await pool.query<{ request_id: string; expires_at: string | Date }>(
      `INSERT INTO telegram_web_auth_requests (
         request_id,
         nonce,
         redirect_path,
         status,
         expires_at,
         updated_at
       )
       VALUES (
         $1,
         $2,
         $3,
         'pending',
         CURRENT_TIMESTAMP + ($4 * INTERVAL '1 minute'),
         CURRENT_TIMESTAMP
       )
       ON CONFLICT (request_id) DO NOTHING
       RETURNING request_id, expires_at`,
      [requestId, nonce, redirectPath, AUTH_REQUEST_TTL_MINUTES]
    );

    if (rows.length > 0) {
      return {
        requestId,
        payload,
        expiresAt: parseDate(rows[0].expires_at)?.toISOString() || new Date().toISOString(),
      };
    }
  }

  throw new Error("Failed to create Telegram auth request");
}

export async function consumeTelegramAuthCallback(requestId: string, rawToken: string) {
  await ensureTelegramAuthTables();
  const tokenHash = hashToken(rawToken);

  const { rows } = await pool.query<CallbackRow>(
    `SELECT
       r.id,
       r.status,
       r.redirect_path,
       r.expires_at,
       r.session_expires_at,
       s.expires_at AS row_session_expires_at,
       s.revoked_at AS row_session_revoked_at
     FROM telegram_web_auth_requests r
     LEFT JOIN telegram_web_sessions s ON s.session_token_hash = r.session_token_hash
     WHERE r.request_id = $1
       AND r.session_token_hash = $2
     LIMIT 1`,
    [requestId, tokenHash]
  );

  const row = rows[0];
  if (!row) {
    return { ok: false as const, error: "invalid_token" };
  }

  const now = Date.now();
  const requestExpiresAt = parseDate(row.expires_at);
  if (!requestExpiresAt || requestExpiresAt.getTime() <= now) {
    return { ok: false as const, error: "request_expired" };
  }

  if (!["approved", "used"].includes(String(row.status || "").toLowerCase())) {
    return { ok: false as const, error: "request_not_approved" };
  }

  const sessionExpiresAt = parseDate(row.row_session_expires_at || row.session_expires_at);
  const sessionRevokedAt = parseDate(row.row_session_revoked_at);
  if (!sessionExpiresAt || sessionExpiresAt.getTime() <= now || sessionRevokedAt) {
    return { ok: false as const, error: "session_expired" };
  }

  await pool.query(
    `UPDATE telegram_web_auth_requests
     SET status = 'used',
         used_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [row.id]
  );

  return {
    ok: true as const,
    redirectPath: sanitizeReturnPath(row.redirect_path),
    sessionExpiresAt,
  };
}

export async function getTelegramSessionUser(rawToken: string): Promise<TelegramSessionUser | null> {
  await ensureTelegramAuthTables();
  const tokenHash = hashToken(rawToken);

  const { rows } = await pool.query<SessionRow>(
    `SELECT
       s.telegram_user_id,
       s.username,
       s.first_name,
       s.last_name,
       s.expires_at,
       s.revoked_at,
       a.status AS access_status,
       COALESCE(a.is_admin, FALSE) AS is_admin
     FROM telegram_web_sessions s
     LEFT JOIN telegram_user_access a
       ON a.telegram_user_id = s.telegram_user_id
      AND a.status = 'approved'
     WHERE s.session_token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const expiresAt = parseDate(row.expires_at);
  const revokedAt = parseDate(row.revoked_at);
  const approved = String(row.access_status || "").toLowerCase() === "approved";
  if (!expiresAt || expiresAt.getTime() <= Date.now() || Boolean(revokedAt) || !approved) {
    return null;
  }

  await pool.query(
    `UPDATE telegram_web_sessions
     SET last_seen_at = CURRENT_TIMESTAMP
     WHERE session_token_hash = $1`,
    [tokenHash]
  );

  return {
    telegramUserId: Number(row.telegram_user_id),
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    isAdmin: Boolean(row.is_admin),
    isSuperAdmin: isTelegramSuperAdmin(Number(row.telegram_user_id)),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getTelegramSessionUserFromRequest(request: Request) {
  if (request.headers.has("x-fm-identity")) {
    const ident = getFMIdentity(request);
    if (!ident) return null; // A present assertion never falls back to a native cookie.
    const { rows } = await pool.query<{ is_admin: boolean }>(
      "SELECT is_admin FROM telegram_user_access WHERE telegram_user_id = $1 AND status = 'approved'",
      [ident.telegramId]
    );
    return {
      telegramUserId: Number(ident.telegramId), username: ident.username,
      firstName: null, lastName: null, isAdmin: rows[0]?.is_admin === true,
      isSuperAdmin: isTelegramSuperAdmin(Number(ident.telegramId)),
      expiresAt: new Date(ident.exp * 1000).toISOString(),
    } satisfies TelegramSessionUser;
  }
  const sessionToken = extractTelegramSessionToken(request);
  if (!sessionToken) {
    return null;
  }
  return getTelegramSessionUser(sessionToken);
}

export async function revokeTelegramSession(rawToken: string) {
  await ensureTelegramAuthTables();
  const tokenHash = hashToken(rawToken);
  await pool.query(
    `UPDATE telegram_web_sessions
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE session_token_hash = $1`,
    [tokenHash]
  );
}

/**
 * Unified API security wrapper.
 * Checks rate limits and authentication.
 */
export async function validateApiRequest(request: Request, config: { limit?: number; windowMs?: number } = {}) {
  const ip = getClientIp(request);
  const user = await getTelegramSessionUserFromRequest(request);
  
  // Rate limit by User ID if logged in, otherwise by IP
  const rateLimitKey = user ? `user:${user.telegramUserId}` : `ip:${ip}`;
  const rl = rateLimit(rateLimitKey, config.limit ?? 100, config.windowMs ?? 60000);

  if (!rl.success) {
    return {
      user: null,
      errorResponse: NextResponse.json(
        { error: "Too many requests", retryAfter: Math.ceil((rl.reset - Date.now()) / 1000) },
        { 
          status: 429,
          headers: { "Retry-After": Math.ceil((rl.reset - Date.now()) / 1000).toString() }
        }
      )
    };
  }

  if (!user) {
    return {
      user: null,
      errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    };
  }

  return { user, errorResponse: null };
}
