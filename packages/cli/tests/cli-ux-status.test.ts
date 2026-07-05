import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import type { OpenDockPlatform } from "../src/platform.js";
import { paint, supportsTerminalColor } from "../src/terminal-style.js";
import { testReleaseSignature } from "./release-signature-helper.js";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cliBinaryPath = join(packageDir, "bin", "opendock");
const cliEntrypointPath = existsSync(cliBinaryPath)
  ? cliBinaryPath
  : join(packageDir, "src", "cli.ts");
const escapeCharacter = String.fromCharCode(27);
const ansiPattern = new RegExp(`${escapeCharacter}\\[[0-9;]*m`, "g");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("opendock CLI user-visible UX", () => {
  it("prints install status counts and changed file paths without ANSI in piped output", async () => {
    const fixture = createFixture();
    writeFileSync(join(fixture.project, "AGENTS.md"), "# Project Notes\n");
    mkdirSync(join(fixture.project, "config"), { recursive: true });
    writeFileSync(join(fixture.project, "config", "settings.json"), "{}\n");
    writeDock(fixture.docks, "test", "ux", "1.0.0", {
      files: [
        { path: "AGENTS.md", content: "# UX Agent\n" },
        { path: "config/settings.json", content: '{ "enabled": true }\n' },
        { path: ".codex/agents/ux.toml", content: 'name = "ux"\n' },
      ],
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "ux", "1.0.0", "macos"),
    ]);

    const result = runCli(fixture, ["install", "test/ux@1.0.0", "--platform", "macos", "--force"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toMatch(ansiPattern);
    expect(result.stdout).toContain("Installed test/ux@1.0.0 for macos");
    expect(result.stdout).toContain("1 files created");
    expect(result.stdout).toContain("2 files updated");
    expect(result.stdout).toContain("0 files deleted");
    expect(result.stdout).toContain("0 review required");
    expect(result.stdout).toContain("Files:");
    expect(result.stdout).toContain("+ .codex/agents/ux.toml");
    expect(result.stdout).toContain("~ AGENTS.md");
    expect(result.stdout).toContain("~ config/settings.json");
  });

  it("prints update additions, changes, deletions, and no-update status clearly", async () => {
    const fixture = createFixture();
    writeDock(fixture.docks, "test", "agent", "1.0.0", {
      files: [
        { path: ".codex/agents/old.toml", content: 'name = "old"\n' },
        { path: ".codex/agents/shared.toml", content: 'name = "shared-v1"\n' },
      ],
    });
    writeDock(fixture.docks, "test", "agent", "1.0.1", {
      files: [
        { path: ".codex/agents/new.toml", content: 'name = "new"\n' },
        { path: ".codex/agents/shared.toml", content: 'name = "shared-v2"\n' },
      ],
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "agent", "1.0.0", "macos"),
      await registryRelease(fixture.docks, "test", "agent", "1.0.1", "macos", { latest: true }),
    ]);

    const install = runCli(fixture, ["install", "test/agent@1.0.0", "--platform", "macos"]);
    expect(install.status).toBe(0);

    const update = runCli(fixture, ["update"]);
    expect(update.status).toBe(0);
    expect(update.stderr).toBe("");
    expect(update.stdout).toContain("Updated test/agent: 1.0.0 -> 1.0.1 for macos");
    expect(update.stdout).toContain("1 files created");
    expect(update.stdout).toContain("1 files updated");
    expect(update.stdout).toContain("1 files deleted");
    expect(update.stdout).toContain("+ .codex/agents/new.toml");
    expect(update.stdout).toContain("~ .codex/agents/shared.toml");
    expect(update.stdout).toContain("- .codex/agents/old.toml");

    const noUpdates = runCli(fixture, ["update"]);
    expect(noUpdates.status).toBe(0);
    expect(noUpdates.stderr).toBe("");
    expect(noUpdates.stdout.trim()).toBe("No OpenDock dock updates available.");
  });

  it("lists installed docks by version and platform without exposing workdir paths", async () => {
    const fixture = createFixture();
    writeDock(fixture.docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer\n" }],
      workdirFiles: [
        { path: "workdir/private-note.md", to: "private-note.md", content: "draft\n" },
      ],
    });
    writeDock(fixture.docks, "test", "frontend", "2.1.0", {
      files: [{ path: ".codex/agents/frontend.toml", content: 'name = "frontend"\n' }],
      workdirFiles: [{ path: "workdir/script.mjs", to: "script.mjs", content: "export {}\n" }],
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "designer", "1.0.0", "macos"),
      await registryRelease(fixture.docks, "test", "frontend", "2.1.0", "linux"),
    ]);

    expect(runCli(fixture, ["install", "test/designer@1.0.0", "--platform", "macos"]).status).toBe(
      0,
    );
    expect(runCli(fixture, ["install", "test/frontend@2.1.0", "--platform", "linux"]).status).toBe(
      0,
    );

    const result = runCli(fixture, ["list"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OpenDock Docks");
    expect(result.stdout).toContain("- test/designer@1.0.0 [macos] (1 file)");
    expect(result.stdout).toContain("- test/frontend@2.1.0 [linux] (1 file)");
    expect(result.stdout).not.toContain(".opendock/workdirs");
    expect(result.stdout).not.toContain("private-note.md");
    expect(result.stdout).not.toContain("script.mjs");
  });

  it("runs doctor for either one requested dock or the whole project", async () => {
    const fixture = createFixture();
    writeDock(fixture.docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer\n" }],
      tasks: { doctor: [{ id: "designer-ready", check: "test -f AGENTS.md" }] },
    });
    writeDock(fixture.docks, "test", "frontend", "1.0.0", {
      files: [{ path: "FRONTEND.md", content: "# Frontend\n" }],
      tasks: { doctor: [{ id: "frontend-ready", check: "test -f FRONTEND.md" }] },
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "designer", "1.0.0", "macos"),
      await registryRelease(fixture.docks, "test", "frontend", "1.0.0", "macos"),
    ]);

    expect(runCli(fixture, ["install", "test/designer@1.0.0", "--platform", "macos"]).status).toBe(
      0,
    );
    expect(runCli(fixture, ["install", "test/frontend@1.0.0", "--platform", "macos"]).status).toBe(
      0,
    );

    const selected = runCli(fixture, ["doctor", "test/designer"]);
    expect(selected.status).toBe(0);
    expect(selected.stdout).toContain("OpenDock Doctor");
    expect(selected.stdout).toContain("test/designer@1.0.0 [macos]");
    expect(selected.stdout).toContain("designer-ready");
    expect(selected.stdout).not.toContain("test/frontend");
    expect(selected.stdout).not.toContain("frontend-ready");

    const all = runCli(fixture, ["doctor"]);
    expect(all.status).toBe(0);
    expect(all.stdout).toContain("test/designer@1.0.0 [macos]");
    expect(all.stdout).toContain("designer-ready");
    expect(all.stdout).toContain("test/frontend@1.0.0 [macos]");
    expect(all.stdout).toContain("frontend-ready");
  });

  it("keeps failure logs contextual without printing token or auth secrets", async () => {
    const fixture = createFixture();
    const secret = "opendock-test-secret-token-123";
    writeDock(fixture.docks, "test", "failing", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Failing\n" }],
      tasks: {
        install: [
          {
            id: "test/failing SECRET_INPUT.md preflight",
            run: "test -f SECRET_INPUT.md",
          },
        ],
      },
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "failing", "1.0.0", "macos"),
    ]);

    const failed = runCli(fixture, ["install", "test/failing@1.0.0", "--platform", "macos"], {
      extraEnv: {
        AUTHORIZATION: `Bearer ${secret}`,
        OPENDOCK_TOKEN: secret,
      },
    });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("step `test/failing SECRET_INPUT.md preflight`");
    expect(failed.stderr).not.toContain(secret);
    expect(failed.stderr).not.toMatch(/authorization|bearer|opendock_token/i);

    const log = runCli(fixture, ["log"], {
      extraEnv: {
        AUTHORIZATION: `Bearer ${secret}`,
        OPENDOCK_TOKEN: secret,
      },
    });
    expect(log.status).toBe(0);
    expect(log.stdout).toContain("Failure install");
    expect(log.stdout).toContain("test/failing SECRET_INPUT.md preflight");
    expect(log.stdout).not.toContain(secret);
    expect(log.stdout).not.toMatch(/authorization|bearer|opendock_token/i);
  });

  it("keeps TTY color optional and NO_COLOR/non-TTY output plain", async () => {
    const fixture = createFixture();
    const previousNoColor = process.env.NO_COLOR;
    const previousTerm = process.env.TERM;
    writeDock(fixture.docks, "test", "color", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Color\n" }],
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "color", "1.0.0", "macos"),
    ]);
    expect(runCli(fixture, ["install", "test/color@1.0.0", "--platform", "macos"]).status).toBe(0);

    const nonTty = runCli(fixture, ["list"], { noColor: false });
    expect(nonTty.status).toBe(0);
    expect(nonTty.stdout).not.toMatch(ansiPattern);
    expect(nonTty.stdout).toContain("- test/color@1.0.0 [macos] (1 file)");

    try {
      delete process.env.NO_COLOR;
      delete process.env.TERM;
      expect(supportsTerminalColor({ isTTY: true })).toBe(true);
      expect(stripAnsi(paint("green", "ready", { isTTY: true }))).toBe("ready");

      process.env.NO_COLOR = "1";
      expect(supportsTerminalColor({ isTTY: true })).toBe(false);
      expect(paint("green", "ready", { isTTY: true })).toBe("ready");
    } finally {
      restoreEnv("NO_COLOR", previousNoColor);
      restoreEnv("TERM", previousTerm);
    }

    const noColor = runCli(fixture, ["list"], { noColor: true });
    expect(noColor.status).toBe(0);
    expect(noColor.stdout).not.toMatch(ansiPattern);
    expect(noColor.stdout).toContain("- test/color@1.0.0 [macos] (1 file)");
  });
});

interface Fixture {
  docks: string;
  home: string;
  preload: string;
  project: string;
  registry: string;
  root: string;
}

interface RunOptions {
  extraEnv?: Record<string, string>;
  forceTty?: boolean;
  noColor?: boolean;
}

interface TestRelease {
  archiveBase64: string;
  checksum: string;
  id: string;
  latest: boolean;
  platform: OpenDockPlatform;
  signature: unknown;
  version: string;
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "opendock-cli-ux-test-"));
  tempRoots.push(root);
  const fixture = {
    docks: join(root, "docks"),
    home: join(root, "home"),
    preload: join(root, "registry-preload.ts"),
    project: join(root, "project"),
    registry: join(root, "registry.json"),
    root,
  };
  mkdirSync(fixture.docks, { recursive: true });
  mkdirSync(fixture.home, { recursive: true });
  mkdirSync(fixture.project, { recursive: true });
  writeFileSync(fixture.registry, "[]\n");
  writeFileSync(fixture.preload, registryPreloadSource());
  return fixture;
}

function runCli(
  fixture: Fixture,
  args: string[],
  options: RunOptions = {},
): SpawnSyncReturns<string> {
  const env = cliEnv(fixture, options);
  const result = spawnSync("bun", ["--preload", fixture.preload, cliEntrypointPath, ...args], {
    cwd: fixture.project,
    encoding: "utf8",
    env,
  });
  return { ...result, stderr: stripBunRuntimeWarning(result.stderr) };
}

function stripBunRuntimeWarning(stderr: string): string {
  return stderr
    .replace(
      /warn: CPU lacks AVX support, strange crashes may occur\. Reinstall Bun or use \*-baseline build:\n\s+https:\/\/github\.com\/oven-sh\/bun\/releases\/download\/bun-v[^\n]+\n\n?/gu,
      "",
    )
    .trimStart();
}

function cliEnv(fixture: Fixture, options: RunOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    BUN_INSTALL: process.env.BUN_INSTALL,
    HOME: fixture.home,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    LC_CTYPE: process.env.LC_CTYPE,
    OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_BASE64:
      process.env.OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_BASE64,
    OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_ID: process.env.OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_ID,
    OPENDOCK_TEST_FORCE_TTY: options.forceTty === true ? "1" : undefined,
    OPENDOCK_TEST_REGISTRY_FIXTURE: fixture.registry,
    PATH: process.env.PATH,
    TEMP: process.env.TEMP,
    TERM: process.env.TERM,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    ...(options.extraEnv ?? {}),
  };
  if (options.noColor !== false) {
    env.NO_COLOR = "1";
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete env[key];
    }
  }
  return env;
}

function writeDock(
  root: string,
  owner: string,
  name: string,
  version: string,
  options: {
    files?: Array<{ path: string; content: string }>;
    tasks?: {
      doctor?: unknown[];
      install?: unknown[];
      update?: unknown[];
    };
    workdirFiles?: Array<{ path: string; to: string; content: string }>;
  },
): void {
  const dockRoot = join(root, `${owner}-${name}-${version}`);
  mkdirSync(join(dockRoot, "files"), { recursive: true });
  for (const file of options.files ?? []) {
    const filePath = join(dockRoot, "files", file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content);
  }
  for (const file of options.workdirFiles ?? []) {
    const filePath = join(dockRoot, file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content);
  }
  const manifest = {
    opendock: 1,
    summary: "",
    readme: "DOCK.md",
    logo: "logo.png",
    requires: { runtimes: {} },
    tools: {},
    files: (options.files ?? []).map((file) => ({
      from: `files/${file.path}`,
      to: file.path,
    })),
    workdir: {
      files: (options.workdirFiles ?? []).map((file) => ({
        from: file.path,
        to: file.to,
      })),
    },
    install: options.tasks?.install ?? [],
    update: options.tasks?.update ?? [],
    doctor: options.tasks?.doctor ?? [],
  };
  writeFileSync(join(dockRoot, "dock.yml"), YAML.stringify(manifest));
  writeFileSync(join(dockRoot, "DOCK.md"), `# ${owner}/${name}\n`);
  writeFileSync(
    join(dockRoot, "logo.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
}

async function writeRegistry(fixture: Fixture, releases: TestRelease[]): Promise<void> {
  writeFileSync(fixture.registry, `${JSON.stringify(releases)}\n`);
}

async function registryRelease(
  root: string,
  owner: string,
  name: string,
  version: string,
  platform: OpenDockPlatform,
  options: { latest?: boolean } = {},
): Promise<TestRelease> {
  const archive = await createDockArchive(root, owner, name, version);
  const checksum = sha256(archive);
  const id = `${owner}/${name}`;
  return {
    archiveBase64: archive.toString("base64"),
    checksum,
    id,
    latest: options.latest === true,
    platform,
    signature: testReleaseSignature({ id, version, platform, checksum }),
    version,
  };
}

async function createDockArchive(
  root: string,
  owner: string,
  name: string,
  version: string,
): Promise<Buffer> {
  const dockRoot = join(root, `${owner}-${name}-${version}`);
  const archivePath = join(root, `${owner}-${name}-${version}.tgz`);
  await createTar(
    {
      cwd: dockRoot,
      file: archivePath,
      gzip: true,
    },
    readdirSync(dockRoot),
  );
  return readFileSync(archivePath);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function registryPreloadSource(): string {
  return String.raw`
import { readFileSync } from "node:fs";

if (process.env.OPENDOCK_TEST_FORCE_TTY === "1") {
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
}

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname !== "registry.opendock.app") {
    return new Response("unexpected network request", { status: 599, statusText: "Unexpected" });
  }

  const fixturePath = process.env.OPENDOCK_TEST_REGISTRY_FIXTURE;
  if (!fixturePath) {
    return new Response("missing registry fixture", { status: 500 });
  }
  const releases = JSON.parse(readFileSync(fixturePath, "utf8"));
  const match = url.pathname.match(
    /^\/v1\/docks\/([^/]+)\/([^/]+)\/versions\/([^/]+)(\/download)?$/,
  );
  if (!match) {
    return new Response("not found", { status: 404, statusText: "Not Found" });
  }

  const [, owner, name, rawSelector, download] = match;
  const id = owner + "/" + name;
  const selector = decodeURIComponent(rawSelector ?? "");
  const platform = url.searchParams.get("platform");
  const release = releases.find((candidate) => {
    return (
      candidate.id === id &&
      candidate.platform === platform &&
      (selector === "latest" ? candidate.latest === true : candidate.version === selector)
    );
  });
  if (!release) {
    return new Response("not found", { status: 404, statusText: "Not Found" });
  }

  if (download) {
    const archive = Buffer.from(release.archiveBase64, "base64");
    return new Response(archive, {
      headers: { "content-length": String(archive.byteLength) },
      status: 200,
    });
  }

  return new Response(
    JSON.stringify({
      approved: true,
      checksum: release.checksum,
      id: release.id,
      platform: release.platform,
      signature: release.signature,
      version: release.version,
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
};
`;
}
