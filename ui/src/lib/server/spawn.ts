import { spawn } from "child_process";

export type SpawnResult = { stdout: string; stderr: string; code: number | null };

/**
 * spawn с обязательным потолком по времени.
 *
 * Без потолка ffmpeg на битом входе крутится вечно: HTTP-запрос никогда не
 * отвечает, процесс ест CPU до перезапуска контейнера. Проверено на проде:
 * одна загрузка повреждённого jpg на /api/clients/product-video (эндпоинт
 * публичный и без авторизации) оставила ffmpeg на 2м35с при 51% CPU, и он
 * продолжал жить после того, как клиент отвалился по таймауту.
 */
export function spawnWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} killed after ${timeoutMs}ms timeout`));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}
