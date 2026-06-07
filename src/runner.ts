import { spawnSync } from "node:child_process";
import type { PackManifest } from "./pack.js";

export interface StepReport {
  id: string;
  name: string;
  status: "Ready" | "Ran" | "Failed";
}

const allowedCommands = new Set([
  "brew",
  "bun",
  "git",
  "mkdir",
  "node",
  "npm",
  "npx",
  "oma",
  "pip",
  "pip3",
  "pipx",
  "pnpm",
  "python",
  "python3",
  "test",
  "uv",
]);

export function runSetup(manifest: PackManifest, projectDir: string): StepReport[] {
  const reports: StepReport[] = [];
  for (const step of manifest.setup) {
    if (step.copy) {
      reports.push({ id: step.id, name: step.name, status: "Ready" });
      continue;
    }

    const checkPassed = step.check ? runCommand(step.check, projectDir).success : false;
    if (checkPassed) {
      reports.push({ id: step.id, name: step.name, status: "Ready" });
      continue;
    }

    if (step.run) {
      const result = runCommand(step.run, projectDir);
      if (!result.success) {
        reports.push({ id: step.id, name: step.name, status: "Failed" });
        throw new Error(`step \`${step.id}\` exited with non-zero status`);
      }
      reports.push({ id: step.id, name: step.name, status: "Ran" });
    }
  }
  return reports;
}

export function runCommand(command: string, cwd: string): { success: boolean } {
  rejectShellMetacharacters(command);
  const args = splitCommand(command);
  const [program, ...rest] = args;
  if (!program) {
    throw new Error(`empty command: ${command}`);
  }
  ensureAllowed(program);

  const output = spawnSync(program, rest, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (output.error) {
    throw output.error;
  }

  return { success: output.status === 0 };
}

function rejectShellMetacharacters(command: string): void {
  const blocked = ["|", "&&", "||", ";", "`", "$(", ">", "<"];
  if (blocked.some((token) => command.includes(token))) {
    throw new Error(`shell operators are not allowed in setup commands: ${command}`);
  }
}

function ensureAllowed(program: string): void {
  if (!allowedCommands.has(program)) {
    throw new Error(`command \`${program}\` is not allowed in OpenDock setup`);
  }
}

function splitCommand(command: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current !== "") {
        result.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error(`invalid command: ${command}`);
  }
  if (current !== "") {
    result.push(current);
  }
  return result;
}
