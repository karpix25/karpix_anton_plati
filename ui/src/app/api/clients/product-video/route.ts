import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const PRODUCT_ASSET_WIDTH = 720;
const PRODUCT_ASSET_HEIGHT = 1280;
const PRODUCT_ASSET_DURATION_SECONDS = 4;
const PRODUCT_ASSET_FPS = 30;

type UploadedProductAsset = {
  id: string;
  url: string;
  name: string;
  source_type: "video" | "image";
  duration_seconds: number;
  created_at: string;
};

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

    const uploadDir = path.join(process.cwd(), "public", "uploads", "product-assets", `client-${clientId}`);
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
        uploadedAssets.push({
          id: outputName,
          url: `/uploads/product-assets/client-${clientId}/${outputName}`,
          name: file.name,
          source_type: "image",
          duration_seconds: PRODUCT_ASSET_DURATION_SECONDS,
          created_at: new Date().toISOString(),
        });
      } else {
        uploadedAssets.push({
          id: path.basename(sourcePath),
          url: `/uploads/product-assets/client-${clientId}/${path.basename(sourcePath)}`,
          name: file.name,
          source_type: "video",
          duration_seconds: 0,
          created_at: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      assets: uploadedAssets,
      url: uploadedAssets[0]?.url || "",
    });
  } catch (error) {
    console.error("Product video upload error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
