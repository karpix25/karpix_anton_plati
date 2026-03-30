import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface PollOptions {
  jobId?: string | null;
  limit?: number;
}

export async function pollSavedKieTasks({ jobId, limit = 100 }: PollOptions) {
  const repoRoot = path.resolve(process.cwd(), "..");
  const args = ["services/v1/automation/poll_kie_tasks.py"];

  if (jobId) {
    args.push("--job-id", jobId);
  } else {
    args.push("--limit", String(limit));
  }

  const env = {
    ...process.env,
    PYTHONPATH: repoRoot,
  };

  const { stdout, stderr } = await execFileAsync("python3", args, {
    cwd: repoRoot,
    env,
  });

  return {
    stdout,
    stderr,
    jobId: jobId || null,
    limit,
  };
}
