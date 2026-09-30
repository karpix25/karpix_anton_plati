import pool from "@/lib/db";

// Движок генерации HeyGen выбирается на уровне клиента.
//
// "legacy" — текущий вызов v2 (/v2/video/generate) без Avatar IV. Это значение
// по умолчанию: у клиента, которому движок не выбирали, ничего не меняется.
// Остальные коды — движки нового v3 (/v3/videos, поле engine.type).
//
// Списка моделей у HeyGen в API нет (все варианты /models отдают 404), НО сам
// HeyGen перечисляет допустимые коды в тексте ошибки валидации. Заведомо битый
// запрос стоит 0 кредитов и видео не создаёт — на этом и держится автообновление
// списка: новая модель у вендора появляется в выпадающем списке сама.
export const LEGACY_ENGINE = "legacy";

export type HeygenEngine = {
  code: string;
  title: string;
  hint: string | null;
  credits_per_minute: number | null;
  price_is_measured: boolean;
  is_active: boolean;
  sort_order: number;
};

let engineTableReady: Promise<void> | null = null;
export async function ensureEngineTable() {
  if (!engineTableReady) {
    engineTableReady = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS heygen_engines (
        code               TEXT PRIMARY KEY,
        title              TEXT NOT NULL,
        hint               TEXT,
        credits_per_minute NUMERIC,
        price_is_measured  BOOLEAN NOT NULL DEFAULT FALSE,
        is_active          BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order         INTEGER NOT NULL DEFAULT 100,
        discovered_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await pool.query(
        `INSERT INTO heygen_engines (code, title, hint, credits_per_minute, sort_order)
         VALUES ($1, 'Как сейчас', 'Текущий вызов HeyGen v2 без Avatar IV. Выбран по умолчанию — ничего не меняется.', NULL, 0)
         ON CONFLICT (code) DO NOTHING`,
        [LEGACY_ENGINE]
      );
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'clients' AND column_name = 'heygen_engine'`
      );
      if (!rows.length) {
        await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS heygen_engine TEXT");
      }
    })().catch((error) => {
      engineTableReady = null;
      throw error;
    });
  }
  return engineTableReady;
}

export async function listEngines(activeOnly = true): Promise<HeygenEngine[]> {
  await ensureEngineTable();
  const { rows } = await pool.query<HeygenEngine>(
    `SELECT code, title, hint, credits_per_minute::float8 AS credits_per_minute,
            price_is_measured, is_active, sort_order
     FROM heygen_engines
     ${activeOnly ? "WHERE is_active" : ""}
     ORDER BY sort_order, code`
  );
  return rows;
}

/** Код движка, который реально можно применить. Незнакомый или пустой → legacy. */
export async function resolveEngine(value: unknown): Promise<string> {
  const code = String(value || "").trim();
  if (!code || code === LEGACY_ENGINE) return LEGACY_ENGINE;
  const { rows } = await pool.query("SELECT 1 FROM heygen_engines WHERE code = $1 AND is_active", [code]);
  return rows.length ? code : LEGACY_ENGINE;
}

export function isV3Engine(code: string) {
  return Boolean(code) && code !== LEGACY_ENGINE;
}

/**
 * Спрашивает у HeyGen актуальный список движков заведомо невалидным запросом.
 * Видео не создаётся, кредиты не тратятся — проверено на боевом ключе.
 * Возвращает коды, либо null, если ответ не распознан (тогда список не трогаем).
 */
export async function discoverEngineCodes(apiKey: string): Promise<string[] | null> {
  const response = await fetch("https://api.heygen.com/v3/videos", {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      type: "avatar",
      avatar_id: "__engine_probe__",
      audio_asset_id: "__engine_probe__",
      engine: { type: "__engine_probe__" },
    }),
  });
  const text = await response.text();
  // "...does not match any of the expected tags: 'avatar_v', 'avatar_iv', 'avatar_iii'"
  const tail = text.split("expected tags:")[1];
  if (!tail) return null;
  const codes = [...tail.matchAll(/'([a-z0-9_]+)'/gi)].map((m) => m[1]);
  return codes.length ? codes : null;
}

/** Дописывает в каталог движки, которых там ещё нет. Существующие не трогает. */
export async function syncEngines(apiKey: string): Promise<{ known: number; added: string[] }> {
  await ensureEngineTable();
  const codes = await discoverEngineCodes(apiKey);
  if (!codes) return { known: 0, added: [] };

  const added: string[] = [];
  for (const code of codes) {
    const { rowCount } = await pool.query(
      `INSERT INTO heygen_engines (code, title, hint, sort_order)
       VALUES ($1, $2, 'Новый движок HeyGen. Цену измерьте пробной генерацией, прежде чем включать клиентам.', 100)
       ON CONFLICT (code) DO NOTHING`,
      [code, code.replace(/^avatar_/, "Avatar ").toUpperCase().replace("AVATAR ", "Avatar ")]
    );
    if (rowCount) added.push(code);
  }
  return { known: codes.length, added };
}
