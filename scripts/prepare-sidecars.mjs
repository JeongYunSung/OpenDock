import { spawnSync } from "node:child_process";
import { copyFile, chmod, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { arch, platform } from "node:os";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appRoot, "..");
const localCliRoot = join(workspaceRoot, "opendock");
const localCliSource = join(localCliRoot, "bin", "opendock");
const target = targetTriple();
const source = resolveSource();
const outDir = join(appRoot, "src-tauri", "binaries");
const outPath = join(outDir, `opendock-${target.suffix}`);

prepareLocalCliSource(source);

if (!existsSync(source)) {
  throw new Error(`OpenDock CLI sidecar source not found: ${source}`);
}

await mkdir(outDir, { recursive: true });
await copyFile(source, outPath);
await chmod(outPath, 0o755);

console.log(`prepared OpenDock sidecar: ${outPath}`);

function resolveSource() {
  if (process.env.OPENDOCK_CLI_SOURCE) {
    return resolve(process.env.OPENDOCK_CLI_SOURCE);
  }
  if (platform() === "win32" && process.env.OPENDOCK_WINDOWS_CLI_PATH) {
    return resolve(process.env.OPENDOCK_WINDOWS_CLI_PATH);
  }
  return localCliSource;
}

function prepareLocalCliSource(sourcePath) {
  if (sourcePath !== localCliSource) return;
  const result = spawnSync("bun", ["run", "build"], {
    cwd: localCliRoot,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`failed to build OpenDock CLI sidecar source: exit ${result.status ?? "unknown"}`);
  }
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
