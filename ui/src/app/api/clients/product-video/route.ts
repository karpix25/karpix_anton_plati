import { NextResponse } from "next/server";
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import pool from "@/lib/db";
import { spawnWithTimeout } from "@/lib/server/spawn";
import { MEDIA_ROOT, MEDIA_URL_PREFIX } from "@/lib/server/media";

const PRODUCT_ASSET_WIDTH = 720;
const PRODUCT_ASSET_HEIGHT = 1280;
const PRODUCT_ASSET_DURATION_SECONDS = 4;
const PRODUCT_ASSET_FPS = 30;
const PRODUCT_ASSET_DIR = "product-assets";

type UploadedProductAsset = {
  id: string;
  url: string;
  name: string;
  source_type: "video" | "image";
  duration_seconds: number;
  created_at: string;
};

// DDL в горячем пути брал ACCESS EXCLUSIVE на clients при КАЖДОЙ загрузке:
// параллельные загрузки и любой тяжёлый запрос по clients валили аплоад по
// statement_timeout (15s) — файл уже лежал на диске, ассет в базу не попадал.
// Читаем каталог (без блокировки) и трогаем схему только если колонки реально нет.
let productAssetColumnsReady: Promise<void> | null = null;
async function ensureProductAssetColumns() {
  if (!productAssetColumnsReady) {
    productAssetColumnsReady = (async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'clients'
           AND column_name IN ('product_media_assets', 'product_video_url')`
      );
      const present = new Set(rows.map((row) => String(row.column_name)));
      if (!present.has("product_media_assets")) {
        await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS product_media_assets JSONB DEFAULT '[]'::jsonb");
      }
      if (!present.has("product_video_url")) {
        await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS product_video_url TEXT");
      }
    })().catch((error) => {
      productAssetColumnsReady = null;
      throw error;
    });
  }
  return productAssetColumnsReady;
}

// Конвертация фото в 4-секундный клип занимает <2с. Потолок 120с нужен только
// чтобы битый файл не оставил вечный ffmpeg (проверено: висел 2м35с на 51% CPU).
const FFMPEG_TIMEOUT_MS = 120_000;

async function runCommand(command: string, args: string[]) {
  const { stderr, code } = await spawnWithTimeout(command, args, FFMPEG_TIMEOUT_MS);
  if (code !== 0) {
    throw new Error(stderr || `${command} failed with code ${code}`);
  }
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

async function convertImageToVerticalVideo(imagePath: string, outputPath: string) {
  const filter = `scale=${PRODUCT_ASSET_WIDTH}:${PRODUCT_ASSET_HEIGHT}:force_original_aspect_ratio=increase,crop=${PRODUCT_ASSET_WIDTH}:${PRODUCT_ASSET_HEIGHT},fps=${PRODUCT_ASSET_FPS},format=yuv420p`;
  await runCommand("ffmpeg", [
    "-y",
    "-loop",
    "1",
    "-i",
    imagePath,
    "-vf",
    filter,
    "-t",
    String(PRODUCT_ASSET_DURATION_SECONDS),
    "-r",
    String(PRODUCT_ASSET_FPS),
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);
}

export async function POST(request: Request) {
  // Файлы, записанные до того как база подтвердила ассет, надо убрать: иначе на
  // диске копятся «сироты» (проверено: 6 параллельных загрузок = 6 мусорных файлов).
  const writtenPaths: string[] = [];
  try {
    const formData = await request.formData();
    const rawClientId = String(formData.get("clientId") ?? "").trim();
    const files = [
      ...formData.getAll("files").filter((item): item is File => item instanceof File),
      ...(!formData.getAll("files").length
        ? formData.getAll("file").filter((item): item is File => item instanceof File)
        : []),
    ];

    if (!rawClientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    // clientId уходил в path.join как есть: "../../../../tmp/x" писал файл ВНЕ
    // /app/media (проверено). Числовой id — единственная форма, которую мы кладём в путь.
    const clientId = Number(rawClientId);
    if (!Number.isSafeInteger(clientId) || clientId <= 0) {
      return NextResponse.json({ error: "clientId must be a positive integer" }, { status: 400 });
    }

    if (!files.length) {
      return NextResponse.json({ error: "At least one media file is required" }, { status: 400 });
    }

    await ensureProductAssetColumns();

    // Раньше несуществующий клиент давал 200 OK: файл на диске, UPDATE 0 строк,
    // ассет молча терялся — тот же класс «тихого успеха», что и мёртвый S3.
    const { rows: clientRows } = await pool.query("SELECT id FROM clients WHERE id = $1", [clientId]);
    if (!clientRows.length) {
      return NextResponse.json({ error: `Клиент ${clientId} не найден` }, { status: 404 });
    }

    const clientDir = `client-${clientId}`;
    const uploadDir = path.join(MEDIA_ROOT, PRODUCT_ASSET_DIR, clientDir);
    const assetUrlFor = (fileName: string) => `${MEDIA_URL_PREFIX}${PRODUCT_ASSET_DIR}/${clientDir}/${fileName}`;
    await mkdir(uploadDir, { recursive: true });

    const uploadedAssets: UploadedProductAsset[] = [];

    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sourcePath = path.join(uploadDir, `${stamp}_${safeName}`);
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      await writeFile(sourcePath, fileBuffer);
      writtenPaths.push(sourcePath);

      if (isImageFile(file)) {
        const outputName = `${stamp}_${safeName.replace(/\.[^.]+$/, "")}.mp4`;
        const outputPath = path.join(uploadDir, outputName);
        writtenPaths.push(outputPath);
        await convertImageToVerticalVideo(sourcePath, outputPath);
        const assetUrl = assetUrlFor(outputName);
        uploadedAssets.push({
          id: outputName,
          url: assetUrl,
          name: file.name,
          source_type: "image",
          duration_seconds: PRODUCT_ASSET_DURATION_SECONDS,
          created_at: new Date().toISOString(),
        });
        // Исходное фото больше не нужно: в пул идёт готовый вертикальный клип.
        await rm(sourcePath, { force: true });
      } else {
        const assetUrl = assetUrlFor(path.basename(sourcePath));
        uploadedAssets.push({
          id: path.basename(sourcePath),
          url: assetUrl,
          name: file.name,
          source_type: "video",
          duration_seconds: 0,
          created_at: new Date().toISOString(),
        });
      }
    }

    // Одним запросом: read-modify-write терял ассеты при параллельных загрузках
    // (последний писавший затирал чужой список). Дублей по url быть не может —
    // имя файла содержит уникальный штамп времени и случайный суффикс.
    const { rows, rowCount } = await pool.query(
      `UPDATE clients SET
         product_media_assets = COALESCE(product_media_assets, '[]'::jsonb) || $1::jsonb,
         product_video_url = COALESCE(
           NULLIF(product_video_url, ''),
           (COALESCE(product_media_assets, '[]'::jsonb) || $1::jsonb) -> 0 ->> 'url',
           ''
         )
       WHERE id = $2
       RETURNING product_media_assets, product_video_url`,
      [JSON.stringify(uploadedAssets), clientId]
    );
    if (!rowCount) {
      return NextResponse.json({ error: `Клиент ${clientId} не найден` }, { status: 404 });
    }

    writtenPaths.length = 0;
    return NextResponse.json({
      assets: uploadedAssets,
      all_assets: rows[0]?.product_media_assets ?? uploadedAssets,
      url: uploadedAssets[0]?.url || "",
    });
  } catch (error) {
    // Раньше тут молчал generic 500 — из-за этого умерший S3 две недели выглядел
    // как "ассет не грузится" без единой подсказки. Причину отдаём наверх.
    console.error("Product video upload error:", error);
    for (const orphan of writtenPaths) {
      await rm(orphan, { force: true }).catch(() => {});
    }
    if (writtenPaths.length) {
      console.warn(`Product video upload rollback: removed ${writtenPaths.length} unregistered file(s)`);
    }
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Не удалось сохранить ассет: ${details}` }, { status: 500 });
  }
}
