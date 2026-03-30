import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const clientId = formData.get("clientId");
    const file = formData.get("file");

    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Video file is required" }, { status: 400 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const uploadDir = path.join(process.cwd(), "public", "uploads", "product-videos", `client-${clientId}`);
    await mkdir(uploadDir, { recursive: true });

    const fileName = `${Date.now()}_${safeName}`;
    const filePath = path.join(uploadDir, fileName);
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, fileBuffer);

    return NextResponse.json({
      url: `/uploads/product-videos/client-${clientId}/${fileName}`,
      name: file.name,
      size: file.size,
    });
  } catch (error) {
    console.error("Product video upload error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
