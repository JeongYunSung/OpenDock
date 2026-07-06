import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse, relative, resolve } from "node:path";
import { detectPlatform, type OpenDockPlatform } from "../../platform.js";
import { opendockCommandPath, satisfiesVersion } from "./command-runner.js";
import {
  sharedRuntimeBinDir,
  sharedRuntimeInstallDir,
  sharedRuntimeRoot,
} from "./project-layout.js";

const runtimeCommandMaxBuffer = 20 * 1024 * 1024;

export type RuntimeInstallSource = "managed";

export interface RuntimeInstallRequest {
  platform: OpenDockPlatform;
  projectDir: string;
  requested: string;
  runtime: string;
}

export interface RuntimeInstallResult {
  commands: string[];
  path: string;
  requested: string;
  source: RuntimeInstallSource;
  targets: Record<string, string>;
  version: string;
}

export interface RuntimeInstaller {
  install(request: RuntimeInstallRequest): RuntimeInstallResult | undefined;
}

export interface NodeRelease {
  files: string[];
  npm?: string;
  version: string;
}

export interface NodePlatformArchive {
  archiveName: string;
  compression: "tar-gz" | "tar-xz" | "zip";
  executableDir: "bin" | "root";
  fileKey: string;
}

export interface BunRelease {
  assets?: Array<{ name: string }>;
  tag_name: string;
}

export interface BunPlatformArchive {
  archiveName: string;
}

export interface UvRelease {
  assets?: Array<{ name: string }>;
  tag_name: string;
}

export interface UvPlatformArchive {
  archiveName: string;
  compression: "tar-gz" | "zip";
}

interface UvPythonDownload {
  arch?: string;
  implementation?: string;
  os?: string;
  variant?: string;
  version?: string;
}

const DEFAULT_UV_RUNTIME_RANGE = ">=0.5.0";
const DEFAULT_PYTHON_RUNTIME_RANGE = ">=3.11.0 <3.14.0";

export class OpenDockRuntimeInstaller implements RuntimeInstaller {
  install(request: RuntimeInstallRequest): RuntimeInstallResult | undefined {
    if (request.runtime === "bun") {
      return installBunRuntime(request);
    }
    if (request.runtime === "node" || request.runtime === "npm") {
      return installNodeRuntime(request);
    }
    if (
      request.runtime === "python" ||
      request.runtime === "python3" ||
      request.runtime === "pip" ||
      request.runtime === "pip3"
    ) {
      return installPythonRuntime(request);
    }
    if (request.runtime === "uv") {
      return installUvRuntime(request);
    }
    return undefined;
  }
}

export function selectNodeRelease(
  releases: NodeRelease[],
  runtime: "node" | "npm",
  requested: string,
  archive: NodePlatformArchive,
): NodeRelease | undefined {
  return releases.find((release) => {
    if (!release.files.includes(archive.fileKey)) {
      return false;
    }
    if (runtime === "node") {
      return satisfiesVersion(stripVersionPrefix(release.version), requested);
    }
    return release.npm ? satisfiesVersion(release.npm, requested) : false;
  });
}

export function selectBunRelease(
  releases: BunRelease[],
  requested: string,
  archive: BunPlatformArchive,
): BunRelease | undefined {
  return releases.find((release) => {
    const version = bunVersionFromTag(release.tag_name);
    if (!version || !satisfiesVersion(version, requested)) {
      return false;
    }
    return release.assets?.some((asset) => asset.name === archive.archiveName) ?? false;
  });
}

export function selectUvRelease(
  releases: UvRelease[],
  requested: string,
  archive: UvPlatformArchive,
): UvRelease | undefined {
  return releases.find((release) => {
    const version = uvVersionFromTag(release.tag_name);
    if (!version || !satisfiesVersion(version, requested)) {
      return false;
    }
    return release.assets?.some((asset) => asset.name === archive.archiveName) ?? false;
  });
}

function installBunRuntime(request: RuntimeInstallRequest): RuntimeInstallResult {
  const platform = request.platform ?? detectPlatform();
  const archive = bunPlatformArchive(platform);
  const releases = readBunReleases();
  const release = selectBunRelease(releases, request.requested, archive);
  if (!release) {
    throw new Error(`no downloadable Bun release satisfies ${request.requested} for ${platform}`);
  }
  const version = bunVersionFromTag(release.tag_name);
  if (!version) {
    throw new Error(`invalid Bun release tag: ${release.tag_name}`);
  }
  const runtimeDir = ensureBunDistribution(release.tag_name, version, archive);
  const bunSource = findBunExecutable(runtimeDir);
  const bin = sharedRuntimeBinDir("bun", version);
  const target = createExecutableWrapper(join(bin, "bun"), platform, bunSource);
  return {
    commands: ["bun"],
    path: bin,
    requested: request.requested,
    source: "managed",
    targets: { bun: target },
    version,
  };
}

function installNodeRuntime(request: RuntimeInstallRequest): RuntimeInstallResult {
  const platform = request.platform ?? detectPlatform();
  const archive = nodePlatformArchive(platform);
  const releases = readNodeIndex();
  const release = selectNodeRelease(
    releases,
    request.runtime as "node" | "npm",
    request.requested,
    archive,
  );
  if (!release) {
    throw new Error(
      `no downloadable Node.js release satisfies ${request.runtime} ${request.requested} for ${platform}`,
    );
  }

  const nodeVersion = stripVersionPrefix(release.version);
  const npmVersion = release.npm;
  const versionedArchive = archiveNameForVersion(archive, release.version);
  const runtimeDir = ensureNodeDistribution(release.version, versionedArchive);
  const nodeSource =
    archive.executableDir === "bin"
      ? join(runtimeDir, "bin", "node")
      : join(runtimeDir, "node.exe");
  const nodeExecutableDir = dirname(nodeSource);
  const npmSource =
    archive.executableDir === "bin" ? join(runtimeDir, "bin", "npm") : join(runtimeDir, "npm.cmd");

  const nodeBin = sharedRuntimeBinDir("node", nodeVersion);
  const nodeTarget = createExecutableWrapper(join(nodeBin, "node"), platform, nodeSource);

  if (npmVersion && existsSync(npmSource)) {
    const npmBin = sharedRuntimeBinDir("npm", npmVersion);
    createExecutableWrapper(join(npmBin, "npm"), platform, npmSource, [], [nodeExecutableDir]);
  }

  if (request.runtime === "npm") {
    if (!npmVersion || !existsSync(npmSource)) {
      throw new Error(`Node.js ${release.version} does not include an npm executable`);
    }
    const npmBin = sharedRuntimeBinDir("npm", npmVersion);
    const npmTarget = createExecutableWrapper(
      join(npmBin, "npm"),
      platform,
      npmSource,
      [],
      [nodeExecutableDir],
    );
    return {
      commands: ["npm"],
      path: npmBin,
      requested: request.requested,
      source: "managed",
      targets: { npm: npmTarget },
      version: npmVersion,
    };
  }

  return {
    commands: ["node"],
    path: nodeBin,
    requested: request.requested,
    source: "managed",
    targets: { node: nodeTarget },
    version: nodeVersion,
  };
}

function installUvRuntime(request: RuntimeInstallRequest): RuntimeInstallResult {
  const platform = request.platform ?? detectPlatform();
  const archive = uvPlatformArchive(platform);
  const releases = readUvReleases();
  const release = selectUvRelease(releases, request.requested, archive);
  if (!release) {
    throw new Error(`no downloadable uv release satisfies ${request.requested} for ${platform}`);
  }
  const version = uvVersionFromTag(release.tag_name);
  if (!version) {
    throw new Error(`invalid uv release tag: ${release.tag_name}`);
  }
  const runtimeDir = ensureUvDistribution(release.tag_name, version, archive);
  const uvSource = findUvExecutable(runtimeDir);
  const bin = sharedRuntimeBinDir("uv", version);
  const target = createExecutableWrapper(join(bin, "uv"), platform, uvSource);
  return {
    commands: ["uv"],
    path: bin,
    requested: request.requested,
    source: "managed",
    targets: { uv: target },
    version,
  };
}

function installPythonRuntime(request: RuntimeInstallRequest): RuntimeInstallResult | undefined {
  const uv = prepareUvCommand(request);
  const env = uvPythonEnvironment();
  const requestedPython =
    request.runtime === "pip" || request.runtime === "pip3"
      ? DEFAULT_PYTHON_RUNTIME_RANGE
      : request.requested;
  const pythonRequest = resolvePythonDownloadRequest(
    uv,
    { ...request, requested: requestedPython },
    env,
  );
  runChecked(uv, ["python", "install", pythonRequest], { env });
  const pythonPath = runChecked(uv, ["python", "find", pythonRequest], { env }).stdout.trim();
  const pythonVersionOutput = runChecked(pythonPath, ["--version"], { env });
  const pythonVersion = extractRequiredVersion(
    pythonVersionOutput.stdout || pythonVersionOutput.stderr,
    "python",
  );
  if (
    isRangeLikeVersionRequest(requestedPython) &&
    !satisfiesVersion(pythonVersion, requestedPython)
  ) {
    throw new Error(`managed Python ${pythonVersion} does not satisfy ${requestedPython}`);
  }

  if (request.runtime === "python" || request.runtime === "python3") {
    const bin = sharedRuntimeBinDir(request.runtime, pythonVersion);
    const target = createExecutableWrapper(
      join(bin, request.runtime),
      request.platform,
      pythonPath,
    );
    return {
      commands: [request.runtime],
      path: bin,
      requested: request.requested,
      source: "managed",
      targets: { [request.runtime]: target },
      version: pythonVersion,
    };
  }

  runChecked(
    uv,
    [
      "pip",
      "install",
      "--python",
      pythonPath,
      "--break-system-packages",
      pipPackageSpec(request.requested),
    ],
    {
      env,
    },
  );
  const pipOutput = runChecked(pythonPath, ["-m", "pip", "--version"], { env }).stdout;
  const pipVersion = extractRequiredVersion(pipOutput, "pip");
  if (!satisfiesVersion(pipVersion, request.requested)) {
    throw new Error(`managed pip ${pipVersion} does not satisfy ${request.requested}`);
  }
  const bin = sharedRuntimeBinDir(request.runtime, pipVersion);
  const target = createExecutableWrapper(join(bin, request.runtime), request.platform, pythonPath, [
    "-m",
    "pip",
  ]);
  return {
    commands: [request.runtime],
    path: bin,
    requested: request.requested,
    source: "managed",
    targets: { [request.runtime]: target },
    version: pipVersion,
  };
}

function resolvePythonDownloadRequest(
  uv: string,
  request: RuntimeInstallRequest,
  env: NodeJS.ProcessEnv,
): string {
  if (!isRangeLikeVersionRequest(request.requested)) {
    return request.requested;
  }
  const downloads = JSON.parse(
    runChecked(uv, ["python", "list", "--only-downloads", "--output-format", "json"], { env })
      .stdout,
  ) as UvPythonDownload[];
  const selected = downloads
    .filter((download) => download.implementation === "cpython")
    .filter((download) => download.variant === undefined || download.variant === "default")
    .filter((download) => download.version && isStableVersion(download.version))
    .filter((download) => satisfiesVersion(download.version ?? "", request.requested))
    .sort((left, right) => compareVersionStrings(right.version ?? "", left.version ?? ""))[0];
  if (!selected?.version) {
    throw new Error(
      `no downloadable Python release satisfies ${request.runtime} ${request.requested} for ${request.platform}`,
    );
  }
  return selected.version;
}

function isRangeLikeVersionRequest(requested: string): boolean {
  return /[<>=]|\s/u.test(requested.trim());
}

function isStableVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/u.test(version);
}

function compareVersionStrings(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (const index of [0, 1, 2]) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    const delta = leftPart - rightPart;
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }
  return 0;
}

function versionParts(version: string): [number, number, number] {
  const match = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/u);
  if (!match) {
    throw new Error(`invalid Python version \`${version}\``);
  }
  return [
    Number.parseInt(match[1] ?? "0", 10),
    Number.parseInt(match[2] ?? "0", 10),
    Number.parseInt(match[3] ?? "0", 10),
  ];
}

function readBunReleases(): BunRelease[] {
  const url =
    process.env.OPENDOCK_BUN_RELEASES_URL ??
    "https://api.github.com/repos/oven-sh/bun/releases?per_page=100";
  return JSON.parse(runChecked(resolveDownloader(), ["-fsSL", url]).stdout) as BunRelease[];
}

function readUvReleases(): UvRelease[] {
  const url =
    process.env.OPENDOCK_UV_RELEASES_URL ??
    "https://api.github.com/repos/astral-sh/uv/releases?per_page=100";
  return JSON.parse(runChecked(resolveDownloader(), ["-fsSL", url]).stdout) as UvRelease[];
}

function readNodeIndex(): NodeRelease[] {
  const indexUrl = process.env.OPENDOCK_NODE_DIST_INDEX_URL ?? "https://nodejs.org/dist/index.json";
  const output = runChecked(resolveDownloader(), ["-fsSL", indexUrl]).stdout;
  const parsed = JSON.parse(output) as NodeRelease[];
  return parsed;
}

function ensureBunDistribution(tag: string, version: string, archive: BunPlatformArchive): string {
  const runtimeDir = sharedRuntimeInstallDir("bun", version);
  if (existsSync(runtimeDir) && findBunExecutable(runtimeDir, false)) {
    return runtimeDir;
  }
  const runtimeParent = dirname(runtimeDir);
  ensureRealDirectory(runtimeParent, "runtime install directory");
  const workRoot = mkdtempSync(join(tmpdir(), "opendock-bun-runtime-"));
  const archivePath = join(workRoot, archive.archiveName);
  try {
    const baseUrl =
      process.env.OPENDOCK_BUN_DIST_BASE_URL ?? "https://github.com/oven-sh/bun/releases/download";
    const url = `${baseUrl}/${tag}/${archive.archiveName}`;
    runChecked(resolveDownloader(), ["-fsSL", url, "-o", archivePath]);
    extractArchive(archivePath, workRoot, "zip");
    const extractedRoot = join(workRoot, basename(archive.archiveName).replace(/\.zip$/u, ""));
    if (!existsSync(extractedRoot)) {
      throw new Error(`downloaded Bun archive did not contain ${basename(extractedRoot)}`);
    }
    rmSync(runtimeDir, { force: true, recursive: true });
    renameSync(extractedRoot, runtimeDir);
  } finally {
    rmSync(workRoot, { force: true, recursive: true });
  }
  return runtimeDir;
}

function ensureNodeDistribution(version: string, archive: NodePlatformArchive): string {
  const nodeVersion = stripVersionPrefix(version);
  const runtimeDir = sharedRuntimeInstallDir("node", nodeVersion);
  const expectedExecutable =
    archive.executableDir === "bin"
      ? join(runtimeDir, "bin", "node")
      : join(runtimeDir, "node.exe");
  if (existsSync(expectedExecutable)) {
    return runtimeDir;
  }

  const runtimeParent = dirname(runtimeDir);
  ensureRealDirectory(runtimeParent, "runtime install directory");
  const workRoot = mkdtempSync(join(tmpdir(), "opendock-node-runtime-"));
  const archivePath = join(workRoot, archive.archiveName);
  try {
    const baseUrl = process.env.OPENDOCK_NODE_DIST_BASE_URL ?? "https://nodejs.org/dist";
    const url = `${baseUrl}/${version}/${archive.archiveName}`;
    runChecked(resolveDownloader(), ["-fsSL", url, "-o", archivePath]);
    extractArchive(archivePath, workRoot, archive.compression);
    const extractedRoot = join(
      workRoot,
      basename(archive.archiveName).replace(/\.tar\.gz$|\.tar\.xz$|\.zip$/u, ""),
    );
    if (!existsSync(extractedRoot)) {
      throw new Error(`downloaded Node.js archive did not contain ${basename(extractedRoot)}`);
    }
    rmSync(runtimeDir, { force: true, recursive: true });
    renameSync(extractedRoot, runtimeDir);
  } finally {
    rmSync(workRoot, { force: true, recursive: true });
  }
  return runtimeDir;
}

function ensureUvDistribution(tag: string, version: string, archive: UvPlatformArchive): string {
  const runtimeDir = sharedRuntimeInstallDir("uv", version);
  if (existsSync(runtimeDir) && findUvExecutable(runtimeDir, false)) {
    return runtimeDir;
  }
  const runtimeParent = dirname(runtimeDir);
  ensureRealDirectory(runtimeParent, "runtime install directory");
  const workRoot = mkdtempSync(join(tmpdir(), "opendock-uv-runtime-"));
  const archivePath = join(workRoot, archive.archiveName);
  try {
    const baseUrl =
      process.env.OPENDOCK_UV_DIST_BASE_URL ?? "https://github.com/astral-sh/uv/releases/download";
    const url = `${baseUrl}/${tag}/${archive.archiveName}`;
    runChecked(resolveDownloader(), ["-fsSL", url, "-o", archivePath]);
    extractArchive(archivePath, workRoot, archive.compression);
    const uvSource = findUvExecutable(workRoot);
    const extractedRoot = dirname(uvSource);
    rmSync(runtimeDir, { force: true, recursive: true });
    renameSync(extractedRoot, runtimeDir);
  } finally {
    rmSync(workRoot, { force: true, recursive: true });
  }
  return runtimeDir;
}

function bunPlatformArchive(platform: OpenDockPlatform): BunPlatformArchive {
  if (platform === "macos") {
    return {
      archiveName: process.arch === "arm64" ? "bun-darwin-aarch64.zip" : "bun-darwin-x64.zip",
    };
  }
  if (platform === "linux") {
    return {
      archiveName: process.arch === "arm64" ? "bun-linux-aarch64.zip" : "bun-linux-x64.zip",
    };
  }
  if (process.arch !== "x64") {
    throw new Error(`managed Bun runtime is not available for Windows ${process.arch}`);
  }
  return { archiveName: "bun-windows-x64.zip" };
}

function uvPlatformArchive(platform: OpenDockPlatform): UvPlatformArchive {
  const arch = uvArch();
  if (platform === "macos") {
    return {
      archiveName: `uv-${arch}-apple-darwin.tar.gz`,
      compression: "tar-gz",
    };
  }
  if (platform === "linux") {
    return {
      archiveName: `uv-${arch}-unknown-linux-gnu.tar.gz`,
      compression: "tar-gz",
    };
  }
  return {
    archiveName: `uv-${arch}-pc-windows-msvc.zip`,
    compression: "zip",
  };
}

function nodePlatformArchive(platform: OpenDockPlatform): NodePlatformArchive {
  const arch = nodeArch();
  if (platform === "macos") {
    return {
      archiveName: `node-VERSION-darwin-${arch}.tar.gz`,
      compression: "tar-gz",
      executableDir: "bin",
      fileKey: `osx-${arch}-tar`,
    };
  }
  if (platform === "linux") {
    return {
      archiveName: `node-VERSION-linux-${arch}.tar.xz`,
      compression: "tar-xz",
      executableDir: "bin",
      fileKey: `linux-${arch}`,
    };
  }
  return {
    archiveName: `node-VERSION-win-${arch}.zip`,
    compression: "zip",
    executableDir: "root",
    fileKey: `win-${arch}-zip`,
  };
}

function nodeArch(): string {
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";
  throw new Error(`unsupported CPU architecture for managed Node.js runtime: ${process.arch}`);
}

function uvArch(): string {
  if (process.arch === "arm64") return "aarch64";
  if (process.arch === "x64") return "x86_64";
  if (process.arch === "ia32") return "i686";
  throw new Error(`unsupported CPU architecture for managed uv runtime: ${process.arch}`);
}

function archiveNameForVersion(archive: NodePlatformArchive, version: string): NodePlatformArchive {
  return { ...archive, archiveName: archive.archiveName.replace("VERSION", version) };
}

function extractArchive(
  archivePath: string,
  destination: string,
  compression: NodePlatformArchive["compression"],
): void {
  if (compression === "zip") {
    if (process.platform !== "win32") {
      runChecked("unzip", ["-q", archivePath, "-d", destination]);
      return;
    }
    runChecked(resolvePowerShellCommand(), [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(
        destination,
      )} -Force`,
    ]);
    return;
  }
  runChecked("tar", [compression === "tar-xz" ? "-xJf" : "-xzf", archivePath, "-C", destination]);
}

function findUvExecutable(root: string, required = true): string {
  const executableName = process.platform === "win32" ? "uv.exe" : "uv";
  const stack = [root];
  for (const directory of stack) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && entry.name === executableName) {
        return path;
      }
    }
  }
  if (required) {
    throw new Error(`managed uv runtime did not contain ${executableName}`);
  }
  return "";
}

function findBunExecutable(root: string, required = true): string {
  const executableName = process.platform === "win32" ? "bun.exe" : "bun";
  const stack = [root];
  for (const directory of stack) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && entry.name === executableName) {
        return path;
      }
    }
  }
  if (required) {
    throw new Error(`managed Bun runtime did not contain ${executableName}`);
  }
  return "";
}

function prepareUvCommand(request: RuntimeInstallRequest): string {
  const hostUv = resolveCommandPath("uv", request.projectDir);
  if (hostUv) {
    const versionOutput = runChecked(hostUv, ["--version"]);
    const version = extractRequiredVersion(versionOutput.stdout || versionOutput.stderr, "uv");
    if (satisfiesVersion(version, DEFAULT_UV_RUNTIME_RANGE)) {
      return hostUv;
    }
  }
  const managedUv = installUvRuntime({
    ...request,
    requested: DEFAULT_UV_RUNTIME_RANGE,
    runtime: "uv",
  });
  const target = managedUv.targets.uv;
  if (!target) {
    throw new Error("managed uv runtime did not provide command `uv`");
  }
  return target;
}

function createExecutableWrapper(
  target: string,
  platform: OpenDockPlatform,
  executable: string,
  prefixArgs: string[] = [],
  pathEntries: string[] = [],
): string {
  ensureRealDirectory(dirname(target), "runtime bin directory");
  if (platform === "windows") {
    const cmdTarget = `${target}.cmd`;
    assertRuntimeWrapperWritable(cmdTarget);
    const args = prefixArgs.map(windowsQuote).join(" ");
    const prefix = args ? ` ${args}` : "";
    const pathLine =
      pathEntries.length > 0
        ? `set "PATH=${pathEntries.map(windowsPathEntry).join(";")};%PATH%"\r\n`
        : "";
    writeFileSync(cmdTarget, `@echo off\r\n${pathLine}"${executable}"${prefix} %*\r\n`);
    return cmdTarget;
  }
  assertRuntimeWrapperWritable(target);
  const args = prefixArgs.map(shellQuote).join(" ");
  const prefix = args ? ` ${args}` : "";
  const pathPrefix =
    pathEntries.length > 0
      ? `PATH=${pathEntries.map(shellQuote).join(":")}:$PATH\nexport PATH\n`
      : "";
  writeFileSync(
    target,
    `#!/usr/bin/env sh\n${pathPrefix}exec ${shellQuote(executable)}${prefix} "$@"\n`,
    {
      mode: 0o755,
    },
  );
  return target;
}

function resolveDownloader(): string {
  const curl = resolveCommandPath("curl", process.cwd());
  if (!curl) {
    throw new Error("curl is required to download managed runtimes");
  }
  return curl;
}

function resolvePowerShellCommand(): string {
  return resolveCommandPath("powershell", process.cwd()) ?? "powershell";
}

function resolveCommandPath(command: string, projectDir: string): string | undefined {
  const pathValue = opendockCommandPath(process.env.PATH) ?? "";
  const ignoredRuntimeRoot = resolve(sharedRuntimeRoot());
  const ignoredProjectBin = resolve(projectDir, ".opendock", "bin");
  for (const entry of pathValue.split(process.platform === "win32" ? ";" : ":")) {
    if (!entry) continue;
    const directory = resolve(entry);
    if (
      directory === ignoredRuntimeRoot ||
      directory.startsWith(`${ignoredRuntimeRoot}${process.platform === "win32" ? "\\" : "/"}`) ||
      directory === ignoredProjectBin
    ) {
      continue;
    }
    for (const candidate of commandCandidates(directory, command)) {
      if (existsSync(candidate)) {
        return resolve(candidate);
      }
    }
  }
  return undefined;
}

function commandCandidates(directory: string, command: string): string[] {
  if (process.platform === "win32") {
    return [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`].map((name) =>
      join(directory, name),
    );
  }
  return [join(directory, command)];
}

function runChecked(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): { stderr: string; stdout: string } {
  const env = { ...process.env, ...(options.env ?? {}) };
  const pathValue = opendockCommandPath(env.PATH);
  if (pathValue) {
    env.PATH = pathValue;
  }
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    maxBuffer: runtimeCommandMaxBuffer,
    stdio: "pipe",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const message = stderr || stdout || `${command} exited with status ${result.status}`;
    throw new Error(message);
  }
  return { stderr: result.stderr ?? "", stdout: result.stdout ?? "" };
}

function uvPythonEnvironment(): NodeJS.ProcessEnv {
  const root = sharedRuntimeRoot();
  return {
    UV_PYTHON_BIN_DIR: join(root, "python", "_uv", "bin"),
    UV_PYTHON_CACHE_DIR: join(root, "python", "_uv", "cache"),
    UV_PYTHON_INSTALL_BIN: "1",
    UV_PYTHON_INSTALL_DIR: join(root, "python", "_uv", "installations"),
    UV_PYTHON_NO_REGISTRY: "1",
    PIP_BREAK_SYSTEM_PACKAGES: "1",
  };
}

function pipPackageSpec(versionRequest: string): string {
  const requested = versionRequest.trim();
  if (!requested || requested === "*" || requested === "latest") {
    return "pip";
  }
  if (isRangeLikeVersionRequest(requested)) {
    return `pip${requested.split(/\s+/u).join(",")}`;
  }
  return `pip==${requested}`;
}

function extractRequiredVersion(output: string, label: string): string {
  const match = output.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/u);
  if (!match) {
    throw new Error(`could not read ${label} version from ${output.trim()}`);
  }
  return match[0] ?? "";
}

function stripVersionPrefix(version: string): string {
  return version.replace(/^v/u, "");
}

function bunVersionFromTag(tag: string): string | undefined {
  return tag.match(/^bun-v(.+)$/u)?.[1];
}

function uvVersionFromTag(tag: string): string | undefined {
  return tag.match(/^v?(.+)$/u)?.[1];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function windowsQuote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function windowsPathEntry(value: string): string {
  return value.replaceAll("%", "%%");
}

function ensureRealDirectory(path: string, label: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of relative(root, absolute)
    .split(/[/\\]+/)
    .filter(Boolean)) {
    current = join(current, part);
    const stat = lstatIfPresent(current);
    if (!stat) {
      mkdirSync(current);
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} cannot be a symlink: ${path}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${label} must be a directory: ${path}`);
    }
  }
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function assertRuntimeWrapperWritable(path: string): void {
  const stat = lstatIfPresent(path);
  if (!stat) {
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`runtime wrapper cannot be a symlink: ${path}`);
  }
  if (!stat.isFile()) {
    throw new Error(`runtime wrapper path must be a file: ${path}`);
  }
}
