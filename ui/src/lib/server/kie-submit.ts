import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function submitSavedKieTasks(jobId: string) {
  const repoRoot = path.resolve(process.cwd(), "..");
  const env = {
    ...process.env,
    PYTHONPATH: repoRoot,
  };

  const { stdout, stderr } = await execFileAsync(
    "python3",
    ["services/v1/automation/submit_kie_tasks.py", "--job-id", jobId],
    {
      cwd: repoRoot,
      env,
    }
  );

  return {
    stdout,
    stderr,
    jobId,
  };
}
