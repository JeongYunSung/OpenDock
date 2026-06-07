import { spawnSync } from "node:child_process";
import { delimiter, dirname, sep } from "node:path";
import type { LifecyclePhase, LifecycleStep, PackManifest } from "./pack.js";

export interface StepReport {
  id: string;
  name: string;
  status: "Ready" | "Ran" | "Failed";
  message?: string;
}

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

interface CommandOptions {
  interactive?: LifecycleStep["interactive"];
  live?: boolean;
  missingAsFailure?: boolean;
  timeoutMs?: number;
}

interface CheckResult {
  passed: boolean;
  message?: string;
}

const defaultDoctorTimeoutMs = 30_000;
const defaultInteractiveColumns = 100;
const defaultInteractiveRows = 30;

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

export function getLifecycleSteps(manifest: PackManifest, phase: LifecyclePhase): LifecycleStep[] {
  const lifecycleSteps = manifest.lifecycle[phase] ?? [];
  if (lifecycleSteps.length > 0) {
    return lifecycleSteps;
  }
  if (phase === "install" || phase === "update") {
    return manifest.setup;
  }
  return [];
}

export function hasLifecycleSteps(manifest: PackManifest, phase: LifecyclePhase): boolean {
  return getLifecycleSteps(manifest, phase).length > 0;
}

export function hasExplicitLifecycleSteps(manifest: PackManifest, phase: LifecyclePhase): boolean {
  return (manifest.lifecycle[phase] ?? []).length > 0;
}

export async function runLifecycle(
  manifest: PackManifest,
  phase: LifecyclePhase,
  projectDir: string,
): Promise<StepReport[]> {
  if (phase === "doctor") {
    return runDoctorSteps(getLifecycleSteps(manifest, phase), projectDir);
  }
  return runSetupSteps(getLifecycleSteps(manifest, phase), projectDir);
}

async function runSetupSteps(steps: LifecycleStep[], projectDir: string): Promise<StepReport[]> {
  const reports: StepReport[] = [];
  for (const step of steps) {
    if (step.copy) {
      reports.push({ id: step.id, name: stepName(step), status: "Ready" });
      continue;
    }

    const checkResult = step.check ? await evaluateStepCheck(step, projectDir) : { passed: false };
    if (checkResult.passed) {
      console.log(`✓ ${step.id}: ready`);
      reports.push({ id: step.id, name: stepName(step), status: "Ready" });
      continue;
    }

    if (step.run) {
      console.log(`→ ${step.id}: ${step.run}`);
      const runOptions: CommandOptions = { live: true };
      if (step.interactive) {
        runOptions.interactive = step.interactive;
      }
      if (step.timeout_ms !== undefined) {
        runOptions.timeoutMs = step.timeout_ms;
      }
      const result = await runCommand(step.run, projectDir, runOptions);
      if (!result.success) {
        reports.push({ id: step.id, name: stepName(step), status: "Failed" });
        const message = failureMessage(result);
        const suffix = message ? `: ${message}` : "";
        throw new Error(`step \`${step.id}\` exited with non-zero status${suffix}`);
      }
      if (step.check) {
        const postRunCheck = await evaluateStepCheck(step, projectDir);
        if (!postRunCheck.passed) {
          const report: StepReport = { id: step.id, name: stepName(step), status: "Failed" };
          if (postRunCheck.message) {
            report.message = postRunCheck.message;
          }
          reports.push(report);
          const message = postRunCheck.message ? `: ${postRunCheck.message}` : "";
          throw new Error(`step \`${step.id}\` did not satisfy its check after run${message}`);
        }
      }
      console.log(`✓ ${step.id}: ran`);
      reports.push({ id: step.id, name: stepName(step), status: "Ran" });
    }
  }
  return reports;
}

async function evaluateStepCheck(step: LifecycleStep, projectDir: string): Promise<CheckResult> {
  if (!step.check) {
    return { passed: false };
  }
  const result = await runCommand(step.check, projectDir, {
    missingAsFailure: true,
    ...(step.timeout_ms === undefined ? {} : { timeoutMs: step.timeout_ms }),
  });
  if (!result.success) {
    return { passed: false };
  }
  if (!step.version) {
    return { passed: true };
  }
  const actual = extractVersion(combinedOutput(result));
  if (!actual) {
    return { passed: false, message: `could not read version from ${step.check}` };
  }
  if (!satisfiesVersion(actual, step.version)) {
    return { passed: false, message: `${actual} does not satisfy ${step.version}` };
  }
  return { passed: true };
}

async function runDoctorSteps(steps: LifecycleStep[], projectDir: string): Promise<StepReport[]> {
  const reports: StepReport[] = [];
  for (const step of steps) {
    const command = step.run ?? step.check;
    if (!command) {
      reports.push({ id: step.id, name: stepName(step), status: "Ready" });
      continue;
    }

    const result = await runCommand(command, projectDir, {
      missingAsFailure: true,
      timeoutMs: step.timeout_ms ?? defaultDoctorTimeoutMs,
    });
    if (!result.success) {
      const report: StepReport = { id: step.id, name: stepName(step), status: "Failed" };
      const message = failureMessage(result);
      if (message) {
        report.message = message;
      }
      reports.push(report);
      continue;
    }

    if (step.version) {
      const actual = extractVersion(combinedOutput(result));
      if (!actual || !satisfiesVersion(actual, step.version)) {
        reports.push({
          id: step.id,
          name: stepName(step),
          status: "Failed",
          message: actual
            ? `${actual} does not satisfy ${step.version}`
            : `could not read version from ${command}`,
        });
        continue;
      }
    }

    reports.push({ id: step.id, name: stepName(step), status: "Ready" });
  }
  return reports;
}

export async function runCommand(
  command: string,
  cwd: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  rejectShellMetacharacters(command);
  const args = splitCommand(command);
  const [program, ...rest] = args;
  if (!program) {
    throw new Error(`empty command: ${command}`);
  }
  ensureAllowed(program);

  if (options.interactive === "user") {
    return runUserInteractiveCommand(program, rest, cwd, options);
  }
  if (isScriptedInteractive(options.interactive)) {
    return runScriptedInteractiveCommand(program, rest, cwd, options);
  }

  const output = spawnSync(program, rest, {
    cwd,
    encoding: "utf8",
    env: commandEnvironment(program),
    killSignal: "SIGTERM",
    stdio: options.live ? "inherit" : "pipe",
    timeout: options.timeoutMs,
  });

  if (output.error) {
    const code = (output.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      return {
        success: false,
        stdout: output.stdout ?? "",
        stderr: `timed out after ${options.timeoutMs}ms`,
      };
    }
    if (options.missingAsFailure && code === "ENOENT") {
      return { success: false, stdout: "", stderr: output.error.message };
    }
    throw output.error;
  }

  return {
    success: output.status === 0,
    stdout: output.stdout ?? "",
    stderr: output.stderr ?? "",
  };
}

function runUserInteractiveCommand(
  program: string,
  args: string[],
  cwd: string,
  options: CommandOptions,
): CommandResult {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return {
      success: false,
      stdout: "",
      stderr: "interactive step requires a TTY; re-run this command from a terminal",
    };
  }

  const output = spawnSync(program, args, {
    cwd,
    env: commandEnvironment(program),
    killSignal: "SIGTERM",
    stdio: "inherit",
    timeout: options.timeoutMs,
  });

  if (output.error) {
    const code = (output.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      return {
        success: false,
        stdout: "",
        stderr: `timed out after ${options.timeoutMs}ms`,
      };
    }
    return { success: false, stdout: "", stderr: output.error.message };
  }

  return { success: output.status === 0, stdout: "", stderr: "" };
}

async function runScriptedInteractiveCommand(
  program: string,
  args: string[],
  cwd: string,
  options: CommandOptions,
): Promise<CommandResult> {
  const interactive = normalizeScriptedInteractive(options.interactive);
  const input = renderInteractiveInputs(interactive.inputs);
  const expectOptions: { cols: number; rows: number; timeoutMs?: number } = {
    cols: interactive.cols ?? defaultInteractiveColumns,
    rows: interactive.rows ?? defaultInteractiveRows,
  };
  if (options.timeoutMs !== undefined) {
    expectOptions.timeoutMs = options.timeoutMs;
  }
  const script = buildExpectScript(program, args, input, expectOptions);

  const output = spawnSync("expect", ["-c", script], {
    cwd,
    encoding: "utf8",
    env: commandEnvironment(program),
    killSignal: "SIGTERM",
    stdio: options.live ? ["ignore", "inherit", "inherit"] : "pipe",
    timeout: options.timeoutMs,
  });

  if (output.error) {
    const code = (output.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      return {
        success: false,
        stdout: output.stdout ?? "",
        stderr: `timed out after ${options.timeoutMs}ms`,
      };
    }
    if (code === "ENOENT") {
      return {
        success: false,
        stdout: "",
        stderr: "scripted interactive step requires `expect` on PATH",
      };
    }
    throw output.error;
  }

  return {
    success: output.status === 0,
    stdout: output.stdout ?? "",
    stderr:
      output.status === 124 && options.timeoutMs
        ? `timed out after ${options.timeoutMs}ms`
        : (output.stderr ?? ""),
  };
}

function buildExpectScript(
  program: string,
  args: string[],
  input: string,
  options: { cols: number; rows: number; timeoutMs?: number },
): string {
  const timeoutSeconds =
    options.timeoutMs === undefined ? -1 : Math.max(1, Math.ceil(options.timeoutMs / 1000));
  const command = [program, ...args].map(tclWord).join(" ");
  const inputHex = Buffer.from(input, "utf8").toString("hex");
  return [
    `set timeout ${timeoutSeconds}`,
    `spawn ${command}`,
    `stty rows ${options.rows} columns ${options.cols}`,
    inputHex === "" ? "" : `after 50`,
    inputHex === "" ? "" : `send -- [binary format H* ${inputHex}]`,
    `expect {`,
    `  eof {}`,
    `  timeout {`,
    `    catch {close}`,
    `    catch wait`,
    `    exit 124`,
    `  }`,
    `}`,
    `catch wait result`,
    `if {[llength $result] >= 4} { exit [lindex $result 3] }`,
    `exit 1`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function tclWord(value: string): string {
  return `{${value.replace(/\\/g, "\\\\").replace(/}/g, "\\}")}}`;
}

function isScriptedInteractive(interactive: LifecycleStep["interactive"] | undefined): boolean {
  return (
    interactive === "scripted" ||
    (typeof interactive === "object" && interactive.mode === "scripted")
  );
}

function normalizeScriptedInteractive(
  interactive: LifecycleStep["interactive"] | undefined,
): Extract<LifecycleStep["interactive"], { mode: "scripted" }> {
  if (typeof interactive === "object" && interactive.mode === "scripted") {
    return interactive;
  }
  return { mode: "scripted", inputs: [] };
}

function renderInteractiveInputs(
  inputs: Extract<LifecycleStep["interactive"], { mode: "scripted" }>["inputs"],
): string {
  return inputs.map(renderInteractiveInput).join("");
}

function renderInteractiveInput(
  input: Extract<LifecycleStep["interactive"], { mode: "scripted" }>["inputs"][number],
): string {
  if (typeof input === "string") {
    return input;
  }
  if ("text" in input) {
    return input.text.repeat(input.repeat);
  }
  return keySequence(input.key).repeat(input.repeat);
}

function keySequence(key: string): string {
  if (key === "backspace") return "\x7f";
  if (key === "down") return "\x1b[B";
  if (key === "enter") return "\r";
  if (key === "escape") return "\x1b";
  if (key === "left") return "\x1b[D";
  if (key === "right") return "\x1b[C";
  if (key === "space") return " ";
  if (key === "tab") return "\t";
  if (key === "up") return "\x1b[A";
  throw new Error(`unsupported interactive key: ${key}`);
}

function combinedOutput(output: { stdout: string; stderr: string }): string {
  return `${output.stdout}\n${output.stderr}`;
}

function failureMessage(output: CommandResult): string | undefined {
  const text = combinedOutput(output).trim();
  if (text === "") {
    return undefined;
  }
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function commandEnvironment(program: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env._VOLTA_TOOL_RECURSION;
  if (program === "oma") {
    env.OMA_SKIP_VERSION_CHECK = env.OMA_SKIP_VERSION_CHECK ?? "1";
    env.PATH = withoutVoltaNodeImageBin(env.PATH);
  }
  return env;
}

function withoutVoltaNodeImageBin(pathValue: string | undefined): string | undefined {
  if (!pathValue) {
    return pathValue;
  }

  const nodeBin = dirname(process.execPath);
  const voltaNodeImageMarker = `${sep}.volta${sep}tools${sep}image${sep}node${sep}`;
  if (!nodeBin.includes(voltaNodeImageMarker)) {
    return pathValue;
  }

  return pathValue
    .split(delimiter)
    .filter((entry) => entry !== nodeBin)
    .join(delimiter);
}

function rejectShellMetacharacters(command: string): void {
  const blocked = ["|", "&&", "||", ";", "`", "$(", ">", "<"];
  if (blocked.some((token) => command.includes(token))) {
    throw new Error(`shell operators are not allowed in lifecycle commands: ${command}`);
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

function stepName(step: LifecycleStep): string {
  return step.name ?? step.id;
}

function extractVersion(output: string): string | undefined {
  return output.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0];
}

function satisfiesVersion(actual: string, range: string): boolean {
  for (const condition of range.trim().split(/\s+/)) {
    if (condition === "") {
      continue;
    }
    const match = condition.match(/^(>=|>|<=|<|=)?(.+)$/);
    if (!match) {
      return false;
    }
    const operator = match[1] ?? "=";
    const expected = match[2];
    if (!expected) {
      return false;
    }
    const comparison = compareVersions(actual, expected);
    if (operator === ">=" && comparison < 0) return false;
    if (operator === ">" && comparison <= 0) return false;
    if (operator === "<=" && comparison > 0) return false;
    if (operator === "<" && comparison >= 0) return false;
    if (operator === "=" && comparison !== 0) return false;
  }
  return true;
}

function compareVersions(left: string, right: string): number {
  const [leftMajor, leftMinor, leftPatch] = parseVersion(left);
  const [rightMajor, rightMinor, rightPatch] = parseVersion(right);
  for (const delta of [leftMajor - rightMajor, leftMinor - rightMinor, leftPatch - rightPatch]) {
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }
  return 0;
}

function parseVersion(version: string): [number, number, number] {
  const match = version.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    throw new Error(`invalid version \`${version}\``);
  }
  return [
    Number.parseInt(match[1] ?? "0", 10),
    Number.parseInt(match[2] ?? "0", 10),
    Number.parseInt(match[3] ?? "0", 10),
  ];
}
