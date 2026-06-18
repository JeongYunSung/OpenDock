import { errorMessage } from "./change-output.js";
import { appendRunLog, type RunStatus } from "./logging.js";

export function recordCommandLog(
  projectDir: string,
  command: string,
  status: RunStatus,
  message: string,
  dockId?: string,
): void {
  try {
    appendRunLog(projectDir, command, dockId, status, message);
  } catch {
    // Logging should never make the requested command fail.
  }
}

export function recordCommandFailure(
  projectDir: string,
  command: string,
  error: unknown,
  dockId?: string,
): void {
  recordCommandLog(projectDir, command, "Failure", errorMessage(error), dockId);
}
