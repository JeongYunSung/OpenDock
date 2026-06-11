#!/usr/bin/env bun
import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { c as createTar } from "tar";
import { TokenStore } from "./auth.js";
import { bootstrapMac } from "./bootstrap.js";
import { performBrowserLogin } from "./browser-auth.js";
import { DEFAULT_REGISTRY_URL, SCHEMA_VERSION, VERSION } from "./constants.js";
import { DockInstaller, type InstallReport } from "./core/app/dock-installer.js";
import {
  type DockManifest,
  DockRef,
  parseManifestFile,
  validateManifestFor,
} from "./core/domain/manifest.js";
import { OpenDockStateStore } from "./core/domain/state-store.js";
import { LifecycleRunner } from "./core/runtime/lifecycle-runner.js";
import { readProjectLogs } from "./logging.js";
import {
  detectPlatform,
  type OpenDockPlatform,
  type OpenDockReleasePlatform,
  parsePlatform,
  parseReleasePlatform,
} from "./platform.js";
import {
  OpenDockRegistryClient,
  RegistryRequestError,
  type SubmissionLogoRequest,
  type SubmissionRequest,
  type SubmissionResponse,
} from "./registry.js";
import { type ResolvedDock, resolveDock, resolveLatestDock } from "./resolver.js";

const maxDeployReadmeBytes = 64 * 1024;
const maxDeployLogoBytes = 512 * 1024;
const maxDeployManifestBytes = 64 * 1024;
const maxDeployArchiveBytes = 50 * 1024 * 1024;

export async function run(argv = process.argv): Promise<void> {
  const program = new Command();
  const installer = new DockInstaller();
  program
    .name("opendock")
    .description("Install, update, doctor, and deploy OpenDock docks.")
    .version(VERSION);

  program
    .command("install")
    .description("Install an approved dock into the current directory.")
    .argument("<dock>", "Dock reference: owner/name@version")
    .option("--force", "Overwrite user-edited managed files")
    .option("--platform <platform>", "Target platform: macos, windows, or linux")
    .action(async (dock: string, options: { force?: boolean; platform?: string }) => {
      const platform = resolveCliPlatform(options.platform);
      const report = await installer.install({
        dockRef: parseInstallRef(dock),
        force: options.force === true,
        projectDir: process.cwd(),
        runCommands: true,
        operation: "install",
        phase: "install",
        platform,
      });
      console.log(
        `Installed ${report.dockId}@${report.version} for ${report.platform} (${formatFileSummary(report)})`,
      );
    });

  program
    .command("update")
    .description("Update the dock installed in the current directory.")
    .option("--force", "Overwrite user-edited managed files")
    .option("--platform <platform>", "Override the platform recorded in .opendock/dock.lock.yml")
    .action(async (options: { force?: boolean; platform?: string }) => {
      const platformOverride =
        options.platform === undefined ? undefined : resolveCliPlatform(options.platform);
      const store = new OpenDockStateStore(process.cwd());
      if (!store.hasState()) {
        throw new Error(".opendock/dock.lock.yml missing");
      }
      const installedDocks = store.readLock().docks;
      if (installedDocks.length === 0) {
        throw new Error("no OpenDock docks are installed in this project");
      }
      for (const dock of installedDocks) {
        const platform = platformOverride ?? resolveCliPlatform(dock.platform);
        const latest = await resolveLatestDockRef(dock.id, platform);
        const dockRef = DockRef.parse(`${dock.id}@${latest.version}`);
        const report = await installer.install({
          dockRef,
          force: options.force === true,
          projectDir: process.cwd(),
          runCommands: true,
          operation: "update",
          phase: "update",
          platform,
          resolve: () => latest,
        });
        if (dock.version === report.version) {
          console.log(
            `Updated ${dock.id} at latest ${report.version} for ${report.platform} (${formatFileSummary(report)})`,
          );
        } else {
          console.log(
            `Updated ${dock.id}: ${dock.version} -> ${report.version} for ${report.platform} (${formatFileSummary(report)})`,
          );
        }
      }
    });

  program
    .command("uninstall")
    .description("Remove an installed dock from the current directory.")
    .argument("<dock>", "Installed dock id: owner/name")
    .option("--force", "Remove OpenDock-managed files even when edited managed files are detected")
    .action((dock: string, options: { force?: boolean }) => {
      const report = installer.uninstall({
        dockId: parseInstalledDockId(dock),
        force: options.force === true,
        projectDir: process.cwd(),
      });
      console.log(
        `Uninstalled ${report.dockId} (${report.filesDeleted} files deleted, ${report.filesUpdated} files updated)`,
      );
    });

  program
    .command("doctor")
    .description("Diagnose the current directory's OpenDock state.")
    .option("--platform <platform>", "Override the platform recorded in .opendock/dock.lock.yml")
    .action(async (options: { platform?: string }) => {
      await printDoctor(process.cwd(), options.platform);
    });

  program
    .command("log")
    .description("Show recent OpenDock logs for the current directory.")
    .action(() => {
      const logs = readProjectLogs(process.cwd());
      if (logs.length === 0) {
        console.log("No OpenDock logs for this project.");
        return;
      }
      for (const log of logs.slice(-20)) {
        console.log(`${log.timestamp} ${log.status} ${log.command} ${log.message}`);
      }
    });

  program
    .command("version")
    .description("Show CLI, schema, and registry information.")
    .action(() => {
      console.log(`opendock ${VERSION}`);
      console.log(`schema ${SCHEMA_VERSION}`);
      console.log(`registry ${DEFAULT_REGISTRY_URL}`);
    });

  const bootstrap = program.command("bootstrap").description("Prepare first-party host tools.");
  bootstrap
    .command("mac")
    .description("Install or verify Homebrew for macOS docks.")
    .option("-y, --yes", "Run the official Homebrew installer without OpenDock confirmation")
    .action(async (options: { yes?: boolean }) => {
      await bootstrapMac({ assumeYes: options.yes === true });
    });

  const auth = program.command("auth").description("Authenticate with OpenDock Registry.");
  auth
    .command("login")
    .description("Log in to OpenDock Registry.")
    .option("--token <token>", "Existing CLI token to store without opening a browser")
    .action(async (options: { token?: string }) => {
      const tokenStore = new TokenStore();
      if (options.token) {
        await tokenStore.saveToken(options.token);
        console.log("Logged in to OpenDock Registry.");
        return;
      }
      await performBrowserLogin({ tokenStore });
    });
  auth
    .command("status")
    .description("Show the current OpenDock Registry login.")
    .action(async () => {
      const token = new TokenStore().loadToken();
      if (!token) {
        console.log("Not logged in.");
        return;
      }
      const user = await new OpenDockRegistryClient().currentUser(token);
      console.log(`Logged in as ${user.email}.`);
    });
  auth
    .command("logout")
    .description("Log out of OpenDock Registry on this machine.")
    .action(async () => {
      const tokenStore = new TokenStore();
      const token = tokenStore.loadToken();
      if (token) {
        try {
          await new OpenDockRegistryClient().logout(token);
        } catch (error) {
          if (!(error instanceof RegistryRequestError && error.status === 401)) {
            throw error;
          }
        }
      }
      tokenStore.clearToken();
      console.log("Logged out of OpenDock Registry.");
    });

  program
    .command("deploy")
    .description("Submit a dock to OpenDock Registry for review.")
    .argument("<dock>", "Dock release reference: owner/name@version")
    .option("--platform <platform>", "Release platform: any, macos, windows, or linux", "any")
    .option("--file <path>", "Manifest file to submit as dock.yml", "dock.yml")
    .action(async (dockName: string, options: { platform: string; file: string }) => {
      const dockRef = parseDeployRef(dockName);
      const releasePlatform = resolveDeployPlatform(options.platform);
      const manifestPath = resolveDeployManifest(process.cwd(), options.file);
      const deployRoot = dirname(manifestPath);
      const manifest = readFileSync(manifestPath, "utf8");
      const parsedManifest = parseManifestFile(manifestPath);
      validateManifestFor(parsedManifest, dockRef);
      const readmeMarkdown = readDeployReadme(deployRoot, parsedManifest);
      const logo = readDeployLogo(deployRoot, parsedManifest);
      const archive = await createDeployArchive(
        deployRoot,
        parsedManifest,
        dockRef.requested(),
        releasePlatform,
        manifest,
      );
      const client = new OpenDockRegistryClient();
      const request = {
        dock_name: dockRef.id(),
        version: dockRef.requested(),
        platform: releasePlatform,
        manifest,
        archive,
        ...(readmeMarkdown === undefined ? {} : { readme_markdown: readmeMarkdown }),
        ...(logo === undefined ? {} : { logo }),
      };
      const response = await submitDockWithLogin(client, new TokenStore(), request);
      console.log(
        `Submitted ${dockRef} [${releasePlatform}] for review: ${response.id} (${response.status})`,
      );
    });

  await program.parseAsync(argv);
}

function parseDeployRef(value: string): DockRef {
  if (!value.includes("@")) {
    throw new Error(
      "deploy reference must use owner/name@version with an exact version identifier, e.g. opendock/oma@1.0.0",
    );
  }
  const dockRef = DockRef.parse(value);
  return dockRef;
}

function parseInstallRef(value: string): DockRef {
  if (!value.includes("@")) {
    throw new Error(
      "install reference must use owner/name@version with an exact version identifier, e.g. opendock/codex@1.0.0",
    );
  }
  return DockRef.parse(value);
}

function parseInstalledDockId(value: string): string {
  const parts = value.trim().split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("dock id must be in owner/name form");
  }
  return `${parts[0]}/${parts[1]}`;
}

async function resolveLatestDockRef(
  dockId: string,
  platform: OpenDockPlatform,
): Promise<ResolvedDock> {
  const [owner, name, extra] = dockId.split("/");
  if (!owner || !name || extra !== undefined) {
    throw new Error(`invalid dock id in lock file: ${dockId}`);
  }
  return resolveLatestDock(owner, name, platform);
}

function lockedDockVersionSelector(dock: { requested?: string; version: string }): string {
  const requested = dock.requested?.trim();
  if (requested !== undefined && requested !== "" && requested !== "latest") {
    return requested;
  }
  return dock.version;
}

function readDeployReadme(projectDir: string, manifest: DockManifest): string | undefined {
  if (manifest.readme === undefined) {
    return undefined;
  }
  return readFileSync(
    resolveDeployFile(projectDir, manifest.readme, "readme", maxDeployReadmeBytes),
    "utf8",
  );
}

function readDeployLogo(
  projectDir: string,
  manifest: DockManifest,
): SubmissionLogoRequest | undefined {
  if (manifest.logo === undefined) {
    return undefined;
  }

  const logoPath = resolveDeployFile(projectDir, manifest.logo, "logo", maxDeployLogoBytes);
  const logoBytes = readFileSync(logoPath);
  const contentType = logoContentType(logoPath);
  validateLogoSignature(contentType, logoBytes);
  return {
    filename: basename(logoPath),
    content_type: contentType,
    data_base64: logoBytes.toString("base64"),
  };
}

function resolveDeployFile(
  projectDir: string,
  relativePathValue: string,
  manifestField: "logo" | "manifest" | "readme",
  maxBytes: number,
): string {
  const relativePath = relativePathValue.trim();
  if (relativePath === "") {
    throw new Error(`manifest \`${manifestField}\` path cannot be empty`);
  }

  const root = realpathSync(projectDir);
  const candidate = resolve(root, relativePath);
  const realCandidate = realpathSync(candidate);
  assertInsideDeployRoot(root, realCandidate, manifestField);

  const stats = statSync(realCandidate);
  if (!stats.isFile()) {
    throw new Error(`manifest \`${manifestField}\` path must point to a file`);
  }
  if (manifestField === "logo" && stats.size === 0) {
    throw new Error("manifest `logo` file cannot be empty");
  }
  if (stats.size > maxBytes) {
    throw new Error(`manifest \`${manifestField}\` file exceeds ${maxBytes} bytes`);
  }

  return realCandidate;
}

function assertInsideDeployRoot(root: string, candidate: string, field: string): void {
  const rel = relative(root, candidate);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${"/"}`) ||
    rel.startsWith(`..${"\\"}`)
  ) {
    throw new Error(`manifest \`${field}\` path must stay inside the dock directory`);
  }
}

function normalizeDeployPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    normalized === "" ||
    normalized === "." ||
    normalized === ".." ||
    isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`unsafe deploy archive path: ${value}`);
  }
  return normalized;
}

function logoContentType(path: string): SubmissionLogoRequest["content_type"] {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      throw new Error("manifest `logo` path must point to a png, jpg, jpeg, or webp file");
  }
}

function validateLogoSignature(
  contentType: SubmissionLogoRequest["content_type"],
  bytes: Buffer,
): void {
  const valid =
    contentType === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : contentType === "image/jpeg"
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : bytes.length >= 12 &&
          bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
          bytes.subarray(8, 12).toString("ascii") === "WEBP";

  if (!valid) {
    throw new Error("manifest `logo` bytes do not match file type");
  }
}

async function createDeployArchive(
  projectDir: string,
  manifest: DockManifest,
  version: string,
  platform: OpenDockReleasePlatform,
  manifestText: string,
): Promise<SubmissionRequest["archive"]> {
  const entries = collectDeployArchiveEntries(projectDir, manifest);
  const temp = mkdtempSync(join(tmpdir(), "opendock-deploy-"));
  const stage = join(temp, "stage");
  const archivePath = join(temp, "dock.tgz");
  try {
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "dock.yml"), manifestText);
    for (const entry of entries.filter((entry) => entry !== "dock.yml")) {
      const source = join(projectDir, entry);
      const target = join(stage, entry);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    await createTar(
      {
        cwd: stage,
        file: archivePath,
        gzip: true,
        noMtime: true,
        portable: true,
        strict: true,
      },
      entries,
    );
    const stats = statSync(archivePath);
    if (stats.size > maxDeployArchiveBytes) {
      throw new Error(`dock archive exceeds ${maxDeployArchiveBytes} bytes`);
    }
    const bytes = readFileSync(archivePath);
    return {
      filename: `${manifest.id.replace("/", "-")}-${version}-${platform}.tgz`,
      content_type: "application/gzip",
      data_base64: bytes.toString("base64"),
      checksum: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    rmSync(temp, { force: true, recursive: true });
  }
}

function collectDeployArchiveEntries(projectDir: string, manifest: DockManifest): string[] {
  const roots = new Set<string>();
  for (const file of manifest.files) {
    roots.add(file.from);
  }

  const entries = new Set<string>(["dock.yml"]);
  for (const root of roots) {
    for (const entry of expandDeployArchiveRoot(projectDir, root)) {
      entries.add(entry);
    }
  }
  return [...entries].sort();
}

function expandDeployArchiveRoot(projectDir: string, relativePathValue: string): string[] {
  const rel = normalizeDeployPath(relativePathValue);
  const path = resolveDeployFileOrDirectory(projectDir, rel);
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) {
    throw new Error(`deploy archive entry cannot be a symlink: ${rel}`);
  }
  if (stats.isFile()) {
    return [rel];
  }
  if (!stats.isDirectory()) {
    throw new Error(`deploy archive entry must be a regular file or directory: ${rel}`);
  }
  return listDeployDirectoryFiles(projectDir, path);
}

function listDeployDirectoryFiles(projectDir: string, root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    const rel = normalizeDeployPath(relative(projectDir, path));
    if (entry.isSymbolicLink()) {
      throw new Error(`deploy archive entry cannot be a symlink: ${rel}`);
    }
    if (entry.isDirectory()) {
      files.push(...listDeployDirectoryFiles(projectDir, path));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`deploy archive entry must be a regular file: ${rel}`);
    }
    files.push(rel);
  }
  return files;
}

function resolveDeployFileOrDirectory(projectDir: string, relativePathValue: string): string {
  const root = realpathSync(projectDir);
  const candidate = resolve(root, relativePathValue);
  if (lstatSync(candidate).isSymbolicLink()) {
    throw new Error(`deploy archive entry cannot be a symlink: ${relativePathValue}`);
  }
  const realCandidate = realpathSync(candidate);
  assertInsideDeployRoot(root, realCandidate, "archive entry");
  return realCandidate;
}

function resolveCliPlatform(value: string | undefined): OpenDockPlatform {
  return value === undefined ? detectPlatform() : parsePlatform(value);
}

function resolveDeployPlatform(value: string): OpenDockReleasePlatform {
  return parseReleasePlatform(value);
}

function resolveDeployManifest(projectDir: string, relativePathValue: string): string {
  return resolveDeployFile(projectDir, relativePathValue, "manifest", maxDeployManifestBytes);
}

function formatFileSummary(report: InstallReport): string {
  return `${report.filesCreated} files created, ${report.filesUpdated} files updated, ${report.filesDeleted} files deleted, ${report.filesReviewRequired} review required`;
}

async function submitDockWithLogin(
  client: OpenDockRegistryClient,
  tokenStore: TokenStore,
  request: SubmissionRequest,
): Promise<SubmissionResponse> {
  let token = await loadOrLoginToken(client, tokenStore);
  try {
    return await client.submitDock(request, token);
  } catch (error) {
    if (!(error instanceof RegistryRequestError && error.status === 401)) {
      throw error;
    }
    tokenStore.clearToken();
    token = (await performBrowserLogin({ client, tokenStore })).token;
    return client.submitDock(request, token);
  }
}

async function loadOrLoginToken(
  client: OpenDockRegistryClient,
  tokenStore: TokenStore,
): Promise<string> {
  const token = tokenStore.loadToken();
  if (token) {
    return token;
  }
  return (await performBrowserLogin({ client, tokenStore })).token;
}

async function printDoctor(cwd: string, platformOverride?: string): Promise<void> {
  console.log("OpenDock Doctor");
  console.log(`Project: ${cwd}`);

  const store = new OpenDockStateStore(cwd);
  if (store.hasState()) {
    console.log("Status: Ready");
    console.log("Checks:");
    console.log("✓ .opendock/project.yml");
    console.log("✓ .opendock/dock.lock.yml");
    const lock = store.readLock();
    for (const dock of lock.docks) {
      const platform = resolveCliPlatform(platformOverride ?? dock.platform);
      console.log(`✓ ${dock.id}@${dock.version} [${platform}]`);
      await printDockDoctorChecks(
        cwd,
        DockRef.parse(`${dock.id}@${lockedDockVersionSelector(dock)}`),
        platform,
      );
    }
  } else {
    console.log("Status: Not installed");
    console.log("Checks:");
    console.log("! .opendock/project.yml missing");
    console.log("! .opendock/dock.lock.yml missing");
  }
}

async function printDockDoctorChecks(
  cwd: string,
  dockRef: DockRef,
  platform: OpenDockPlatform,
): Promise<void> {
  try {
    const resolved = await resolveDock(dockRef, platform);
    const reports = new LifecycleRunner().run(resolved.manifest, {
      projectDir: cwd,
      dockId: resolved.manifest.id,
      phase: "doctor",
      platform,
    }).reports;
    for (const report of reports) {
      const symbol = report.status === "Failed" ? "!" : "✓";
      const suffix = report.message ? ` (${report.message})` : "";
      console.log(`${symbol} ${report.id}${suffix}`);
    }
  } catch (error) {
    console.log(`! ${dockRef.id()} doctor checks unavailable: ${(error as Error).message}`);
  }
}

if (isMainModule()) {
  run().catch((error: unknown) => {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined) {
    return false;
  }
  try {
    return realpathSync(entrypoint) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
