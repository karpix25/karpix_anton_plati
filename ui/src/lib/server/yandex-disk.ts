import { readFile } from "fs/promises";

const YANDEX_DISK_API_BASE = "https://cloud-api.yandex.net/v1/disk";
const ROOT_VIDEO_FOLDER = "ВИДЕО";
const ROOT_AUTOMATION_FOLDER = "АВТОМАТ";

type UploadHrefPayload = {
  href?: string;
  method?: string;
  templated?: boolean;
};

type ResourceMetaPayload = {
  path?: string;
  name?: string;
  public_url?: string;
};

function getAccessToken() {
  const token =
    process.env.YANDEX_DISK_OAUTH_TOKEN ||
    process.env.YANDEX_DISK_TOKEN ||
    process.env.YANDEX_TOKEN ||
    "";
  return token.trim();
}

export function isYandexDiskConfigured() {
  return Boolean(getAccessToken());
}

function sanitizeFolderName(value: string) {
  return value
    .replace(/[\\/<>:"|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function sanitizeFileName(value: string) {
  const cleaned = value
    .replace(/[\\/<>:"|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, "_")
    .trim();

  return cleaned.slice(0, 180) || "video.mp4";
}

function toDiskPath(...segments: string[]) {
  const cleaned = segments.map((segment) => sanitizeFolderName(segment)).filter(Boolean);
  return `disk:/${cleaned.join("/")}`;
}

async function yandexRequest(pathname: string, init: RequestInit = {}) {
  const token = getAccessToken();
  if (!token) {
    throw new Error("YANDEX_DISK_OAUTH_TOKEN is not configured");
  }

  const response = await fetch(`${YANDEX_DISK_API_BASE}${pathname}`, {
    ...init,
    headers: {
      Authorization: `OAuth ${token}`,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  return response;
}

async function ensureFolderExists(diskPath: string) {
  const response = await yandexRequest(`/resources?path=${encodeURIComponent(diskPath)}`, {
    method: "PUT",
  });

  if (response.status === 201 || response.status === 409) {
    return;
  }

  const message = await response.text();
  throw new Error(`Yandex Disk folder create failed for ${diskPath}: ${message}`);
}

async function getUploadHref(diskPath: string) {
  const response = await yandexRequest(
    `/resources/upload?path=${encodeURIComponent(diskPath)}&overwrite=true`
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Yandex Disk upload URL failed for ${diskPath}: ${message}`);
  }

  const payload = (await response.json()) as UploadHrefPayload;
  if (!payload.href) {
    throw new Error("Yandex Disk did not return upload href");
  }

  return payload.href;
}

async function publishResource(diskPath: string) {
  const response = await yandexRequest(`/resources/publish?path=${encodeURIComponent(diskPath)}`, {
    method: "PUT",
  });

  if (response.status === 200 || response.status === 201 || response.status === 202 || response.status === 409) {
    return;
  }

  const message = await response.text();
  throw new Error(`Yandex Disk publish failed for ${diskPath}: ${message}`);
}

async function getResourceMeta(diskPath: string) {
  const response = await yandexRequest(
    `/resources?path=${encodeURIComponent(diskPath)}&fields=path,name,public_url`
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Yandex Disk metadata failed for ${diskPath}: ${message}`);
  }

  return (await response.json()) as ResourceMetaPayload;
}

export async function uploadFinalVideoToYandexDisk(params: {
  localFilePath: string;
  avatarFolderName: string;
  fileName: string;
}) {
  const avatarFolder = sanitizeFolderName(params.avatarFolderName) || "Unknown avatar";
  const rootPath = toDiskPath(ROOT_VIDEO_FOLDER);
  const automationPath = toDiskPath(ROOT_VIDEO_FOLDER, ROOT_AUTOMATION_FOLDER);
  const avatarGroupPath = toDiskPath(ROOT_VIDEO_FOLDER, ROOT_AUTOMATION_FOLDER, avatarFolder);
  const avatarFinalPath = toDiskPath(ROOT_VIDEO_FOLDER, ROOT_AUTOMATION_FOLDER, avatarFolder, avatarFolder);
  const filePath = `${avatarFinalPath}/${sanitizeFileName(params.fileName)}`;

  await ensureFolderExists(rootPath);
  await ensureFolderExists(automationPath);
  await ensureFolderExists(avatarGroupPath);
  await ensureFolderExists(avatarFinalPath);

  const uploadHref = await getUploadHref(filePath);
  const fileBuffer = await readFile(params.localFilePath);
  const uploadResponse = await fetch(uploadHref, {
    method: "PUT",
    body: fileBuffer,
    headers: {
      "Content-Type": "video/mp4",
    },
    cache: "no-store",
  });

  if (!uploadResponse.ok) {
    const message = await uploadResponse.text();
    throw new Error(`Yandex Disk file upload failed for ${filePath}: ${message}`);
  }

  await publishResource(filePath);
  const meta = await getResourceMeta(filePath);

  return {
    projectPath: rootPath,
    avatarPath: avatarGroupPath,
    finalPath: avatarFinalPath,
    filePath: meta.path || filePath,
    publicUrl: meta.public_url || null,
  };
}
