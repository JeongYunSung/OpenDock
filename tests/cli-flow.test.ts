import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { x as extractTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { run as runCli } from "../src/cli.js";
import { DockInstaller } from "../src/core/app/dock-installer.js";
import { type DockManifest, DockRef, parseManifestFile } from "../src/core/domain/manifest.js";
import type { InstalledDockRecord } from "../src/core/domain/state-store.js";
import { OpenDockStateStore } from "../src/core/domain/state-store.js";
import { TaskRunner } from "../src/core/runtime/task-runner.js";
import type { OpenDockPlatform } from "../src/platform.js";
import type { ResolvedDock } from "../src/resolver.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function install(options: Parameters<DockInstaller["install"]>[0]) {
  return new DockInstaller().install(options);
}

function uninstall(options: Parameters<DockInstaller["uninstall"]>[0]) {
  return new DockInstaller().uninstall(options);
}

function installedDocks(projectDir: string): InstalledDockRecord[] {
  return new OpenDockStateStore(projectDir).readLock().docks;
}

function runTasks(
  manifest: DockManifest,
  phase: keyof DockManifest["tasks"],
  projectDir: string,
  options: { platform?: OpenDockPlatform } = {},
) {
  return new TaskRunner().run(manifest, {
    projectDir,
    dockId: manifest.id,
    phase,
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  }).reports;
}

describe("opendock TypeScript CLI", () => {
  it("installs text files as managed blocks and preserves existing content", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeFileSync(join(project, "AGENTS.md"), "# Existing Notes\n\nKeep this line.\n");
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent\n" }],
    });

    const report = await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      operation: "install",
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });

    const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(report.filesCreated).toBe(0);
    expect(report.filesUpdated).toBe(1);
    expect(agents).toContain("Keep this line.");
    expect(agents).toContain("OPENDOCK:START id=files:AGENTS.md dock=test/designer");
    expect(agents).toContain("# Designer Agent");
    expect(installedDocks(project)).toHaveLength(1);
  });

  it("replaces managed blocks on update without duplicating markers", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Version One\n" }],
    });
    writeDock(docks, "test", "designer", "1.0.1", {
      files: [{ path: "AGENTS.md", content: "# Version Two\n" }],
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      operation: "install",
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });
    await install({
      dockRef: DockRef.parse("test/designer@1.0.1"),
      projectDir: project,
      operation: "update",
      phase: "update",
      runTasks: true,
      resolve: localResolver(docks),
    });

    const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(agents).toContain("# Version Two");
    expect(agents).not.toContain("# Version One");
    expect(agents.match(/OPENDOCK:START/g)).toHaveLength(1);
    expect(installedDocks(project)[0]).toMatchObject({
      id: "test/designer",
      version: "1.0.1",
    });
  });

  it("blocks non-text managed file conflicts before touching root files", async () => {
    const docks = tempDir();
    const project = tempDir();
    mkdirSync(join(project, ".codex", "agents"), { recursive: true });
    writeFileSync(join(project, ".codex", "agents", "reviewer.toml"), 'name = "user-reviewer"\n');
    writeDock(docks, "test", "agent", "1.0.0", {
      files: [
        { path: "AGENTS.md", content: "# Agent\n" },
        { path: ".codex/agents/reviewer.toml", content: 'name = "dock-reviewer"\n' },
      ],
    });

    await expect(
      install({
        dockRef: DockRef.parse("test/agent@1.0.0"),
        projectDir: project,
        operation: "install",
        phase: "install",
        runTasks: true,
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("target already exists and is not OpenDock-owned");

    expect(existsSync(join(project, "AGENTS.md"))).toBe(false);
    expect(readFileSync(join(project, ".codex", "agents", "reviewer.toml"), "utf8")).toContain(
      "user-reviewer",
    );

    await install({
      dockRef: DockRef.parse("test/agent@1.0.0"),
      force: true,
      projectDir: project,
      operation: "install",
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });
    expect(readFileSync(join(project, ".codex", "agents", "reviewer.toml"), "utf8")).toContain(
      "dock-reviewer",
    );
  });

  it("runs external commands in dock workdir and exports declared outputs", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    writeFakeOma(bin);
    writeDock(docks, "test", "oma", "1.0.0", {
      files: [{ path: "PROMPTS.md", content: "# Prompts\n" }],
      tasks: {
        install: [
          {
            id: "apply-oma",
            run: "oma -y install",
            workdir: "dock",
            export: {
              include: ["AGENTS.md", "CLAUDE.md", ".agents/**", ".codex/**"],
              exclude: ["**/*.log", "**/cache/**"],
            },
          },
        ],
        doctor: [{ id: "oma-doctor", run: "oma doctor" }],
      },
    });

    await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      install({
        dockRef: DockRef.parse("test/oma@1.0.0"),
        projectDir: project,
        operation: "install",
        phase: "install",
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toContain("Generated by fake OMA");
    expect(readFileSync(join(project, ".codex", "agents", "reviewer.toml"), "utf8")).toContain(
      "reviewer",
    );
    expect(existsSync(join(project, ".agents", "cache", "ignored.log"))).toBe(false);
    expect(existsSync(join(project, ".opendock", "workdirs", "test__oma", "AGENTS.md"))).toBe(true);
  });

  it("blocks user-edited managed blocks and allows force restore", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Version One\n" }],
    });
    writeDock(docks, "test", "designer", "1.0.1", {
      files: [{ path: "AGENTS.md", content: "# Version Two\n" }],
    });
    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      operation: "install",
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });
    const agentsPath = join(project, "AGENTS.md");
    writeFileSync(
      agentsPath,
      readFileSync(agentsPath, "utf8").replace("# Version One", "# User Edit"),
    );

    await expect(
      install({
        dockRef: DockRef.parse("test/designer@1.0.1"),
        projectDir: project,
        operation: "update",
        phase: "update",
        runTasks: true,
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("checksum mismatch for managed block");

    await install({
      dockRef: DockRef.parse("test/designer@1.0.1"),
      force: true,
      projectDir: project,
      operation: "update",
      phase: "update",
      runTasks: true,
      resolve: localResolver(docks),
    });
    expect(readFileSync(agentsPath, "utf8")).toContain("# Version Two");
  });

  it("removes files that disappear from a newer release", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [
        { path: "AGENTS.md", content: "# Agent\n" },
        { path: "PROMPTS.md", content: "# Prompts\n" },
      ],
    });
    writeDock(docks, "test", "designer", "1.0.1", {
      files: [{ path: "AGENTS.md", content: "# Agent v2\n" }],
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      operation: "install",
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });
    await install({
      dockRef: DockRef.parse("test/designer@1.0.1"),
      projectDir: project,
      operation: "update",
      phase: "update",
      runTasks: true,
      resolve: localResolver(docks),
    });

    expect(existsSync(join(project, "PROMPTS.md"))).toBe(false);
    expect(installedDocks(project)[0]?.files?.map((file) => file.path)).toEqual(["AGENTS.md"]);
  });

  it("installs multiple docks and uninstalls one dock without touching the other", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "oma", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# OMA\n" }],
    });
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [
        { path: "AGENTS.md", content: "# Designer\n" },
        { path: "DESIGN.md", content: "# Design\n" },
      ],
    });

    await install({
      dockRef: DockRef.parse("test/oma@1.0.0"),
      projectDir: project,
      operation: "install",
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });
    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      operation: "install",
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });

    let agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(agents).toContain("dock=test/oma");
    expect(agents).toContain("dock=test/designer");

    uninstall({ dockId: "test/designer", projectDir: project });
    agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(agents).toContain("dock=test/oma");
    expect(agents).not.toContain("dock=test/designer");
    expect(existsSync(join(project, "DESIGN.md"))).toBe(false);
    expect(installedDocks(project).map((dock) => dock.id)).toEqual(["test/oma"]);
  });

  it("fails CLI update when the current directory has no OpenDock state", async () => {
    const project = tempDir();
    await withCwd(project, async () => {
      await expect(runCli(["bun", "opendock", "update"])).rejects.toThrow(
        ".opendock/dock.lock.yml missing",
      );
    });
  });

  it("rejects unsafe commands", () => {
    const project = tempDir();
    const manifest: DockManifest = {
      opendock: 1,
      id: "test/unsafe",
      summary: "",
      requires: { runtimes: {}, packages: {} },
      files: [],
      tasks: {
        install: [{ id: "inline", run: 'node -e "console.log(1)"', platforms: {} }],
        update: [],
        doctor: [],
      },
    };

    expect(() => runTasks(manifest, "install", project)).toThrow("not allowed");
  });

  it("submits platform-specific deploy manifests as dock.yml archives", async () => {
    const dockRoot = tempDir();
    const extractRoot = tempDir();
    const home = tempDir();
    const dataDir = join(home, "Library", "Application Support", "OpenDock");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "auth-token"), "test-token");
    mkdirSync(join(dockRoot, "macos", "files"), { recursive: true });
    writeFileSync(join(dockRoot, "macos", "files", "AGENTS.md"), "# macOS Agent\n");
    writeFileSync(join(dockRoot, "macos", "DOCK.md"), "# macOS Dock\n");
    writeFileSync(
      join(dockRoot, "macos", "logo.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    writeFileSync(
      join(dockRoot, "macos", "dock.macos.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/platform-dock",
        summary: "macOS artifact",
        readme: "DOCK.md",
        logo: "logo.png",
        files: [{ from: "files/AGENTS.md", to: "AGENTS.md" }],
      }),
    );

    const previousFetch = globalThis.fetch;
    let body:
      | {
          archive: { data_base64: string; filename: string };
          manifest: string;
          platform: string;
        }
      | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "submission-1", status: "pending" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await withEnv({ HOME: home }, () =>
        withCwd(dockRoot, () =>
          runCli([
            "bun",
            "opendock",
            "deploy",
            "test/platform-dock@1.0.0",
            "--platform",
            "macos",
            "--file",
            "macos/dock.macos.yml",
          ]),
        ),
      );
    } finally {
      globalThis.fetch = previousFetch;
    }

    if (!body) {
      throw new Error("expected deploy request body");
    }
    expect(body.platform).toBe("macos");
    expect(body.archive.filename).toBe("test-platform-dock-1.0.0-macos.tgz");
    expect(body.manifest).toContain("summary: macOS artifact");

    const archivePath = join(extractRoot, "dock.tgz");
    writeFileSync(archivePath, Buffer.from(body.archive.data_base64, "base64"));
    await extractTar({ file: archivePath, cwd: extractRoot });
    expect(readFileSync(join(extractRoot, "dock.yml"), "utf8")).toContain(
      "summary: macOS artifact",
    );
    expect(readFileSync(join(extractRoot, "files", "AGENTS.md"), "utf8")).toBe("# macOS Agent\n");
    expect(existsSync(join(extractRoot, "macos", "dock.macos.yml"))).toBe(false);
  });

  it("infers deploy platform from the manifest filename", async () => {
    const dockRoot = tempDir();
    const home = tempDir();
    const dataDir = join(home, "Library", "Application Support", "OpenDock");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "auth-token"), "test-token");
    mkdirSync(join(dockRoot, "windows", "files"), { recursive: true });
    writeFileSync(join(dockRoot, "windows", "files", "AGENTS.md"), "# Windows Agent\n");
    writeFileSync(
      join(dockRoot, "windows", "dock.windows.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/platform-dock",
        summary: "Windows artifact",
        files: [{ from: "files/AGENTS.md", to: "AGENTS.md" }],
      }),
    );

    const previousFetch = globalThis.fetch;
    let body:
      | {
          archive: { filename: string };
          platform: string;
        }
      | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "submission-1", status: "pending" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await withEnv({ HOME: home }, () =>
        withCwd(dockRoot, () =>
          runCli([
            "bun",
            "opendock",
            "deploy",
            "test/platform-dock@1.0.0",
            "--file",
            "windows/dock.windows.yml",
          ]),
        ),
      );
    } finally {
      globalThis.fetch = previousFetch;
    }

    if (!body) {
      throw new Error("expected deploy request body");
    }
    expect(body.platform).toBe("windows");
    expect(body.archive.filename).toBe("test-platform-dock-1.0.0-windows.tgz");
  });

  it("submits platform-neutral deploys as any artifacts by default", async () => {
    const dockRoot = tempDir();
    const home = tempDir();
    const dataDir = join(home, "Library", "Application Support", "OpenDock");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "auth-token"), "test-token");
    mkdirSync(join(dockRoot, "files"), { recursive: true });
    writeFileSync(join(dockRoot, "files", "AGENTS.md"), "# Any Agent\n");
    writeFileSync(
      join(dockRoot, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/any-dock",
        summary: "platform-neutral artifact",
        files: [{ from: "files/AGENTS.md", to: "AGENTS.md" }],
      }),
    );

    const previousFetch = globalThis.fetch;
    let body:
      | {
          archive: { filename: string };
          platform: string;
        }
      | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "submission-1", status: "pending" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await withEnv({ HOME: home }, () =>
        withCwd(dockRoot, () => runCli(["bun", "opendock", "deploy", "test/any-dock@1.0.0"])),
      );
    } finally {
      globalThis.fetch = previousFetch;
    }

    if (!body) {
      throw new Error("expected deploy request body");
    }
    expect(body.platform).toBe("any");
    expect(body.archive.filename).toBe("test-any-dock-1.0.0-any.tgz");
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-test-"));
  tempRoots.push(dir);
  return dir;
}

function writeDock(
  root: string,
  owner: string,
  name: string,
  version: string,
  options: {
    files?: Array<{ path: string; content: string }>;
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

  const manifest = {
    opendock: 1,
    id: `${owner}/${name}`,
    summary: "",
    readme: "DOCK.md",
    logo: "logo.png",
    files: (options.files ?? []).map((file) => ({
      from: `files/${file.path}`,
      to: file.path,
    })),
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

function localResolver(root: string) {
  return (dockRef: DockRef, platform: OpenDockPlatform): ResolvedDock => {
    const dockRoot = join(root, `${dockRef.owner}-${dockRef.name}-${dockRef.requested()}`);
    return {
      manifest: parseManifestFile(join(dockRoot, "dock.yml")),
      version: dockRef.requested(),
      platform,
      root: dockRoot,
      checksum: `${dockRef.id()}-${dockRef.requested()}-checksum`,
      signature: "test-signature",
    };
  };
}

function writeFakeOma(bin: string): void {
  const path = join(bin, "oma");
  writeFileSync(
    path,
    `#!/usr/bin/env bash
set -euo pipefail
mode="\${*: -1}"
case "$mode" in
  install)
    mkdir -p .agents/skills/oma-brainstorm .agents/cache .codex/agents
    printf '# OMA Agent\\n\\nGenerated by fake OMA.\\n' > AGENTS.md
    printf '# Claude\\n' > CLAUDE.md
    printf '# Skill\\n' > .agents/skills/oma-brainstorm/SKILL.md
    printf 'name = "reviewer"\\n' > .codex/agents/reviewer.toml
    printf 'ignore me\\n' > .agents/cache/ignored.log
    ;;
  doctor)
    test -f AGENTS.md
    test -f CLAUDE.md
    ;;
esac
`,
  );
  chmod(path);
}

function chmod(path: string): void {
  chmodSync(path, 0o755);
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

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}
