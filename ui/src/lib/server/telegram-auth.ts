import crypto from "crypto";
import pool from "@/lib/db";

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
  expiresAt: string;
};

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
    expiresAt: expiresAt.toISOString(),
  };
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
