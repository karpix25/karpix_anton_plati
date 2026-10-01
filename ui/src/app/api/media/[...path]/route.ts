import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import path from "path";
import { resolveMediaPath } from "@/lib/server/media";

// Next 16 отдаёт статику из public/ только по манифесту сборки — файлы,
// записанные в public/ во время работы, получают 404. Поэтому медиа раздаём сами.
const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  const filePath = resolveMediaPath((segments || []).join("/"));
  if (!filePath) return notFound();

  let info;
  try {
    info = await stat(filePath);
  } catch {
    return notFound();
  }
  if (!info.isFile()) return notFound();

  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  const baseHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": new URL(request.url).searchParams.has("fm_asset") ? "private, no-store" : "public, max-age=31536000, immutable",
  };

  // Range обязателен: без него Safari/iOS не проигрывает <video> и не даёт перемотку.
  const range = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get("range") || "").trim());
  if (range) {
    // bytes=-N по RFC 7233 — ПОСЛЕДНИЕ N байт. Раньше отдавали первые N+1:
    // плеер, читающий хвост mp4 (moov в конце), получал начало файла и не играл.
    const suffixLength = range[1] === "" && range[2] !== "" ? Number(range[2]) : null;
    const start = suffixLength !== null
      ? Math.max(0, info.size - suffixLength)
      : (range[1] ? Number(range[1]) : 0);
    const end = suffixLength !== null
      ? info.size - 1
      : (range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1);
    if (suffixLength === 0) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || end >= info.size) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    }
    return new Response(Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
      },
    });
  }

  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
    headers: { ...baseHeaders, "Content-Length": String(info.size) },
  });
}
