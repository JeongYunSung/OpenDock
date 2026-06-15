import { spawnSync } from "node:child_process";
import { copyFile, chmod, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { arch, platform } from "node:os";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "../..");
const localCliRoot = join(repoRoot, "packages", "cli");
const localCliEntry = join(localCliRoot, "src", "cli.ts");
const target = targetTriple();
const source = resolveSource();
const outDir = join(appRoot, "src-tauri", "binaries");
const outPath = join(outDir, `opendock-${target.suffix}`);

await mkdir(outDir, { recursive: true });

if (source === localCliEntry) {
  compileLocalCliSidecar(outPath);
} else if (!existsSync(source)) {
  throw new Error(`OpenDock CLI sidecar source not found: ${source}`);
} else {
  await copyFile(source, outPath);
}

await chmod(outPath, 0o755);
await assertStandaloneSidecar(outPath);
assertSidecarCliRuns(outPath);

console.log(`prepared OpenDock sidecar: ${outPath}`);

function resolveSource() {
  if (process.env.OPENDOCK_CLI_SOURCE) {
    return resolve(process.env.OPENDOCK_CLI_SOURCE);
  }
  if (platform() === "win32" && process.env.OPENDOCK_WINDOWS_CLI_PATH) {
    return resolve(process.env.OPENDOCK_WINDOWS_CLI_PATH);
  }
  return localCliEntry;
}

function compileLocalCliSidecar(outputPath) {
  const result = spawnSync("bun", ["build", "src/cli.ts", "--compile", "--outfile", outputPath], {
    cwd: localCliRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`failed to compile OpenDock CLI sidecar: exit ${result.status ?? "unknown"}`);
  }
}

async function assertStandaloneSidecar(outputPath) {
  const header = (await readFile(outputPath)).subarray(0, 128).toString("utf8");
  if (header.startsWith("#!") && header.includes("bun")) {
    throw new Error(`OpenDock sidecar must be standalone, but ${outputPath} still requires bun`);
  }
}

function assertSidecarCliRuns(outputPath) {
  const result = spawnSync(outputPath, ["--version"], {
    encoding: "utf8",
    env: sidecarSmokeTestEnv(),
  });
  if (result.status !== 0 || result.stdout.trim() === "") {
    throw new Error(`OpenDock sidecar did not run correctly: ${result.stderr.trim() || "empty output"}`);
  }
}

function sidecarSmokeTestEnv() {
  if (platform() === "win32") {
    return process.env;
  }
  return {
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
  };
}

function targetTriple() {
  const os = platform();
  const cpu = arch();
  if (os === "darwin" && cpu === "arm64") return { suffix: "aarch64-apple-darwin" };
  if (os === "darwin" && cpu === "x64") return { suffix: "x86_64-apple-darwin" };
  if (os === "win32" && cpu === "x64") return { suffix: "x86_64-pc-windows-msvc.exe" };
  if (os === "win32" && cpu === "arm64") return { suffix: "aarch64-pc-windows-msvc.exe" };
  if (os === "linux" && cpu === "x64") return { suffix: "x86_64-unknown-linux-gnu" };
  if (os === "linux" && cpu === "arm64") return { suffix: "aarch64-unknown-linux-gnu" };
  throw new Error(`unsupported sidecar target: ${os}/${cpu}`);
}
