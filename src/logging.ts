import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataRoot } from "./paths.js";

export type RunStatus = "Success" | "Failure";

export interface RunLog {
  timestamp: string;
  project_path: string;
  command: string;
  pack_id: string;
  status: RunStatus;
  message: string;
}

export function appendRunLog(
  projectDir: string,
  command: string,
  packId: string,
  status: RunStatus,
  message: string,
): void {
  const projectPath = canonicalProjectPath(projectDir);
  const path = projectLogPath(projectPath);
  mkdirSync(dirname(path), { recursive: true });
  const log: RunLog = {
    timestamp: new Date().toISOString(),
    project_path: projectPath,
    command,
    pack_id: packId,
    status,
    message,
  };
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, `${existing}${JSON.stringify(log)}\n`);
}

export function readProjectLogs(projectDir: string): RunLog[] {
  const path = projectLogPath(canonicalProjectPath(projectDir));
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RunLog);
}

function projectLogPath(projectDir: string): string {
  const hash = createHash("sha256").update(projectDir).digest("hex");
  return join(dataRoot(), "logs", `${hash}.jsonl`);
}

function canonicalProjectPath(projectDir: string): string {
  try {
    return realpathSync(projectDir);
  } catch {
    return projectDir;
  }
}
