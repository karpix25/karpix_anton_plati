import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile, rm } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import crypto from "crypto";
import pool from "@/lib/db";

const PRODUCT_ASSET_WIDTH = 720;
const PRODUCT_ASSET_HEIGHT = 1280;
const PRODUCT_ASSET_DURATION_SECONDS = 4;
const PRODUCT_ASSET_FPS = 30;

type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  forcePathStyle: boolean;
};

function getS3Config(): S3Config {
  return {
    endpoint: process.env.S3_ENDPOINT || "",
    region: process.env.S3_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET || process.env.S3_BUCKET_NAME || "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || "",
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() === "true",
  };
}

type UploadedProductAsset = {
  id: string;
  url: string;
  name: string;
  source_type: "video" | "image";
  duration_seconds: number;
  created_at: string;
};

function normalizeProductMediaAssets(value: unknown): UploadedProductAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const asset = item as Record<string, unknown>;
      const url = typeof asset.url === "string" ? asset.url.trim() : "";
      if (!url) return null;
      return {
        id: typeof asset.id === "string" ? asset.id.trim() : url,
        url,
        name: typeof asset.name === "string" ? asset.name.trim() : "Product Asset",
        source_type: asset.source_type === "image" ? "image" : "video",
        duration_seconds: Number(asset.duration_seconds || 0) || 0,
        created_at: typeof asset.created_at === "string" ? asset.created_at : new Date().toISOString(),
      };
    })
    .filter(Boolean) as UploadedProductAsset[];
}

async function ensureProductAssetColumns() {
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS product_media_assets JSONB DEFAULT '[]'::jsonb");
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS product_video_url TEXT");
}

function isS3Configured(config: S3Config) {
  return Boolean(config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey);
}

function buildS3ObjectUrl(config: S3Config, key: string) {
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
  }

  const endpoint = new URL(config.endpoint);
  const base = config.forcePathStyle
    ? `${endpoint.origin}/${config.bucket}`
    : `${endpoint.protocol}//${config.bucket}.${endpoint.host}`;
  return `${base}/${key}`;
}

function sha256Hex(data: Buffer | string) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function getAmzDates(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

async function putObjectToS3(config: S3Config, key: string, body: Buffer, contentType: string) {
  if (!isS3Configured(config)) {
    throw new Error("S3 is not configured.");
  }
  const endpoint = new URL(config.endpoint);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const host = config.forcePathStyle ? endpoint.host : `${config.bucket}.${endpoint.host}`;
  const canonicalUri = config.forcePathStyle ? `/${config.bucket}/${encodedKey}` : `/${encodedKey}`;
  const payloadHash = sha256Hex(body);
  const requestBody = new Uint8Array(body);
  const { amzDate, dateStamp } = getAmzDates();
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const uploadUrl = config.forcePathStyle
    ? `${endpoint.origin}${canonicalUri}`
    : `${endpoint.protocol}//${host}${canonicalUri}`;
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    },
    body: requestBody,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`S3 upload failed: ${response.status} ${message}`);
  }

  return buildS3ObjectUrl(config, encodedKey);
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `${command} failed with code ${code}`));
      }
    });

    child.on("error", reject);
  });
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
  try {
    const formData = await request.formData();
    const clientId = formData.get("clientId");
    const files = [
      ...formData.getAll("files").filter((item): item is File => item instanceof File),
      ...(!formData.getAll("files").length
        ? formData.getAll("file").filter((item): item is File => item instanceof File)
        : []),
    ];

    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    if (!files.length) {
      return NextResponse.json({ error: "At least one media file is required" }, { status: 400 });
    }

    const s3Config = getS3Config();
    const useS3 = isS3Configured(s3Config);
    if (!useS3) {
      console.warn("S3 is not configured. Falling back to local storage for product assets.");
    }
    const uploadDir = useS3
      ? path.join("/tmp", "product-assets", `client-${clientId}`)
      : path.join(process.cwd(), "public", "uploads", "product-assets", `client-${clientId}`);
    await mkdir(uploadDir, { recursive: true });

    const uploadedAssets: UploadedProductAsset[] = [];

    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sourcePath = path.join(uploadDir, `${stamp}_${safeName}`);
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      await writeFile(sourcePath, fileBuffer);

      if (isImageFile(file)) {
        const outputName = `${stamp}_${safeName.replace(/\.[^.]+$/, "")}.mp4`;
        const outputPath = path.join(uploadDir, outputName);
        await convertImageToVerticalVideo(sourcePath, outputPath);
        let assetUrl = `/uploads/product-assets/client-${clientId}/${outputName}`;
        if (useS3) {
          const outputBuffer = await readFile(outputPath);
          assetUrl = await putObjectToS3(
            s3Config,
            `product-assets/client-${clientId}/${outputName}`,
            outputBuffer,
            "video/mp4"
          );
        }
        uploadedAssets.push({
          id: outputName,
          url: assetUrl,
          name: file.name,
          source_type: "image",
          duration_seconds: PRODUCT_ASSET_DURATION_SECONDS,
          created_at: new Date().toISOString(),
        });
        if (useS3) {
          await rm(sourcePath, { force: true });
          await rm(outputPath, { force: true });
        }
      } else {
        let assetUrl = `/uploads/product-assets/client-${clientId}/${path.basename(sourcePath)}`;
        if (useS3) {
          assetUrl = await putObjectToS3(
            s3Config,
            `product-assets/client-${clientId}/${path.basename(sourcePath)}`,
            fileBuffer,
            file.type || "video/mp4"
          );
        }
        uploadedAssets.push({
          id: path.basename(sourcePath),
          url: assetUrl,
          name: file.name,
          source_type: "video",
          duration_seconds: 0,
          created_at: new Date().toISOString(),
        });
        if (useS3) {
          await rm(sourcePath, { force: true });
        }
      }
    }

    await ensureProductAssetColumns();
    const { rows } = await pool.query(
      "SELECT product_media_assets, product_video_url FROM clients WHERE id = $1",
      [Number(clientId)]
    );
    const existingAssets = normalizeProductMediaAssets(rows[0]?.product_media_assets);
    const mergedAssets = [
      ...existingAssets,
      ...uploadedAssets.filter((asset) => !existingAssets.some((existing) => existing.url === asset.url)),
    ];
    const nextPrimaryUrl = rows[0]?.product_video_url || mergedAssets[0]?.url || "";
    await pool.query(
      "UPDATE clients SET product_media_assets = $1::jsonb, product_video_url = $2 WHERE id = $3",
      [JSON.stringify(mergedAssets), nextPrimaryUrl, Number(clientId)]
    );

    return NextResponse.json({
      assets: uploadedAssets,
      all_assets: mergedAssets,
      url: uploadedAssets[0]?.url || "",
    });
  } catch (error) {
    console.error("Product video upload error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
