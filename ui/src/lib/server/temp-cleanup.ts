import path from "path";
import { readdir, rm } from "fs/promises";

const MONTAGE_TEMP_ROOT = "/tmp/platipo-miru-montage";

function isInsidePath(childPath: string, parentPath: string) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

export async function cleanupMontageWorkspace(options: {
  workdir: string;
  keepPaths?: string[];
}) {
  const resolvedRoot = path.resolve(MONTAGE_TEMP_ROOT);
  const resolvedWorkdir = path.resolve(options.workdir);
  if (!isInsidePath(resolvedWorkdir, resolvedRoot)) {
    throw new Error(`Refusing to cleanup outside montage temp root: ${options.workdir}`);
  }

  const keepPaths = new Set(
    (options.keepPaths || []).map((keepPath) => path.resolve(keepPath))
  );
  const entries = await readdir(resolvedWorkdir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(resolvedWorkdir, entry.name);
    const resolvedEntryPath = path.resolve(entryPath);
    if (keepPaths.has(resolvedEntryPath)) {
      continue;
    }
    await rm(resolvedEntryPath, { recursive: entry.isDirectory(), force: true });
  }
}
