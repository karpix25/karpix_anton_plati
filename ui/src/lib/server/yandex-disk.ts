import { readFile } from "fs/promises";

const YANDEX_DISK_API_BASE = "https://cloud-api.yandex.net/v1/disk";
const ROOT_VIDEO_FOLDER = "ВИДЕО";
const ROOT_AUTOMATION_FOLDER = "АВТОМАТ";
const ROOT_AVATAR_AUDIO_FOLDER = "Аудио для аватаров";
const PROTECTED_AUTOMATION_ROOT_PATH = `disk:/${ROOT_VIDEO_FOLDER}/${ROOT_AUTOMATION_FOLDER}`;

type UploadHrefPayload = {
  href?: string;
  method?: string;
  templated?: boolean;
};

type ResourceMetaPayload = {
  path?: string;
  name?: string;
  public_url?: string;
  _embedded?: {
    items?: Array<{
      name?: string;
      path?: string;
      type?: string;
      media_type?: string;
      file?: string;
    }>;
  };
};

export type YandexDiskFolderNode = {
  name: string;
  path: string;
  children: YandexDiskFolderNode[];
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

function normalizeDiskPathForCompare(value: string) {
  const normalized = String(value || "")
    .trim()
    .replace(/^disk:\/*/i, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  if (!normalized) return "disk:/";
  const parts = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.toLocaleLowerCase("ru-RU"));
  return `disk:/${parts.join("/")}`;
}

function isProtectedAutomationRootPath(diskPath: string) {
  return normalizeDiskPathForCompare(diskPath) === normalizeDiskPathForCompare(PROTECTED_AUTOMATION_ROOT_PATH);
}

function assertDeletionAllowed(method: string, pathname: string) {
  if (method !== "DELETE") return;
  const parsed = new URL(pathname, "https://yandex-disk-local");
  const resourcePath = parsed.searchParams.get("path");
  if (resourcePath && isProtectedAutomationRootPath(resourcePath)) {
    throw new Error(`Protected folder cannot be deleted: ${PROTECTED_AUTOMATION_ROOT_PATH}`);
  }
}

function normalizeCustomFolderPath(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const withoutPrefix = raw.replace(/^disk:\/*/i, "").replace(/^\/+/, "");
  const cleaned = withoutPrefix
    .split("/")
    .map((segment) => sanitizeFolderName(segment))
    .filter(Boolean);

  return cleaned.length ? `disk:/${cleaned.join("/")}` : null;
}

function getDiskFolderAncestors(diskPath: string) {
  const withoutPrefix = diskPath.replace(/^disk:\/*/i, "");
  const segments = withoutPrefix.split("/").filter(Boolean);
  return segments.map((_, index) => `disk:/${segments.slice(0, index + 1).join("/")}`);
}

async function yandexRequest(pathname: string, init: RequestInit = {}) {
  const token = getAccessToken();
  if (!token) {
    throw new Error("YANDEX_DISK_OAUTH_TOKEN is not configured");
  }
  const method = String(init.method || "GET").toUpperCase();
  assertDeletionAllowed(method, pathname);

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

async function ensureFolderTreeExists(diskPath: string) {
  for (const folderPath of getDiskFolderAncestors(diskPath)) {
    await ensureFolderExists(folderPath);
  }
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

async function getDownloadHref(diskPath: string) {
  const response = await yandexRequest(
    `/resources/download?path=${encodeURIComponent(diskPath)}`
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Yandex Disk download URL failed for ${diskPath}: ${message}`);
  }

  const payload = (await response.json()) as UploadHrefPayload;
  if (!payload.href) {
    throw new Error("Yandex Disk did not return download href");
  }

  return payload.href;
}

async function listFolderChildren(diskPath: string) {
  const items: Array<{ name: string; path: string; type?: string }> = [];
  const limit = 200;
  let offset = 0;

  while (true) {
    const response = await yandexRequest(
      `/resources?path=${encodeURIComponent(diskPath)}&limit=${limit}&offset=${offset}&fields=_embedded.items.name,_embedded.items.path,_embedded.items.type`
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Yandex Disk folder read failed for ${diskPath}: ${message}`);
    }

    const payload = (await response.json()) as ResourceMetaPayload;
    const pageItems = payload._embedded?.items || [];
    items.push(
      ...pageItems
        .filter((item) => item.type === "dir" && item.name && item.path)
        .map((item) => ({ name: item.name!, path: item.path!, type: item.type }))
    );

    if (pageItems.length < limit) break;
    offset += limit;
  }

  return items.sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

async function readFolderTree(diskPath: string, depth: number, maxDepth: number): Promise<YandexDiskFolderNode[]> {
  if (depth >= maxDepth) return [];

  const folders = await listFolderChildren(diskPath);
  return Promise.all(
    folders.map(async (folder) => ({
      name: folder.name,
      path: folder.path,
      children: await readFolderTree(folder.path, depth + 1, maxDepth),
    }))
  );
}

export async function getAutomationVideoFolderTree(maxDepth = 8): Promise<YandexDiskFolderNode> {
  const rootPath = toDiskPath(ROOT_VIDEO_FOLDER, ROOT_AUTOMATION_FOLDER);
  const meta = await getResourceMeta(rootPath);
  return {
    name: meta.name || ROOT_AUTOMATION_FOLDER,
    path: meta.path || rootPath,
    children: await readFolderTree(meta.path || rootPath, 0, maxDepth),
  };
}

async function publishResource(diskPath: string) {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) {
        // Wait 1s, then 2s
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }

      const response = await yandexRequest(`/resources/publish?path=${encodeURIComponent(diskPath)}`, {
        method: "PUT",
      });

      if (response.status === 200 || response.status === 201 || response.status === 202 || response.status === 409) {
        return;
      }

      const message = await response.text();
      lastError = new Error(`Yandex Disk publish failed for ${diskPath} (attempt ${attempt}): ${message}`);
      
      // If it's a 5xx error, retry. If 4xx (except 409 handled above), maybe don't?
      // But Yandex sometimes returns 500 when it's just busy.
      if (response.status < 500 && response.status !== 429) {
        throw lastError;
      }
    } catch (error) {
      lastError = error as Error;
      if (attempt === 3) throw lastError;
    }
  }

  if (lastError) throw lastError;
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

function isAudioFileName(name: string) {
  return /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name);
}

export async function getRandomBackgroundAudioTrack(tag: "disturbing" | "inspiring" | "neutral" | "relax") {
  const folderPath = toDiskPath(ROOT_AVATAR_AUDIO_FOLDER, tag);
  const response = await yandexRequest(
    `/resources?path=${encodeURIComponent(folderPath)}&limit=200&fields=_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.media_type`
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Yandex Disk audio folder read failed for ${folderPath}: ${message}`);
  }

  const payload = (await response.json()) as ResourceMetaPayload;
  const files = (payload._embedded?.items || []).filter(
    (item) => item.type === "file" && !!item.path && !!item.name && (item.media_type === "audio" || isAudioFileName(item.name || ""))
  );

  if (!files.length) {
    throw new Error(`No audio files found in Yandex Disk folder ${folderPath}`);
  }

  const selected = files[Math.floor(Math.random() * files.length)];
  const downloadHref = await getDownloadHref(selected.path!);

  return {
    tag,
    name: selected.name!,
    diskPath: selected.path!,
    downloadHref,
  };
}

export async function getBackgroundAudioTrackByDiskPath(diskPath: string) {
  const normalizedPath = String(diskPath || "").trim();
  if (!normalizedPath) {
    throw new Error("Background audio disk path is empty");
  }

  const meta = await getResourceMeta(normalizedPath);
  const resolvedPath = String(meta.path || normalizedPath).trim();
  const resolvedName =
    String(meta.name || "").trim() ||
    resolvedPath.split("/").filter(Boolean).pop() ||
    "background_audio.mp3";
  const downloadHref = await getDownloadHref(resolvedPath);

  return {
    name: resolvedName,
    diskPath: resolvedPath,
    downloadHref,
  };
}

export async function uploadFinalVideoToYandexDisk(params: {
  localFilePath: string;
  avatarFolderName: string;
  projectName: string;
  fileName: string;
  projectFolderPath?: string | null;
}) {
  const avatarFolder = sanitizeFolderName(params.avatarFolderName) || "Unknown avatar";
  const projectFolder = sanitizeFolderName(params.projectName) || "Unknown project";
  const avatarProjectFolder = sanitizeFolderName(`${avatarFolder}_${projectFolder}`) || `${avatarFolder}_${projectFolder}`;
  const customProjectPath = normalizeCustomFolderPath(params.projectFolderPath);
  
  const rootPath = toDiskPath(ROOT_VIDEO_FOLDER);
  const automationPath = toDiskPath(ROOT_VIDEO_FOLDER, ROOT_AUTOMATION_FOLDER);
  const projectPath = customProjectPath || toDiskPath(ROOT_VIDEO_FOLDER, ROOT_AUTOMATION_FOLDER, avatarProjectFolder);
  const avatarGroupPath = `${projectPath}/${sanitizeFolderName(avatarFolder) || "Unknown avatar"}`;
  const filePath = `${avatarGroupPath}/${sanitizeFileName(params.fileName)}`;

  if (!customProjectPath) {
    await ensureFolderExists(rootPath);
    await ensureFolderExists(automationPath);
  }
  await ensureFolderTreeExists(projectPath);
  await ensureFolderExists(avatarGroupPath);

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

  // Small breather for Yandex Disk before publishing
  await new Promise((resolve) => setTimeout(resolve, 500));

  await publishResource(filePath);
  const meta = await getResourceMeta(filePath);

  return {
    rootPath,
    automationPath,
    projectPath,
    avatarPath: avatarGroupPath,
    filePath: meta.path || filePath,
    publicUrl: meta.public_url || null,
  };
}
