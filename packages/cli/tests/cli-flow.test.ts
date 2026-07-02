import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { c as createTar, x as extractTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { run as runCli } from "../src/cli.js";
import { DockInstaller } from "../src/core/app/dock-installer.js";
import {
  type DockManifest,
  DockRef,
  manifestForRef,
  parseManifestFile,
} from "../src/core/domain/manifest.js";
import type { InstalledDockRecord } from "../src/core/domain/state-store.js";
import { OpenDockStateStore } from "../src/core/domain/state-store.js";
import { safeDockDirectoryName } from "../src/core/files/path-utils.js";
import { TaskRunner } from "../src/core/runtime/task-runner.js";
import { readProjectLogs } from "../src/logging.js";
import { detectPlatform, type OpenDockPlatform } from "../src/platform.js";
import type { ResolvedDock } from "../src/resolver.js";
import { testReleaseSignature } from "./release-signature-helper.js";

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

function restoreExitCode(previousExitCode: string | number | null | undefined): void {
  process.exitCode = previousExitCode ?? 0;
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
  it("lists project commands in top-level help", () => {
    const result = spawnSync("bun", ["run", "src/cli.ts", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("install");
    expect(result.stdout).toContain("update");
    expect(result.stdout).toContain("doctor");
  });

  it("prints command-specific help", () => {
    const cases = [
      {
        args: ["install", "--help"],
        expected: ["Usage: opendock install [options] <dock>", "--platform <platform>", "--json"],
      },
      {
        args: ["doctor", "--help"],
        expected: ["Usage: opendock doctor [options] [dock]", "--platform <platform>"],
      },
      {
        args: ["auth", "login", "--help"],
        expected: [
          "Usage: opendock auth login [options]",
          "--provider <provider>",
          "--token <token>",
        ],
      },
    ];

    for (const { args, expected } of cases) {
      const result = spawnSync("bun", ["run", "src/cli.ts", ...args], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      });

      expect(result.status).toBe(0);
      for (const text of expected) {
        expect(result.stdout).toContain(text);
      }
    }
  });

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
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });

    const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(report.filesCreated).toBe(0);
    expect(report.filesUpdated).toBe(1);
    expect(report.fileChanges).toMatchObject({
      created: [],
      deleted: [],
      updated: ["AGENTS.md"],
    });
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
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });
    await install({
      dockRef: DockRef.parse("test/designer@1.0.1"),
      projectDir: project,
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

  it("reports created, updated, and deleted file paths on update", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "agent", "1.0.0", {
      files: [
        { path: ".codex/agents/old.toml", content: 'name = "old"\n' },
        { path: ".codex/agents/shared.toml", content: 'name = "shared-v1"\n' },
      ],
    });
    writeDock(docks, "test", "agent", "1.0.1", {
      files: [
        { path: ".codex/agents/new.toml", content: 'name = "new"\n' },
        { path: ".codex/agents/shared.toml", content: 'name = "shared-v2"\n' },
      ],
    });

    const installReport = await install({
      dockRef: DockRef.parse("test/agent@1.0.0"),
      projectDir: project,
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });
    const updateReport = await install({
      dockRef: DockRef.parse("test/agent@1.0.1"),
      projectDir: project,
      phase: "update",
      runTasks: true,
      resolve: localResolver(docks),
    });

    expect(installReport.fileChanges).toMatchObject({
      created: [".codex/agents/old.toml", ".codex/agents/shared.toml"],
      deleted: [],
      updated: [],
    });
    expect(updateReport.fileChanges).toMatchObject({
      created: [".codex/agents/new.toml"],
      deleted: [".codex/agents/old.toml"],
      updated: [".codex/agents/shared.toml"],
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
      permission: ["oma -y install", "oma doctor"],
      tools: omaToolSpec(),
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
    expect(
      existsSync(
        join(project, ".opendock", "workdirs", safeDockDirectoryName("test/oma"), "AGENTS.md"),
      ),
    ).toBe(true);
  });

  it("seeds dock workdir files before running external commands", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    writeFakeOmaRequiresSeed(bin);
    writeDock(docks, "test", "oma", "1.0.0", {
      permission: ["oma -y install"],
      tools: omaToolSpec(),
      workdirFiles: [
        {
          path: "workdir/oma-config.yaml",
          to: ".agents/oma-config.yaml",
          content: "language: en\nmodel_preset: codex\nauto_update_cli: false\n",
        },
      ],
      tasks: {
        install: [
          {
            id: "apply-oma",
            run: "oma -y install",
            workdir: "dock",
            export: {
              include: [".agents/**", ".codex/**"],
              exclude: [],
            },
          },
        ],
      },
    });

    await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      install({
        dockRef: DockRef.parse("test/oma@1.0.0"),
        projectDir: project,
        phase: "install",
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    expect(
      readFileSync(
        join(
          project,
          ".opendock",
          "workdirs",
          safeDockDirectoryName("test/oma"),
          ".agents",
          "oma-config.yaml",
        ),
        "utf8",
      ),
    ).toContain("model_preset: codex");
    expect(readFileSync(join(project, ".agents", "oma-config.yaml"), "utf8")).toContain(
      "model_preset: codex",
    );
    expect(
      readFileSync(join(project, ".codex", "skills", "oma-brainstorm", "SKILL.md"), "utf8"),
    ).toContain("Codex Skill");
  });

  it("rejects exported symlinks that point outside the dock workdir", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const outside = tempDir();
    const outsideFile = join(outside, "architecture.md");
    writeFileSync(outsideFile, "# Outside\n");
    writeFakeOmaWithExternalSymlink(bin, outsideFile);
    writeDock(docks, "test", "oma", "1.0.0", {
      permission: ["oma -y install"],
      tools: omaToolSpec(),
      tasks: {
        install: [
          {
            id: "apply-oma",
            run: "oma -y install",
            workdir: "dock",
            export: {
              include: [".claude/**"],
              exclude: [],
            },
          },
        ],
      },
    });

    await expect(
      withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        install({
          dockRef: DockRef.parse("test/oma@1.0.0"),
          projectDir: project,
          phase: "install",
          runTasks: true,
          resolve: localResolver(docks),
        }),
      ),
    ).rejects.toThrow("source symlink target must stay inside");
    expect(existsSync(join(project, ".claude"))).toBe(false);
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
        phase: "update",
        runTasks: true,
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("checksum mismatch for managed block");

    await install({
      dockRef: DockRef.parse("test/designer@1.0.1"),
      force: true,
      projectDir: project,
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
        {
          path: ".github/instructions/legacy.instructions.md",
          content: "# Legacy Instructions\n",
        },
      ],
    });
    writeDock(docks, "test", "designer", "1.0.1", {
      files: [{ path: "AGENTS.md", content: "# Agent v2\n" }],
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });
    await install({
      dockRef: DockRef.parse("test/designer@1.0.1"),
      projectDir: project,
      phase: "update",
      runTasks: true,
      resolve: localResolver(docks),
    });

    expect(existsSync(join(project, "PROMPTS.md"))).toBe(false);
    expect(existsSync(join(project, ".github", "instructions"))).toBe(false);
    expect(existsSync(join(project, ".github"))).toBe(false);
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
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });
    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });

    let agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(agents).toContain("dock=test/oma");
    expect(agents).toContain("dock=test/designer");

    const uninstallReport = uninstall({ dockId: "test/designer", projectDir: project });
    agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(uninstallReport.fileChanges).toMatchObject({
      created: [],
      deleted: ["DESIGN.md"],
      updated: ["AGENTS.md"],
    });
    expect(agents).toContain("dock=test/oma");
    expect(agents).not.toContain("dock=test/designer");
    expect(existsSync(join(project, "DESIGN.md"))).toBe(false);
    expect(installedDocks(project).map((dock) => dock.id)).toEqual(["test/oma"]);
  });

  it("restores a shared runtime shim when uninstalling one of multiple runtime docks", async () => {
    const docks = tempDir();
    const project = tempDir();
    const home = realpathSync(tempDir());
    const node22Bin = tempDir();
    const node24Bin = tempDir();
    writeFakeVersionCommand(node22Bin, "node", "v22.12.0");
    writeFakeVersionCommand(node24Bin, "node", "v24.1.0");
    writeDock(docks, "test", "node22", "1.0.0", {
      requires: { runtimes: { node: ">=22.0.0 <23.0.0" } },
    });
    writeDock(docks, "test", "node24", "1.0.0", {
      requires: { runtimes: { node: ">=24.0.0 <25.0.0" } },
    });

    await withEnv({ HOME: home, PATH: `${node22Bin}:${process.env.PATH ?? ""}` }, () =>
      install({
        dockRef: DockRef.parse("test/node22@1.0.0"),
        projectDir: project,
        phase: "install",
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );
    await withEnv({ HOME: home, PATH: `${node24Bin}:${process.env.PATH ?? ""}` }, () =>
      install({
        dockRef: DockRef.parse("test/node24@1.0.0"),
        projectDir: project,
        phase: "install",
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    const shimPath = join(project, ".opendock", "bin", "node");
    expect(readFileSync(shimPath, "utf8")).toContain(
      join(home, ".opendock", "runtimes", "node", "24.1.0", "bin", "node"),
    );

    uninstall({ dockId: "test/node24", projectDir: project });
    const restoredShim = readFileSync(shimPath, "utf8");
    expect(restoredShim).toContain(
      join(home, ".opendock", "runtimes", "node", "22.12.0", "bin", "node"),
    );
    expect(restoredShim).not.toContain("24.1.0");

    uninstall({ dockId: "test/node22", projectDir: project });
    expect(existsSync(shimPath)).toBe(false);
  });

  it("prunes empty parent directories after uninstalling managed files", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "agent-ready", "1.0.0", {
      files: [
        {
          path: ".github/instructions/agent.instructions.md",
          content: "# Agent Instructions\n",
        },
        { path: ".codex/agents/reviewer.toml", content: 'name = "reviewer"\n' },
      ],
    });

    await install({
      dockRef: DockRef.parse("test/agent-ready@1.0.0"),
      projectDir: project,
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });

    uninstall({ dockId: "test/agent-ready", projectDir: project });

    expect(existsSync(join(project, ".github", "instructions", "agent.instructions.md"))).toBe(
      false,
    );
    expect(existsSync(join(project, ".github", "instructions"))).toBe(false);
    expect(existsSync(join(project, ".github"))).toBe(false);
    expect(existsSync(join(project, ".codex", "agents", "reviewer.toml"))).toBe(false);
    expect(existsSync(join(project, ".codex", "agents"))).toBe(false);
    expect(existsSync(join(project, ".codex"))).toBe(false);
  });

  it("does not prune directories that still contain user files", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "agent-ready", "1.0.0", {
      files: [
        {
          path: ".github/instructions/agent.instructions.md",
          content: "# Agent Instructions\n",
        },
        { path: ".cursor/rules/opendock.mdc", content: "# Cursor Rules\n" },
      ],
    });

    await install({
      dockRef: DockRef.parse("test/agent-ready@1.0.0"),
      projectDir: project,
      phase: "install",
      runTasks: true,
      resolve: localResolver(docks),
    });
    writeFileSync(join(project, ".github", "keep.md"), "# User file\n");
    writeFileSync(join(project, ".cursor", "rules", "user.mdc"), "# User rule\n");

    uninstall({ dockId: "test/agent-ready", projectDir: project });

    expect(existsSync(join(project, ".github", "instructions"))).toBe(false);
    expect(existsSync(join(project, ".github", "keep.md"))).toBe(true);
    expect(existsSync(join(project, ".github"))).toBe(true);
    expect(existsSync(join(project, ".cursor", "rules", "opendock.mdc"))).toBe(false);
    expect(existsSync(join(project, ".cursor", "rules", "user.mdc"))).toBe(true);
    expect(existsSync(join(project, ".cursor", "rules"))).toBe(true);
  });

  it("fails CLI update when the current directory has no OpenDock state", async () => {
    const project = tempDir();
    const previousExitCode = process.exitCode;

    try {
      await withCwd(project, async () => {
        await expect(runCli(["bun", "opendock", "update"])).rejects.toThrow(
          ".opendock/dock.lock.yml missing",
        );
      });
    } finally {
      restoreExitCode(previousExitCode);
    }
  });

  it("prints JSON update failures without throwing", async () => {
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
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });
    const agentsPath = join(project, "AGENTS.md");
    writeFileSync(
      agentsPath,
      readFileSync(agentsPath, "utf8").replace("# Version One", "# User Edit"),
    );

    const registry = mockRegistry([
      {
        archive: await createDockArchive(docks, "test", "designer", "1.0.1"),
        id: "test/designer",
        latest: true,
        platform: "macos",
        version: "1.0.1",
      },
    ]);
    const previousExitCode = process.exitCode;

    try {
      const logs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "update", "--json"])),
      );
      const output = JSON.parse(logs[0] ?? "{}");

      expect(process.exitCode).toBe(1);
      expect(output).toMatchObject({
        errorCode: "managed_file_modified",
        forceable: true,
        operation: "update",
        reports: [],
        success: false,
      });
      expect(output.message).toContain("checksum mismatch for managed block");
    } finally {
      restoreExitCode(previousExitCode);
      registry.restore();
    }
  });

  it("prints JSON uninstall failures without throwing", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Version One\n" }],
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });
    const agentsPath = join(project, "AGENTS.md");
    writeFileSync(
      agentsPath,
      readFileSync(agentsPath, "utf8").replace("# Version One", "# User Edit"),
    );
    const previousExitCode = process.exitCode;

    try {
      const logs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "uninstall", "test/designer", "--json"])),
      );
      const output = JSON.parse(logs[0] ?? "{}");

      expect(process.exitCode).toBe(1);
      expect(output).toMatchObject({
        errorCode: "managed_file_modified",
        forceable: true,
        operation: "uninstall",
        reports: [],
        success: false,
      });
      expect(output.message).toContain("checksum mismatch for managed block");
    } finally {
      restoreExitCode(previousExitCode);
    }
  });

  it("prints JSONL install events with the final change result", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    writeFakeOma(bin);
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent\n" }],
      permission: ["oma -y install"],
      tools: omaToolSpec(),
      tasks: {
        install: [
          {
            export: {
              exclude: [],
              include: ["CLAUDE.md"],
            },
            id: "apply-oma",
            run: "oma -y install",
            workdir: "dock",
          },
        ],
      },
    });
    const registry = mockRegistry([
      {
        archive: await createDockArchive(docks, "test", "designer", "1.0.0"),
        id: "test/designer",
        latest: false,
        platform: "macos",
        version: "1.0.0",
      },
    ]);

    try {
      const logs = await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        withCwd(project, () =>
          captureConsole(() =>
            runCli([
              "bun",
              "opendock",
              "install",
              "test/designer@1.0.0",
              "--platform",
              "macos",
              "--events",
            ]),
          ),
        ),
      );
      const events = parseJsonLines(logs);
      const result = events.at(-1);

      expect(events.every((event) => event.opendock === 1)).toBe(true);
      expect(
        events.some((event) => event.type === "progress" && event.phase === "resolve-start"),
      ).toBe(true);
      expect(events.some((event) => event.type === "progress" && event.phase === "task-run")).toBe(
        true,
      );
      expect(
        events.some((event) => event.type === "progress" && event.phase === "file-applied"),
      ).toBe(true);
      expect(result).toMatchObject({
        operation: "install",
        success: true,
        type: "result",
      });
      expect(result?.result?.reports?.[0]).toMatchObject({
        dockId: "test/designer",
        status: "installed",
        version: "1.0.0",
      });
    } finally {
      registry.restore();
    }
  });

  it("prints JSONL update events from internal update stages", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent v1\n" }],
    });
    writeDock(docks, "test", "designer", "1.0.1", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent v2\n" }],
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });

    const registry = mockRegistry([
      {
        archive: await createDockArchive(docks, "test", "designer", "1.0.1"),
        id: "test/designer",
        latest: true,
        platform: "macos",
        version: "1.0.1",
      },
    ]);

    try {
      const logs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "update", "--events"])),
      );
      const events = parseJsonLines(logs);
      const result = events.at(-1);

      expect(
        events.some((event) => event.type === "progress" && event.phase === "resolve-start"),
      ).toBe(true);
      expect(
        events.some((event) => event.type === "progress" && event.phase === "file-applied"),
      ).toBe(true);
      expect(result).toMatchObject({
        operation: "update",
        success: true,
        type: "result",
      });
      expect(result?.result?.reports?.[0]).toMatchObject({
        dockId: "test/designer",
        status: "updated",
        version: "1.0.1",
      });
    } finally {
      registry.restore();
    }
  });

  it("prints JSONL update events when no docks are outdated", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent\n" }],
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });

    const registry = mockRegistry([
      {
        id: "test/designer",
        latest: true,
        platform: "macos",
        version: "1.0.0",
      },
    ]);

    try {
      const logs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "update", "--events"])),
      );
      const events = parseJsonLines(logs);
      const result = events.at(-1);

      expect(events.some((event) => event.type === "progress" && event.percent === 100)).toBe(true);
      expect(result).toMatchObject({
        operation: "update",
        success: true,
        type: "result",
      });
      expect(result?.result?.reports).toEqual([]);
    } finally {
      registry.restore();
    }
  });

  it("prints JSONL uninstall events with the final change result", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent\n" }],
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });

    const logs = await withCwd(project, () =>
      captureConsole(() => runCli(["bun", "opendock", "uninstall", "test/designer", "--events"])),
    );
    const events = parseJsonLines(logs);
    const result = events.at(-1);

    expect(
      events.some((event) => event.type === "progress" && event.phase === "file-applied"),
    ).toBe(true);
    expect(result).toMatchObject({
      operation: "uninstall",
      success: true,
      type: "result",
    });
    expect(result?.result?.reports?.[0]).toMatchObject({
      dockId: "test/designer",
      status: "uninstalled",
      version: "1.0.0",
    });
  });

  it("lists installed docks in the current directory", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent\n" }],
    });
    writeDock(docks, "test", "frontend", "1.2.0", {
      files: [
        { path: "AGENTS.md", content: "# Frontend Agent\n" },
        { path: ".codex/agents/frontend.toml", content: 'name = "frontend"\n' },
      ],
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });
    await install({
      dockRef: DockRef.parse("test/frontend@1.2.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });

    const logs = await withCwd(project, () =>
      captureConsole(() => runCli(["bun", "opendock", "list"])),
    );

    expect(logs).toContain("OpenDock Docks");
    expect(logs.some((line) => line.startsWith("Project: "))).toBe(true);
    expect(logs).toContain("Installed:");
    expect(logs).toContain("- test/designer@1.0.0 [macos] (1 file)");
    expect(logs).toContain("- test/frontend@1.2.0 [macos] (2 files)");

    const jsonLogs = await withCwd(project, () =>
      captureConsole(() => runCli(["bun", "opendock", "list", "--json"])),
    );
    const listJson = JSON.parse(jsonLogs[0] ?? "{}");
    expect(listJson).toMatchObject({
      hasState: true,
      operation: "list",
      reports: [
        { dockId: "test/designer", fileCount: 1, platform: "macos", status: "installed" },
        { dockId: "test/frontend", fileCount: 2, platform: "macos", status: "installed" },
      ],
      success: true,
      summary: { installed: ["test/designer", "test/frontend"] },
    });
    expect(listJson.docks).toHaveLength(2);
    expect(listJson.docks.map((dock: InstalledDockRecord) => dock.id)).toEqual([
      "test/designer",
      "test/frontend",
    ]);
  });

  it("prints large installed dock JSON without truncating piped stdout", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "large", "1.0.0", {
      files: Array.from({ length: 700 }, (_, index) => ({
        path: `generated/file-${String(index).padStart(4, "0")}.txt`,
        content: `file ${index}\n`,
      })),
    });

    await install({
      dockRef: DockRef.parse("test/large@1.0.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });

    const result = spawnSync("bun", [join(process.cwd(), "src/cli.ts"), "list", "--json"], {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(65_536);
    const listJson = JSON.parse(result.stdout);
    expect(listJson.docks).toHaveLength(1);
    expect(listJson.docks[0]).toMatchObject({
      id: "test/large",
      version: "1.0.0",
    });
    expect(listJson.reports).toEqual([
      {
        dockId: "test/large",
        fileCount: 700,
        platform: "macos",
        requested: "1.0.0",
        status: "installed",
        version: "1.0.0",
      },
    ]);

    const summaryResult = spawnSync(
      "bun",
      [join(process.cwd(), "src/cli.ts"), "list", "--json", "--summary"],
      {
        cwd: project,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      },
    );

    expect(summaryResult.status).toBe(0);
    expect(summaryResult.stdout.length).toBeLessThan(20_000);
    const summaryJson = JSON.parse(summaryResult.stdout);
    expect(summaryJson.docks[0]).toMatchObject({
      fileCount: 700,
      id: "test/large",
      version: "1.0.0",
    });
    expect(summaryJson.docks[0].files).toBeUndefined();

    const uninstallResult = spawnSync(
      "bun",
      [join(process.cwd(), "src/cli.ts"), "uninstall", "test/large", "--json", "--summary"],
      {
        cwd: project,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      },
    );

    expect(uninstallResult.status).toBe(0);
    expect(uninstallResult.stdout.length).toBeLessThan(20_000);
    const uninstallJson = JSON.parse(uninstallResult.stdout);
    expect(uninstallJson.reports[0]).toMatchObject({
      dockId: "test/large",
      filesDeleted: 700,
      version: "1.0.0",
    });
    expect(uninstallJson.reports[0].fileChanges.deleted).toHaveLength(24);
    expect(uninstallJson.summary.deleted).toHaveLength(24);
    expect(uninstallJson.summaryCounts.deleted).toBe(700);
  });

  it("prints an empty list message when the current directory has no OpenDock state", async () => {
    const project = tempDir();
    const logs = await withCwd(project, () =>
      captureConsole(() => runCli(["bun", "opendock", "list"])),
    );

    expect(logs).toEqual(["No OpenDock docks installed in this project."]);

    const jsonLogs = await withCwd(project, () =>
      captureConsole(() => runCli(["bun", "opendock", "list", "--json"])),
    );
    expect(JSON.parse(jsonLogs[0] ?? "{}")).toMatchObject({
      docks: [],
      hasState: false,
      operation: "list",
      reports: [],
      success: true,
      summary: { installed: [] },
    });
  });

  it("runs doctor checks for only the requested installed dock", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent\n" }],
      tasks: {
        doctor: [{ id: "designer-ready", check: "test -f AGENTS.md" }],
      },
    });
    writeDock(docks, "test", "frontend", "1.0.0", {
      files: [{ path: "FRONTEND.md", content: "# Frontend\n" }],
      tasks: {
        doctor: [{ id: "frontend-ready", check: "test -f FRONTEND.md" }],
      },
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });
    await install({
      dockRef: DockRef.parse("test/frontend@1.0.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });

    const registry = mockRegistry([
      {
        archive: await createDockArchive(docks, "test", "designer", "1.0.0"),
        id: "test/designer",
        platform: "macos",
        version: "1.0.0",
      },
      {
        archive: await createDockArchive(docks, "test", "frontend", "1.0.0"),
        id: "test/frontend",
        platform: "macos",
        version: "1.0.0",
      },
    ]);

    try {
      const logs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "doctor", "test/designer"])),
      );

      expect(logs).toContain("✓ test/designer@1.0.0 [macos]");
      expect(logs).toContain("✓ designer-ready");
      expect(logs.some((line) => line.includes("test/frontend"))).toBe(false);
      expect(logs.some((line) => line.includes("frontend-ready"))).toBe(false);
    } finally {
      registry.restore();
    }
  });

  it("rejects doctor for a dock that is not installed", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent\n" }],
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });

    await expect(
      withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "doctor", "test/frontend"])),
      ),
    ).rejects.toThrow("dock `test/frontend` is not installed in this project");
  });

  it("records command logs for successes, failures, and skipped work", async () => {
    const docks = tempDir();
    const home = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent\n" }],
    });
    const registry = mockRegistry([
      {
        archive: await createDockArchive(docks, "test", "designer", "1.0.0"),
        id: "test/designer",
        latest: true,
        platform: "macos",
        version: "1.0.0",
      },
    ]);
    const previousExitCode = process.exitCode;

    try {
      await withEnv({ HOME: home }, async () => {
        await withCwd(project, () =>
          captureConsole(() =>
            runCli(["bun", "opendock", "install", "test/designer@1.0.0", "--platform", "macos"]),
          ),
        );
        await withCwd(project, () => captureConsole(() => runCli(["bun", "opendock", "list"])));
        await withCwd(project, () => captureConsole(() => runCli(["bun", "opendock", "outdated"])));
        await withCwd(project, () => captureConsole(() => runCli(["bun", "opendock", "update"])));

        const agentsPath = join(project, "AGENTS.md");
        writeFileSync(
          agentsPath,
          readFileSync(agentsPath, "utf8").replace("# Designer Agent", "# User Edit"),
        );
        await withCwd(project, () =>
          captureConsole(() => runCli(["bun", "opendock", "uninstall", "test/designer", "--json"])),
        );
        restoreExitCode(previousExitCode);
        await withCwd(project, () => captureConsole(() => runCli(["bun", "opendock", "log"])));

        expect(
          readProjectLogs(project).map(({ command, status }) => ({ command, status })),
        ).toEqual([
          { command: "install", status: "Success" },
          { command: "list", status: "Success" },
          { command: "outdated", status: "Skipped" },
          { command: "update", status: "Skipped" },
          { command: "uninstall", status: "Failure" },
          { command: "log", status: "Success" },
        ]);
      });
    } finally {
      restoreExitCode(previousExitCode);
      registry.restore();
    }
  });

  it("checks installed docks for newer Registry releases", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent\n" }],
    });
    writeDock(docks, "test", "designer", "1.0.1", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent v2\n" }],
    });
    writeDock(docks, "test", "frontend", "1.2.0", {
      files: [{ path: "FRONTEND.md", content: "# Frontend\n" }],
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });
    await install({
      dockRef: DockRef.parse("test/frontend@1.2.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });

    const registry = mockRegistry([
      {
        archive: await createDockArchive(docks, "test", "designer", "1.0.1"),
        id: "test/designer",
        latest: true,
        platform: "macos",
        version: "1.0.1",
      },
      {
        id: "test/frontend",
        latest: true,
        platform: "macos",
        version: "1.2.0",
      },
    ]);

    try {
      const outdatedLogs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "outdated"])),
      );
      expect(outdatedLogs).toContain("OpenDock Updates");
      expect(outdatedLogs).toContain("Updates:");
      expect(outdatedLogs).toContain("~ test/designer: 1.0.0 -> 1.0.1 [macos]");
      expect(outdatedLogs).toContain("Current:");
      expect(outdatedLogs).toContain("✓ test/frontend@1.2.0 [macos]");

      const updateLogs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "update"])),
      );
      expect(updateLogs.some((line) => line.includes("test/designer"))).toBe(true);
      expect(updateLogs.some((line) => line.includes("test/frontend"))).toBe(false);
    } finally {
      registry.restore();
    }

    expect(installedDocks(project)).toMatchObject([
      { id: "test/designer", version: "1.0.1" },
      { id: "test/frontend", version: "1.2.0" },
    ]);
    expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toContain("# Designer Agent v2");
    expect(
      registry.requestedUrls.some(
        (url) => url.includes("test/frontend") && url.includes("download"),
      ),
    ).toBe(false);
  });

  it("continues installed dock update checks when one Registry lookup fails", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent\n" }],
    });
    writeDock(docks, "test", "designer", "1.0.1", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent v2\n" }],
    });
    writeDock(docks, "test", "frontend", "1.2.0", {
      files: [{ path: "FRONTEND.md", content: "# Frontend\n" }],
    });
    writeDock(docks, "test", "missing", "1.0.0", {
      files: [{ path: "MISSING.md", content: "# Missing\n" }],
    });

    for (const dockRef of [
      DockRef.parse("test/designer@1.0.0"),
      DockRef.parse("test/frontend@1.2.0"),
      DockRef.parse("test/missing@1.0.0"),
    ]) {
      await install({
        dockRef,
        projectDir: project,
        phase: "install",
        platform: "macos",
        runTasks: true,
        resolve: localResolver(docks),
      });
    }

    const registry = mockRegistry([
      {
        archive: await createDockArchive(docks, "test", "designer", "1.0.1"),
        id: "test/designer",
        latest: true,
        platform: "macos",
        version: "1.0.1",
      },
      {
        id: "test/frontend",
        latest: true,
        platform: "macos",
        version: "1.2.0",
      },
    ]);

    try {
      const outdatedLogs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "outdated"])),
      );
      expect(outdatedLogs).toContain("Updates:");
      expect(outdatedLogs).toContain("~ test/designer: 1.0.0 -> 1.0.1 [macos]");
      expect(outdatedLogs).toContain("Current:");
      expect(outdatedLogs).toContain("✓ test/frontend@1.2.0 [macos]");
      expect(outdatedLogs).toContain("Unavailable:");
      expect(outdatedLogs.some((line) => line.startsWith("! test/missing:"))).toBe(true);

      await withCwd(project, () => captureConsole(() => runCli(["bun", "opendock", "update"])));
    } finally {
      registry.restore();
    }

    expect(installedDocks(project)).toMatchObject([
      { id: "test/designer", version: "1.0.1" },
      { id: "test/frontend", version: "1.2.0" },
      { id: "test/missing", version: "1.0.0" },
    ]);
    expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toContain("# Designer Agent v2");
    expect(
      registry.requestedUrls.some(
        (url) => url.includes("test/missing") && url.includes("download"),
      ),
    ).toBe(false);
  });

  it("skips update when no installed dock has a newer Registry release", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "designer", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Designer Agent\n" }],
    });

    await install({
      dockRef: DockRef.parse("test/designer@1.0.0"),
      projectDir: project,
      phase: "install",
      platform: "macos",
      runTasks: true,
      resolve: localResolver(docks),
    });

    const registry = mockRegistry([
      {
        id: "test/designer",
        latest: true,
        platform: "macos",
        version: "1.0.0",
      },
    ]);

    try {
      const outdatedLogs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "outdated"])),
      );
      expect(outdatedLogs).toContain("No OpenDock dock updates available.");

      const updateLogs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "update"])),
      );
      expect(updateLogs).toEqual(["No OpenDock dock updates available."]);
    } finally {
      registry.restore();
    }

    expect(installedDocks(project)).toMatchObject([{ id: "test/designer", version: "1.0.0" }]);
    expect(registry.requestedUrls.some((url) => url.includes("download"))).toBe(false);
  });

  it("rejects unsafe commands", () => {
    const project = tempDir();
    const manifest: DockManifest = {
      opendock: 1,
      id: "test/unsafe",
      summary: "",
      tags: [],
      permission: [],
      requires: { runtimes: {} },
      files: [],
      tasks: {
        install: [{ id: "inline", run: 'node -e "console.log(1)"', platforms: {} }],
        update: [],
        doctor: [],
      },
    };

    expect(() => runTasks(manifest, "install", project)).toThrow("not allowed");
  });

  it("rejects unsafe OMA link vendor arguments", () => {
    const project = tempDir();
    const manifest: DockManifest = {
      opendock: 1,
      id: "test/unsafe-oma-link",
      summary: "",
      tags: [],
      permission: [],
      requires: { runtimes: {} },
      files: [],
      tasks: {
        install: [{ id: "link", run: "oma link ../codex", platforms: {} }],
        update: [],
        doctor: [],
      },
    };

    expect(() => runTasks(manifest, "install", project)).toThrow("not allowed");
  });

  it("rejects hardlinked files during deploy archive creation", async () => {
    const dockRoot = tempDir();
    const outside = tempDir();
    mkdirSync(join(dockRoot, "files"), { recursive: true });
    const outsideFile = join(outside, "secret.md");
    writeFileSync(outsideFile, "# Secret from outside\n");
    linkSync(outsideFile, join(dockRoot, "files", "secret.md"));
    writeFileSync(
      join(dockRoot, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        summary: "Hardlink dock",
        files: [{ from: "files/secret.md", to: "secret.md" }],
      }),
    );

    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("deploy should not reach registry");
    }) as typeof fetch;

    try {
      await withCwd(dockRoot, async () => {
        await expect(runCli(["bun", "opendock", "deploy", "test/hardlink@1.0.0"])).rejects.toThrow(
          "hardlink",
        );
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("rejects unsafe task commands during deploy before registry submission", async () => {
    const dockRoot = tempDir();
    writeFileSync(
      join(dockRoot, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        summary: "Unsafe doctor dock",
        doctor: [
          {
            id: "bad-check",
            check: "test -f AGENTS.md && test -f README.md",
          },
        ],
      }),
    );

    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("deploy should not reach registry");
    }) as typeof fetch;

    try {
      await withCwd(dockRoot, async () => {
        await expect(
          runCli(["bun", "opendock", "deploy", "test/unsafe-doctor@1.0.0"]),
        ).rejects.toThrow(/invalid doctor step `bad-check` check: .*shell operators/);
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("submits platform-specific deploy manifests as dock.yml archives", async () => {
    const dockRoot = tempDir();
    const extractRoot = tempDir();
    const home = tempDir();
    const dataDir = join(home, "Library", "Application Support", "OpenDock");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "auth-token"), "test-token");
    mkdirSync(join(dockRoot, "macos", "files"), { recursive: true });
    mkdirSync(join(dockRoot, "macos", "files", ".opendock", "harness", "test__platform-dock"), {
      recursive: true,
    });
    mkdirSync(join(dockRoot, "macos", "inputs"), { recursive: true });
    writeFileSync(join(dockRoot, "macos", "files", "AGENTS.md"), "# macOS Agent\n");
    writeFileSync(
      join(dockRoot, "macos", "files", ".opendock", "harness", "test__platform-dock", "check.mjs"),
      "console.log('ok');\n",
    );
    writeFileSync(
      join(dockRoot, "macos", "inputs", "oma-config.yaml"),
      "language: en\nmodel_preset: codex\n",
    );
    writeFileSync(join(dockRoot, "macos", "DOCK.md"), "# macOS Dock\n");
    writeFileSync(
      join(dockRoot, "macos", "logo.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    writeFileSync(
      join(dockRoot, "macos", "dock.macos.yml"),
      YAML.stringify({
        opendock: 1,
        summary: "macOS artifact",
        readme: "DOCK.md",
        logo: "logo.png",
        tags: ["testing", "ai-agent"],
        workdir: {
          files: [{ from: "inputs/oma-config.yaml", to: ".agents/oma-config.yaml" }],
        },
        files: [
          { from: "files/AGENTS.md", to: "AGENTS.md" },
          {
            from: "files/.opendock/harness/test__platform-dock/check.mjs",
            to: ".opendock/harness/test__platform-dock/check.mjs",
          },
        ],
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
    expect(body.manifest).not.toContain("id: test/platform-dock");
    expect(body.manifest).toContain("tags:");
    expect(body.manifest).toContain("- testing");

    const archivePath = join(extractRoot, "dock.tgz");
    writeFileSync(archivePath, Buffer.from(body.archive.data_base64, "base64"));
    await extractTar({ file: archivePath, cwd: extractRoot });
    const archivedManifest = readFileSync(join(extractRoot, "dock.yml"), "utf8");
    expect(archivedManifest).toContain("summary: macOS artifact");
    expect(archivedManifest).not.toContain("id: test/platform-dock");
    expect(archivedManifest).toContain("tags:");
    expect(archivedManifest).toContain("- testing");
    expect(readFileSync(join(extractRoot, "files", "AGENTS.md"), "utf8")).toBe("# macOS Agent\n");
    expect(
      readFileSync(
        join(extractRoot, "files", ".opendock", "harness", "test__platform-dock", "check.mjs"),
        "utf8",
      ),
    ).toBe("console.log('ok');\n");
    expect(readFileSync(join(extractRoot, "inputs", "oma-config.yaml"), "utf8")).toContain(
      "model_preset: codex",
    );
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

  it("submits deploys for the current host platform by default", async () => {
    const dockRoot = tempDir();
    const home = tempDir();
    const dataDir = join(home, "Library", "Application Support", "OpenDock");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "auth-token"), "test-token");
    mkdirSync(join(dockRoot, "files"), { recursive: true });
    writeFileSync(join(dockRoot, "files", "AGENTS.md"), "# Host Agent\n");
    writeFileSync(
      join(dockRoot, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        summary: "host platform artifact",
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
        withCwd(dockRoot, () => runCli(["bun", "opendock", "deploy", "test/host-dock@1.0.0"])),
      );
    } finally {
      globalThis.fetch = previousFetch;
    }

    if (!body) {
      throw new Error("expected deploy request body");
    }
    const platform = detectPlatform();
    expect(body.platform).toBe(platform);
    expect(body.archive.filename).toBe(`test-host-dock-1.0.0-${platform}.tgz`);
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
    workdirFiles?: Array<{ path: string; to: string; content: string }>;
    permission?: string[];
    requires?: { runtimes?: Record<string, string> };
    tools?: Record<string, unknown>;
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
    permission: options.permission ?? [],
    requires: options.requires ?? { runtimes: {} },
    tools: options.tools ?? {},
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

function localResolver(root: string) {
  return (dockRef: DockRef, platform: OpenDockPlatform): ResolvedDock => {
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

interface MockRegistryRelease {
  archive?: Buffer;
  id: string;
  latest?: boolean;
  platform: OpenDockPlatform;
  version: string;
}

function mockRegistry(releases: MockRegistryRelease[]): {
  requestedUrls: string[];
  restore: () => void;
} {
  const previousFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());
    const match = url.pathname.match(
      /^\/v1\/docks\/([^/]+)\/([^/]+)\/versions\/([^/]+)(\/download)?$/,
    );
    if (!match) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    const [, owner, name, rawSelector, download] = match;
    const id = `${owner}/${name}`;
    const selector = decodeURIComponent(rawSelector ?? "");
    const platform = url.searchParams.get("platform");
    const release = releases.find(
      (candidate) =>
        candidate.id === id &&
        candidate.platform === platform &&
        (selector === "latest" ? candidate.latest === true : candidate.version === selector),
    );
    if (!release) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    if (download) {
      if (!release.archive) {
        return new Response("archive missing", { status: 404, statusText: "Not Found" });
      }
      return new Response(release.archive, {
        headers: { "content-length": String(release.archive.length) },
        status: 200,
      });
    }
    const checksum = release.archive === undefined ? "metadata-only" : sha256(release.archive);
    return new Response(
      JSON.stringify({
        approved: true,
        checksum,
        id: release.id,
        platform: release.platform,
        signature: testReleaseSignature({
          id: release.id,
          version: release.version,
          platform: release.platform,
          checksum,
        }),
        version: release.version,
      }),
      { headers: { "content-type": "application/json" }, status: 200 },
    );
  }) as typeof fetch;

  return {
    requestedUrls,
    restore: () => {
      globalThis.fetch = previousFetch;
    },
  };
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

function writeFakeOma(bin: string): void {
  writeFakeBunTool(
    bin,
    "oma",
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
}

function writeFakeOmaRequiresSeed(bin: string): void {
  writeFakeBunTool(
    bin,
    "oma",
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$*" = "-y install" ]; then
  test -f .agents/oma-config.yaml
  grep -q 'model_preset: codex' .agents/oma-config.yaml
  mkdir -p .codex/skills/oma-brainstorm
  printf '# Codex Skill\\n' > .codex/skills/oma-brainstorm/SKILL.md
  exit 0
fi
exit 1
`,
  );
}

function writeFakeOmaWithExternalSymlink(bin: string, outsideFile: string): void {
  writeFakeBunTool(
    bin,
    "oma",
    `#!/usr/bin/env bash
set -euo pipefail
mode="\${*: -1}"
case "$mode" in
  install)
    mkdir -p .claude/skills/architecture
    ln -s "${outsideFile}" .claude/skills/architecture/SKILL.md
    ;;
esac
`,
  );
}

function omaToolSpec(): Record<string, unknown> {
  return {
    oma: {
      manager: "bun",
      package: "oh-my-agent",
      version: "8.52.9",
      commands: ["oma"],
    },
  };
}

function writeFakeBunTool(bin: string, command: string, script: string): void {
  writeFileSync(join(bin, command), script);
  chmod(join(bin, command));
  writeFileSync(
    join(bin, "bun"),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "--version" ]; then
  printf '1.3.11\\n'
  exit 0
fi
if [ "$1" = "add" ]; then
  mkdir -p node_modules/.bin
  cat > node_modules/.bin/${command} <<'OPENDOCK_FAKE_TOOL'
${script}
OPENDOCK_FAKE_TOOL
  chmod +x node_modules/.bin/${command}
  exit 0
fi
exit 1
`,
  );
  chmod(join(bin, "bun"));
}

function chmod(path: string): void {
  chmodSync(path, 0o755);
}

function writeFakeVersionCommand(bin: string, command: string, version: string): void {
  mkdirSync(bin, { recursive: true });
  const path = join(bin, command);
  writeFileSync(
    path,
    `#!/bin/sh
set -eu
printf '${version}\\n'
`,
  );
  chmod(path);
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

async function captureConsole(fn: () => Promise<void>): Promise<string[]> {
  const previous = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    await fn();
    return logs;
  } finally {
    console.log = previous;
  }
}

interface TestOpenDockEvent {
  opendock?: number;
  operation?: string;
  percent?: number;
  phase?: string;
  result?: {
    reports?: Array<Record<string, unknown>>;
  };
  success?: boolean;
  type?: string;
}

function parseJsonLines(lines: string[]): TestOpenDockEvent[] {
  return lines.map((line) => JSON.parse(line) as TestOpenDockEvent);
}
