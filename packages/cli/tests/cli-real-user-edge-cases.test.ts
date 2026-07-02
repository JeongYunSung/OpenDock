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
import { testReleaseSignature } from "./release-signature-helper.js";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cliBinaryPath = join(packageDir, "bin", "opendock");
const cliEntrypointPath = existsSync(cliBinaryPath)
  ? cliBinaryPath
  : join(packageDir, "src", "cli.ts");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("real user CLI edge cases", () => {
  it("explains invalid install references before contacting the Registry", () => {
    const fixture = createFixture();

    const missingVersion = runCli(fixture, ["install", "test/agent", "--platform", "macos"]);
    expect(missingVersion.status).toBe(1);
    expect(missingVersion.stderr).toContain(
      "install reference must use owner/name@version with an exact version identifier",
    );
    expect(missingVersion.stderr).toContain("opendock/codex@1.0.0");

    const latest = runCli(fixture, ["install", "test/agent@latest", "--platform", "macos"]);
    expect(latest.status).toBe(1);
    expect(latest.stderr).toContain("dock version selector must be an exact version identifier");

    const unsafeName = runCli(fixture, ["install", "../agent@1.0.0", "--platform", "macos"]);
    expect(unsafeName.status).toBe(1);
    expect(unsafeName.stderr).toContain("dock owner/name may not contain parent path segments");
  });

  it("rejects unsupported manifest versions without writing project files", async () => {
    const fixture = createFixture();
    writeDock(fixture.docks, "test", "future", "1.0.0", {
      manifest: { opendock: 2, summary: "future manifest" },
      files: [{ path: "AGENTS.md", content: "# Future\n" }],
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "future", "1.0.0", "macos"),
    ]);

    const result = runCli(fixture, ["install", "test/future@1.0.0", "--platform", "macos"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unsupported opendock manifest version `2`");
    expect(existsSync(join(fixture.project, "AGENTS.md"))).toBe(false);
  });

  it("installs into an existing non-empty project without hiding unrelated files", async () => {
    const fixture = createFixture();
    writeFileSync(join(fixture.project, "README.md"), "# Existing Project\n");
    mkdirSync(join(fixture.project, "src"), { recursive: true });
    writeFileSync(join(fixture.project, "src", "index.ts"), "export const existing = true;\n");
    writeDock(fixture.docks, "test", "starter", "1.0.0", {
      files: [
        { path: "AGENTS.md", content: "# Starter Agent\n" },
        { path: ".codex/agents/starter.toml", content: 'name = "starter"\n' },
      ],
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "starter", "1.0.0", "macos"),
    ]);

    const result = runCli(fixture, ["install", "test/starter@1.0.0", "--platform", "macos"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Installed test/starter@1.0.0 for macos");
    expect(result.stdout).toContain("+ AGENTS.md");
    expect(result.stdout).toContain("+ .codex/agents/starter.toml");
    expect(readFileSync(join(fixture.project, "README.md"), "utf8")).toBe("# Existing Project\n");
    expect(readFileSync(join(fixture.project, "src", "index.ts"), "utf8")).toContain(
      "existing = true",
    );
  });

  it("keeps list output focused on installed docks instead of private workdir paths", async () => {
    const fixture = createFixture();
    writeDock(fixture.docks, "test", "with-workdir", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Workdir Agent\n" }],
      workdirFiles: [{ path: "inputs/private-plan.md", to: "private-plan.md", content: "draft\n" }],
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "with-workdir", "1.0.0", "macos"),
    ]);

    expect(
      runCli(fixture, ["install", "test/with-workdir@1.0.0", "--platform", "macos"]).status,
    ).toBe(0);

    const result = runCli(fixture, ["list"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("- test/with-workdir@1.0.0 [macos] (1 file)");
    expect(result.stdout).not.toContain(".opendock/workdirs");
    expect(result.stdout).not.toContain("private-plan.md");
  });

  it("prints a calm no-update result when installed docks are already current", async () => {
    const fixture = createFixture();
    writeDock(fixture.docks, "test", "current", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Current\n" }],
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "current", "1.0.0", "macos", {
        latest: true,
      }),
    ]);
    expect(runCli(fixture, ["install", "test/current@1.0.0", "--platform", "macos"]).status).toBe(
      0,
    );

    const result = runCli(fixture, ["update"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("No OpenDock dock updates available.");
  });

  it("runs doctor for one dock without mixing in other installed dock checks", async () => {
    const fixture = createFixture();
    writeDock(fixture.docks, "test", "designer", "1.0.0", {
      files: [{ path: "DESIGN.md", content: "# Design\n" }],
      doctor: [{ id: "designer-ready", check: "test -f DESIGN.md" }],
    });
    writeDock(fixture.docks, "test", "backend", "1.0.0", {
      files: [{ path: "BACKEND.md", content: "# Backend\n" }],
      doctor: [{ id: "backend-ready", check: "test -f BACKEND.md" }],
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "designer", "1.0.0", "macos"),
      await registryRelease(fixture.docks, "test", "backend", "1.0.0", "macos"),
    ]);
    expect(runCli(fixture, ["install", "test/designer@1.0.0", "--platform", "macos"]).status).toBe(
      0,
    );
    expect(runCli(fixture, ["install", "test/backend@1.0.0", "--platform", "macos"]).status).toBe(
      0,
    );

    const oneDock = runCli(fixture, ["doctor", "test/designer"]);
    expect(oneDock.status).toBe(0);
    expect(oneDock.stdout).toContain("test/designer@1.0.0 [macos]");
    expect(oneDock.stdout).toContain("designer-ready");
    expect(oneDock.stdout).not.toContain("test/backend");
    expect(oneDock.stdout).not.toContain("backend-ready");

    const allDocks = runCli(fixture, ["doctor"]);
    expect(allDocks.status).toBe(0);
    expect(allDocks.stdout).toContain("test/designer@1.0.0 [macos]");
    expect(allDocks.stdout).toContain("designer-ready");
    expect(allDocks.stdout).toContain("test/backend@1.0.0 [macos]");
    expect(allDocks.stdout).toContain("backend-ready");
  });

  it("rejects confusing auth providers without opening a browser or storing a token", () => {
    const fixture = createFixture();

    const result = runCli(fixture, ["auth", "login", "--provider", "email"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("auth provider must be google or github");
    expect(
      existsSync(join(fixture.home, "Library", "Application Support", "OpenDock", "auth-token")),
    ).toBe(false);
  });

  it("logs successful and failed commands while redacting ambient secrets", async () => {
    const fixture = createFixture();
    const secret = "opendock-real-user-secret-456";
    writeDock(fixture.docks, "test", "success", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Success\n" }],
    });
    writeDock(fixture.docks, "test", "failure", "1.0.0", {
      install: [{ id: "needs-human-file", run: "test -f HUMAN_APPROVAL.md" }],
      files: [{ path: "FAILURE.md", content: "# Failure\n" }],
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "test", "success", "1.0.0", "macos"),
      await registryRelease(fixture.docks, "test", "failure", "1.0.0", "macos"),
    ]);

    const success = runCli(fixture, ["install", "test/success@1.0.0", "--platform", "macos"], {
      extraEnv: {
        AUTHORIZATION: `Bearer ${secret}`,
        OPENDOCK_AUTH_TOKEN: secret,
      },
    });
    expect(success.status).toBe(0);

    const failure = runCli(fixture, ["install", "test/failure@1.0.0", "--platform", "macos"], {
      extraEnv: {
        AUTHORIZATION: `Bearer ${secret}`,
        OPENDOCK_AUTH_TOKEN: secret,
      },
    });
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain("needs-human-file");
    expect(failure.stderr).not.toContain(secret);
    expect(failure.stderr).not.toMatch(/authorization|bearer|opendock_auth_token/i);

    const log = runCli(fixture, ["log"], {
      extraEnv: {
        AUTHORIZATION: `Bearer ${secret}`,
        OPENDOCK_AUTH_TOKEN: secret,
      },
    });
    expect(log.status).toBe(0);
    expect(log.stdout).toContain("Success install test/success@1.0.0 installed");
    expect(log.stdout).toContain(
      "Failure install step `needs-human-file` exited with non-zero status",
    );
    expect(log.stdout).not.toContain(secret);
    expect(log.stdout).not.toMatch(/authorization|bearer|opendock_auth_token/i);
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
  const root = mkdtempSync(join(tmpdir(), "opendock-real-user-test-"));
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
  return spawnSync("bun", ["--preload", fixture.preload, cliEntrypointPath, ...args], {
    cwd: fixture.project,
    encoding: "utf8",
    env: cliEnv(fixture, options),
  });
}

function cliEnv(fixture: Fixture, options: RunOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    BUN_INSTALL: process.env.BUN_INSTALL,
    HOME: fixture.home,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    LC_CTYPE: process.env.LC_CTYPE,
    NO_COLOR: "1",
    OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_BASE64:
      process.env.OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_BASE64,
    OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_ID: process.env.OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_ID,
    OPENDOCK_TEST_REGISTRY_FIXTURE: fixture.registry,
    PATH: process.env.PATH,
    TEMP: process.env.TEMP,
    TERM: process.env.TERM,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    ...(options.extraEnv ?? {}),
  };
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
    doctor?: unknown[];
    files?: Array<{ path: string; content: string }>;
    install?: unknown[];
    manifest?: Record<string, unknown>;
    update?: unknown[];
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
    summary: `${owner}/${name}`,
    readme: "DOCK.md",
    logo: "logo.png",
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
    install: options.install ?? [],
    update: options.update ?? [],
    doctor: options.doctor ?? [],
    ...(options.manifest ?? {}),
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
  const checksum = createHash("sha256").update(archive).digest("hex");
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

function registryPreloadSource(): string {
  return String.raw`
import { readFileSync } from "node:fs";

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
