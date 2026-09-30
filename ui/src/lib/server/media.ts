import path from "path";

// Постоянное хранилище медиа проекта (docker volume media_data -> /app/media).
// Раньше ассеты жили во внешнем S3 (Beget): бакет удалили вместе с ключом —
// загрузка отвалилась, а 62 клиента получили мёртвые ссылки. Своё хранилище
// не зависит от вендора и не может «исчезнуть» вместе с чужим аккаунтом.
export const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || "/app/media");

export const MEDIA_URL_PREFIX = "/api/media/";

/** Абсолютный путь внутри MEDIA_ROOT или null, если ссылка пытается выйти наружу. */
export function resolveMediaPath(relative: string): string | null {
  const cleaned = String(relative || "").replace(/^\/+/, "");
  if (!cleaned) return null;
  const resolved = path.resolve(MEDIA_ROOT, cleaned);
  if (resolved !== MEDIA_ROOT && !resolved.startsWith(MEDIA_ROOT + path.sep)) return null;
  return resolved;
}

/** Путь на диске для URL вида /api/media/..., иначе null. */
export function mediaPathFromUrl(url: string): string | null {
  const value = String(url || "").trim();
  if (!value.startsWith(MEDIA_URL_PREFIX)) return null;
  return resolveMediaPath(value.slice(MEDIA_URL_PREFIX.length));
}
