import { createHash } from "node:crypto";
import {
  chmodSync,
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
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { DockInstaller } from "../src/core/app/dock-installer.js";
import {
  type DockManifest,
  DockRef,
  manifestForRef,
  parseManifestFile,
} from "../src/core/domain/manifest.js";
import { OpenDockStateStore } from "../src/core/domain/state-store.js";
import { CommandRunner, opendockCommandPath } from "../src/core/runtime/command-runner.js";
import { TaskRunner } from "../src/core/runtime/task-runner.js";
import { detectPlatform, parsePlatform } from "../src/platform.js";
import { OpenDockRegistryClient } from "../src/registry.js";
import type { ResolvedDock } from "../src/resolver.js";
import { resolveDock } from "../src/resolver.js";
import { testReleaseSignature } from "./release-signature-helper.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("platform regression coverage", () => {
  it("detects and parses supported platform names and aliases", () => {
    expect(detectPlatform("darwin")).toBe("macos");
    expect(detectPlatform("win32")).toBe("windows");
    expect(detectPlatform("linux")).toBe("linux");

    expect(parsePlatform("mac")).toBe("macos");
    expect(parsePlatform("darwin")).toBe("macos");
    expect(parsePlatform("win")).toBe("windows");
    expect(parsePlatform("win32")).toBe("windows");
    expect(parsePlatform("linux")).toBe("linux");
    expect(() => detectPlatform("freebsd" as NodeJS.Platform)).toThrow("unsupported host platform");
    expect(() => parsePlatform("freebsd")).toThrow("unsupported OpenDock platform");
  });

  it("passes platform selectors to Registry resolve and download requests", async () => {
    const requestedUrls: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/download?platform=windows")) {
        return new Response("archive", { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: "opendock/codex",
          version: "1.0.0",
          platform: "windows",
          approved: true,
          checksum: "checksum",
          signature: testReleaseSignature({
            id: "opendock/codex",
            version: "1.0.0",
            platform: "windows",
            checksum: "checksum",
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const client = new OpenDockRegistryClient("https://registry.test");
      await client.resolveDockVersion("opendock", "codex", "1.0.0", "windows");
      await client.downloadDock("opendock", "codex", "1.0.0", "windows");
    } finally {
      globalThis.fetch = previousFetch;
    }

    expect(requestedUrls).toEqual([
      "https://registry.test/v1/docks/opendock/codex/versions/1.0.0?platform=windows",
      "https://registry.test/v1/docks/opendock/codex/versions/1.0.0/download?platform=windows",
    ]);
  });

  it("rejects Registry artifacts for a different concrete platform", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/download")) {
        throw new Error("download should not run for mismatched platform metadata");
      }
      return new Response(
        JSON.stringify({
          id: "opendock/codex",
          version: "1.0.0",
          platform: "macos",
          approved: true,
          checksum: "checksum",
          signature: testReleaseSignature({
            id: "opendock/codex",
            version: "1.0.0",
            platform: "macos",
            checksum: "checksum",
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      await expect(resolveDock(DockRef.parse("opendock/codex@1.0.0"), "windows")).rejects.toThrow(
        "registry returned macos artifact for requested platform `windows`",
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("accepts platform-neutral Registry signatures for the requested concrete platform", async () => {
    const docks = tempDir();
    writeDock(docks, "opendock", "common", "1.0.0", {});
    const archive = await createDockArchive(docks, "opendock", "common", "1.0.0");
    const checksum = sha256(archive);
    const requestedUrls: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/download")) {
        return new Response(archive, {
          status: 200,
          headers: { "content-length": String(archive.length) },
        });
      }
      return new Response(
        JSON.stringify({
          id: "opendock/common",
          version: "1.0.0",
          platform: "macos",
          approved: true,
          checksum,
          signature: testReleaseSignature({
            id: "opendock/common",
            version: "1.0.0",
            platform: "any",
            checksum,
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const resolved = await resolveDock(DockRef.parse("opendock/common@1.0.0"), "macos");
      expect(resolved.manifest.id).toBe("opendock/common");
      expect(resolved.platform).toBe("macos");
    } finally {
      globalThis.fetch = previousFetch;
    }

    expect(requestedUrls).toEqual([
      "https://registry.opendock.app/v1/docks/opendock/common/versions/1.0.0?platform=macos",
      "https://registry.opendock.app/v1/docks/opendock/common/versions/1.0.0/download?platform=macos",
    ]);
  });

  it("rejects unsupported platform keys in dock.yml", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        install: [
          {
            id: "install-runtime",
            platforms: {
              freebsd: {
                run: "pkg install node",
              },
            },
          },
        ],
      }),
    );

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow(
      "unsupported platform `freebsd`",
    );
  });

  it("keeps task order while selecting the macOS platform override", async () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakePlatformCommand(bin, "brew", log);
    writeFakePlatformCommand(bin, "winget", log);

    const reports = await withEnv(
      { PATH: `${bin}:${process.env.PATH ?? ""}` },
      async () =>
        new TaskRunner().run(platformManifest(), {
          projectDir: project,
          dockId: "test/platform",
          phase: "install",
          platform: "macos",
          live: false,
        }).reports,
    );

    expect(reports.map((report) => `${report.id}:${report.status}`)).toEqual([
      "before:Ran",
      "install-runtime:Ran",
      "after:Ready",
    ]);
    expect(readFileSync(log, "utf8")).toBe("brew:--version\n");
    expect(existsSync(join(project, "runtime-ready"))).toBe(true);
    expect(existsSync(join(project, "winget-ran"))).toBe(false);
  });

  it("selects the Windows platform override and blocks unsupported Linux installs", async () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakePlatformCommand(bin, "brew", log);
    writeFakePlatformCommand(bin, "winget", log);

    const reports = await withEnv(
      { PATH: `${bin}:${process.env.PATH ?? ""}` },
      async () =>
        new TaskRunner().run(platformManifest(), {
          projectDir: project,
          dockId: "test/platform",
          phase: "install",
          platform: "windows",
          live: false,
        }).reports,
    );

    expect(reports.map((report) => `${report.id}:${report.status}`)).toEqual([
      "before:Ran",
      "install-runtime:Ran",
      "after:Ready",
    ]);
    expect(readFileSync(log, "utf8")).toBe("winget:--version\n");
    expect(existsSync(join(project, "runtime-ready"))).toBe(true);
    expect(existsSync(join(project, "brew-ran"))).toBe(false);

    expect(() =>
      new TaskRunner().run(platformManifest(), {
        projectDir: tempDir(),
        dockId: "test/platform",
        phase: "install",
        platform: "linux",
        live: false,
      }),
    ).toThrow("does not support platform `linux`");
  });

  it("runs steps without platform overrides on every supported platform", () => {
    const project = tempDir();
    const manifest: DockManifest = {
      opendock: 1,
      id: "test/common",
      summary: "",
      tags: [],
      permission: [],
      requires: { runtimes: {} },
      files: [],
      tasks: {
        install: [{ id: "common", run: "git init -b main", platforms: {} }],
        update: [],
        doctor: [],
      },
    };

    const reports = new TaskRunner().run(manifest, {
      projectDir: project,
      dockId: "test/common",
      phase: "install",
      platform: "linux",
      live: false,
    }).reports;

    expect(reports).toMatchObject([{ id: "common", status: "Ran" }]);
    expect(existsSync(join(project, ".git"))).toBe(true);
  });

  it("selects platform overrides for doctor checks", async () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakePlatformCommand(bin, "brew", log);
    writeFakePlatformCommand(bin, "winget", log);
    const manifest: DockManifest = {
      opendock: 1,
      id: "test/doctor",
      summary: "",
      tags: [],
      permission: [],
      requires: { runtimes: {} },
      files: [],
      tasks: {
        install: [],
        update: [],
        doctor: [
          {
            id: "runtime-doctor",
            platforms: {
              macos: {
                run: "brew --version",
              },
              windows: {
                run: "winget --version",
              },
            },
          },
        ],
      },
    };

    await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, async () => {
      expect(
        new TaskRunner().run(manifest, {
          projectDir: project,
          dockId: "test/doctor",
          phase: "doctor",
          platform: "windows",
        }).reports,
      ).toMatchObject([{ id: "runtime-doctor", status: "Ready" }]);

      expect(
        new TaskRunner().run(manifest, {
          projectDir: project,
          dockId: "test/doctor",
          phase: "doctor",
          platform: "macos",
        }).reports,
      ).toMatchObject([{ id: "runtime-doctor", status: "Ready" }]);
    });

    expect(readFileSync(log, "utf8")).toBe("winget:--version\nbrew:--version\n");
  });

  it("enforces platform-specific command allowlists", async () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakePlatformCommand(bin, "brew", log);
    writeFakePlatformCommand(bin, "powershell", log);
    writeFakePlatformCommand(bin, "winget", log);
    const runner = new CommandRunner();
    const powershellFileCheck =
      'powershell -NoProfile -NonInteractive -Command "if (Test-Path -LiteralPath AGENTS.md) { exit 0 } else { exit 1 }"';

    expect(() => runner.run("brew --version", { cwd: project, platform: "windows" })).toThrow(
      "not allowed for OpenDock platform `windows`",
    );
    expect(() => runner.run(powershellFileCheck, { cwd: project, platform: "macos" })).toThrow(
      "not allowed for OpenDock platform `macos`",
    );
    expect(() => runner.run("winget --version", { cwd: project, platform: "macos" })).toThrow(
      "not allowed for OpenDock platform `macos`",
    );
    expect(() =>
      runner.run('powershell -NoProfile -NonInteractive -Command "Get-Content AGENTS.md"', {
        cwd: project,
        platform: "windows",
      }),
    ).toThrow("not allowed for OpenDock commands");
    expect(() =>
      runner.run(
        'powershell -NoProfile -NonInteractive -Command "if (Test-Path -LiteralPath ../AGENTS.md) { exit 0 } else { exit 1 }"',
        { cwd: project, platform: "windows" },
      ),
    ).toThrow("not allowed for OpenDock commands");

    await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, async () => {
      expect(runner.run("brew --version", { cwd: project, platform: "macos" }).success).toBe(true);
      expect(runner.run("winget --version", { cwd: project, platform: "windows" }).success).toBe(
        true,
      );
      expect(runner.run(powershellFileCheck, { cwd: project, platform: "windows" }).success).toBe(
        true,
      );
    });

    expect(readFileSync(log, "utf8")).toBe(
      "brew:--version\nwinget:--version\npowershell:-NoProfile -NonInteractive -Command if (Test-Path -LiteralPath AGENTS.md) { exit 0 } else { exit 1 }\n",
    );
  });

  it("adds standard macOS tool locations for GUI-launched app commands", () => {
    const commandPath = opendockCommandPath("/usr/bin:/bin", "darwin", {
      BUN_INSTALL: "/Users/test/.bun",
      HOME: "/Users/test",
    });

    expect(commandPath?.split(":")).toEqual([
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      "/Users/test/.bun/bin",
      "/Users/test/.local/bin",
    ]);
  });

  it("keeps explicit user macOS PATH entries ahead of managed tool locations", () => {
    const commandPath = opendockCommandPath("/tmp/opendock-bin:/usr/bin:/bin", "darwin", {
      HOME: "/Users/test",
    });

    expect(commandPath?.split(":").slice(0, 4)).toEqual([
      "/tmp/opendock-bin",
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
    ]);
  });

  it("records the selected platform in lock state and can reuse it for an update", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakePlatformCommand(bin, "brew", log);
    writeFakePlatformCommand(bin, "winget", log);
    writeDock(docks, "test", "tool", "1.0.0", {
      tasks: {
        install: [platformRuntimeStep("install-runtime")],
      },
    });
    writeDock(docks, "test", "tool", "1.0.1", {
      tasks: {
        update: [platformRuntimeStep("update-runtime")],
      },
    });

    await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, async () => {
      await new DockInstaller().install({
        dockRef: DockRef.parse("test/tool@1.0.0"),
        phase: "install",
        platform: "windows",
        projectDir: project,
        runTasks: true,
        resolve: localResolver(docks),
      });

      const lockedDock = installedDocks(project)[0];
      expect(lockedDock?.platform).toBe("windows");
      if (!lockedDock) {
        throw new Error("expected installed dock to be locked");
      }

      rmSync(join(project, "runtime-ready"), { force: true });
      await new DockInstaller().install({
        dockRef: DockRef.parse("test/tool@1.0.1"),
        phase: "update",
        platform: lockedDock.platform,
        projectDir: project,
        runTasks: true,
        resolve: localResolver(docks),
      });
    });

    expect(readFileSync(log, "utf8")).toBe(["winget:--version", "winget:--version", ""].join("\n"));
    expect(installedDocks(project)[0]).toMatchObject({
      id: "test/tool",
      platform: "windows",
      version: "1.0.1",
    });
  });
});

function platformManifest(): DockManifest {
  return {
    opendock: 1,
    id: "test/platform",
    summary: "",
    tags: [],
    permission: [],
    requires: { runtimes: {} },
    files: [],
    tasks: {
      install: [
        { id: "before", run: "git init -b main", platforms: {} },
        platformRuntimeStep("install-runtime"),
        { id: "after", check: "test -d .git", platforms: {} },
      ],
      update: [],
      doctor: [],
    },
  };
}

function platformRuntimeStep(id: string) {
  return {
    id,
    check: "test -f runtime-ready",
    platforms: {
      macos: {
        run: "brew --version",
      },
      windows: {
        run: "winget --version",
      },
    },
  };
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-platform-test-"));
  tempRoots.push(dir);
  return dir;
}

function writeFakePlatformCommand(bin: string, name: string, log: string): void {
  const path = join(bin, name);
  writeFileSync(
    path,
    `#!/bin/sh
set -eu
program="\${0##*/}"
printf '%s:%s\\n' "$program" "$*" >> "${log}"
touch "$program-ran"
touch runtime-ready
`,
  );
  chmodSync(path, 0o755);
}

function writeDock(
  root: string,
  owner: string,
  name: string,
  version: string,
  options: {
    files?: Array<{ path: string; content: string }>;
    permission?: string[];
    tasks?: {
      install?: unknown[];
      update?: unknown[];
      doctor?: unknown[];
    };
  },
): void {
  const dockRoot = join(root, `${owner}-${name}-${version}`);
  mkdirSync(join(dockRoot, "files"), { recursive: true });
  for (const file of options.files ?? []) {
    const filePath = join(dockRoot, "files", file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content);
  }

  writeFileSync(
    join(dockRoot, "dock.yml"),
    YAML.stringify({
      opendock: 1,
      summary: "",
      readme: "DOCK.md",
      logo: "logo.png",
      permissions: options.permission ?? [],
      files: (options.files ?? []).map((file) => ({
        from: `files/${file.path}`,
        to: file.path,
      })),
      install: options.tasks?.install ?? [],
      update: options.tasks?.update ?? [],
      doctor: options.tasks?.doctor ?? [],
    }),
  );
  writeFileSync(join(dockRoot, "DOCK.md"), `# ${owner}/${name}\n`);
  writeFileSync(
    join(dockRoot, "logo.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
}

async function createDockArchive(
  root: string,
  owner: string,
  name: string,
  version: string,
): Promise<Buffer> {
  const dockRoot = join(root, `${owner}-${name}-${version}`);
  const archivePath = join(tempDir(), "dock.tgz");
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

function localResolver(root: string) {
  return (dockRef: DockRef, platform: ReturnType<typeof parsePlatform>): ResolvedDock => {
    const dockRoot = join(root, `${dockRef.owner}-${dockRef.name}-${dockRef.requested()}`);
    return {
      manifest: manifestForRef(parseManifestFile(join(dockRoot, "dock.yml")), dockRef),
      version: dockRef.requested(),
      platform,
      root: dockRoot,
      checksum: `${dockRef.id()}-${dockRef.requested()}-checksum`,
      signature: "test-signature",
    };
  };
}

function installedDocks(projectDir: string) {
  return new OpenDockStateStore(projectDir).readLock().docks;
}

async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
