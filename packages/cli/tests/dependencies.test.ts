import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { DockInstaller } from "../src/core/app/dock-installer.js";
import { DockRef, manifestForRef, parseManifestFile } from "../src/core/domain/manifest.js";
import { OpenDockStateStore } from "../src/core/domain/state-store.js";
import { safeDockDirectoryName } from "../src/core/files/path-utils.js";
import {
  DependencyRunner,
  removeInstalledDependencyOutputs,
} from "../src/core/runtime/dependency-runner.js";
import {
  resolveProgramFromPath,
  windowsBatchSpawnArgs,
} from "../src/core/runtime/process-spawn.js";
import type { ResolvedDock } from "../src/resolver.js";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("dock dependencies", () => {
  it("supports image2html-style copied package payloads without task package installs", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/sharp/package.json");
    writeDock(docks, "test", "image2html-payload", "1.0.0", {
      dependencies: {
        image2html: {
          manager: "npm",
          path: ".codex/skills/image2html",
          mode: "install",
        },
      },
      files: [
        { path: ".codex/skills/image2html/SKILL.md", content: "# Image2HTML\n" },
        { path: ".codex/skills/image2html/scripts/run-harness.mjs", content: "export {}\n" },
        { path: ".codex/skills/image2html/package.json", content: '{"name":"image2html"}\n' },
        { path: ".codex/skills/image2html/package-lock.json", content: '{"lockfileVersion":3}\n' },
      ],
    });

    const report = await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/image2html-payload@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    const dependencyPath = join(realpathSync(project), ".codex", "skills", "image2html");
    expect(report.steps.map((step) => `${step.id}:${step.status}`)).toContain(
      "dependency-image2html:Ready",
    );
    expect(readFileSync(log, "utf8")).toContain(
      `npm:${dependencyPath}:install --no-audit --no-fund`,
    );
    expect(existsSync(join(dependencyPath, "node_modules", "sharp", "package.json"))).toBe(true);
  });

  it("installs dependencies after managed files and removes generated dependency folders", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/sharp/package.json");
    writeDock(docks, "test", "image2html", "1.0.0", {
      dependencies: {
        image2html: {
          manager: "npm",
          path: ".codex/skills/image2html",
          mode: "locked",
        },
      },
      files: [
        { path: ".codex/skills/image2html/SKILL.md", content: "# Image2HTML\n" },
        { path: ".codex/skills/image2html/package.json", content: '{"name":"image2html"}\n' },
        { path: ".codex/skills/image2html/package-lock.json", content: '{"lockfileVersion":3}\n' },
      ],
    });

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/image2html@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    const dependencyPath = join(realpathSync(project), ".codex", "skills", "image2html");
    expect(readFileSync(log, "utf8")).toContain(`npm:${dependencyPath}:ci --no-audit --no-fund`);
    expect(existsSync(join(dependencyPath, "node_modules", "sharp", "package.json"))).toBe(true);
    expect(new OpenDockStateStore(project).readLock().docks[0]?.dependencies).toEqual([
      {
        manager: "npm",
        mode: "locked",
        name: "image2html",
        path: ".codex/skills/image2html",
      },
    ]);

    new DockInstaller().uninstall({
      dockId: "test/image2html",
      projectDir: project,
      force: false,
    });

    expect(existsSync(dependencyPath)).toBe(false);
  });

  it("reinstalls dependency outputs during update and removes stale generated folders", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/sharp/package.json");
    writeDock(docks, "test", "image2html", "1.0.0", {
      dependencies: {
        image2html: {
          manager: "npm",
          path: ".codex/skills/image2html",
          mode: "install",
        },
      },
      files: [
        { path: ".codex/skills/image2html/package.json", content: '{"name":"image2html"}\n' },
        { path: ".codex/skills/image2html/package-lock.json", content: '{"lockfileVersion":3}\n' },
      ],
    });

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/image2html@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    const dependencyPath = join(realpathSync(project), ".codex", "skills", "image2html");
    writeFileSync(join(dependencyPath, "node_modules", "stale.txt"), "old dependency output\n");

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/image2html@1.0.0"),
        projectDir: project,
        phase: "update",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    expect(existsSync(join(dependencyPath, "node_modules", "stale.txt"))).toBe(false);
    expect(existsSync(join(dependencyPath, "node_modules", "sharp", "package.json"))).toBe(true);
    expect(readFileSync(log, "utf8").match(/npm:/g)).toHaveLength(2);
  });

  it("replaces dependency lock records and cleans removed dependency paths during update", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/installed.txt");
    writeDock(docks, "test", "changing-deps", "1.0.0", {
      dependencies: {
        image2html: {
          manager: "npm",
          path: "deps/image2html",
          mode: "install",
        },
      },
      files: [{ path: "deps/image2html/package.json", content: '{"name":"image2html"}\n' }],
    });
    writeDock(docks, "test", "changing-deps", "1.0.1", {
      dependencies: {
        renderer: {
          manager: "npm",
          path: "deps/renderer",
          mode: "locked",
        },
      },
      files: [
        { path: "deps/renderer/package.json", content: '{"name":"renderer"}\n' },
        { path: "deps/renderer/package-lock.json", content: '{"lockfileVersion":3}\n' },
      ],
    });

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/changing-deps@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/changing-deps@1.0.1"),
        projectDir: project,
        phase: "update",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    expect(existsSync(join(project, "deps", "image2html"))).toBe(false);
    expect(existsSync(join(project, "deps", "renderer", "node_modules", "installed.txt"))).toBe(
      true,
    );
    expect(new OpenDockStateStore(project).readLock().docks[0]?.dependencies).toEqual([
      {
        manager: "npm",
        mode: "locked",
        name: "renderer",
        path: "deps/renderer",
      },
    ]);
    expect(readFileSync(log, "utf8")).toContain("npm:");
  });

  it("rolls back copied files when dependency installation fails so install can retry", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFailingDependencyManager(bin, "npm", log);
    writeDock(docks, "test", "failing-deps", "1.0.0", {
      dependencies: {
        harness: {
          manager: "npm",
          path: "harness",
        },
      },
      files: [
        { path: "README.md", content: "# Applied before dependency failure\n" },
        { path: "harness/package.json", content: '{"name":"harness"}\n' },
        { path: "harness/package-lock.json", content: '{"lockfileVersion":3}\n' },
      ],
    });

    await expect(
      withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DockInstaller().install({
          dockRef: DockRef.parse("test/failing-deps@1.0.0"),
          projectDir: project,
          phase: "install",
          platform: "macos",
          live: false,
          runTasks: true,
          resolve: localResolver(docks),
        }),
      ),
    ).rejects.toThrow("dependency `harness` install failed");

    expect(existsSync(join(project, "README.md"))).toBe(false);
    expect(existsSync(join(project, "harness", "package.json"))).toBe(false);
    expect(existsSync(join(project, "harness", "package-lock.json"))).toBe(false);
    expect(new OpenDockStateStore(project).readLock().docks).toEqual([]);
    expect(readFileSync(log, "utf8")).toContain("npm:");

    const retryBin = tempDir();
    const retryLog = join(project, "retry-commands.log");
    writeFakeDependencyManager(retryBin, "npm", retryLog, "node_modules/pkg.txt");
    await withEnvAsync({ PATH: `${retryBin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/failing-deps@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    expect(existsSync(join(project, "harness", "node_modules", "pkg.txt"))).toBe(true);
    expect(new OpenDockStateStore(project).readLock().docks[0]?.id).toBe("test/failing-deps");
  });

  it.each([
    ["npm", "ci"],
    ["uv", "sync"],
  ] as const)("rejects legacy dependency mode %s/%s before mutating project", async (manager, mode) => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(
      bin,
      manager,
      log,
      manager === "uv" ? ".venv/uv.txt" : "node_modules/pkg.txt",
    );
    writeDock(docks, "test", `legacy-${manager}`, "1.0.0", {
      dependencies: {
        legacy: {
          manager,
          path: "legacy",
          mode,
        },
      },
      files: [
        { path: "README.md", content: "# Should not be applied\n" },
        { path: "legacy/package.json", content: '{"name":"legacy"}\n' },
      ],
    });

    await expect(
      withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DockInstaller().install({
          dockRef: DockRef.parse(`test/legacy-${manager}@1.0.0`),
          projectDir: project,
          phase: "install",
          platform: "macos",
          live: false,
          runTasks: true,
          resolve: localResolver(docks),
        }),
      ),
    ).rejects.toThrow(`dependency manager \`${manager}\` does not support mode \`${mode}\``);

    expect(new OpenDockStateStore(project).readLock().docks).toEqual([]);
    expect(existsSync(join(project, "README.md"))).toBe(false);
    expect(existsSync(join(project, "legacy"))).toBe(false);
    expect(existsSync(log)).toBe(false);
  });

  it("does not run dependency managers when file preflight fails", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/sharp/package.json");
    writeFileSync(join(project, "config.json"), '{"user":true}\n');
    writeDock(docks, "test", "preflight-conflict", "1.0.0", {
      dependencies: {
        docs: {
          manager: "npm",
          path: "harness",
        },
      },
      files: [
        { path: "config.json", content: '{"dock":true}\n' },
        { path: "harness/package.json", content: '{"name":"harness"}\n' },
      ],
    });

    await expect(
      withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DockInstaller().install({
          dockRef: DockRef.parse("test/preflight-conflict@1.0.0"),
          projectDir: project,
          phase: "install",
          platform: "macos",
          live: false,
          runTasks: true,
          resolve: localResolver(docks),
        }),
      ),
    ).rejects.toThrow("target already exists and is not OpenDock-owned: config.json");

    expect(existsSync(log)).toBe(false);
    expect(existsSync(join(project, "harness", "node_modules"))).toBe(false);
  });

  it("defaults uv dependency mode to install without frozen sync", () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "uv", log, ".venv/uv.txt");
    mkdirSync(join(project, "deps", "uv-default"), { recursive: true });
    writeFileSync(
      join(project, "deps", "uv-default", "pyproject.toml"),
      "[project]\nname='demo'\n",
    );
    const manifest = manifestForRef(
      parseManifestText({
        opendock: 1,
        dependencies: {
          uvDefault: { manager: "uv", path: "deps/uv-default" },
        },
      }),
      DockRef.parse("test/uv-default@1.0.0"),
    );

    const result = withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DependencyRunner().run(manifest, {
        projectDir: project,
        dockId: "test/uv-default",
        phase: "install",
        platform: "macos",
        live: false,
      }),
    );

    const dependencyPath = join(realpathSync(project), "deps", "uv-default");
    expect(result.dependencies).toEqual([
      {
        manager: "uv",
        mode: "install",
        name: "uvDefault",
        path: "deps/uv-default",
      },
    ]);
    expect(readFileSync(log, "utf8")).toBe(`uv:${dependencyPath}:sync\n`);
    expect(existsSync(join(dependencyPath, ".venv", "uv.txt"))).toBe(true);
  });

  it("runs supported dependency managers with manager-specific modes", () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/npm.txt");
    writeFakeDependencyManager(bin, "pnpm", log, "node_modules/pnpm.txt");
    writeFakeDependencyManager(bin, "bun", log, "node_modules/bun.txt");
    writeFakeDependencyManager(bin, "uv", log, ".venv/uv.txt");
    writeFakePip(bin, "pip", log);
    writeFakePip(bin, "pip3", log);
    for (const name of ["npm-deps", "pnpm-deps", "bun-deps", "uv-deps", "pip-deps", "pip3-deps"]) {
      mkdirSync(join(project, "deps", name), { recursive: true });
      writeFileSync(join(project, "deps", name, "package.json"), "{}\n");
      writeFileSync(join(project, "deps", name, "requirements.txt"), "demo==1.0.0\n");
      writeFileSync(join(project, "deps", name, "pyproject.toml"), "[project]\nname='demo'\n");
    }
    const manifest = manifestForRef(
      parseManifestText({
        opendock: 1,
        dependencies: {
          npm: { manager: "npm", path: "deps/npm-deps", mode: "locked" },
          pnpm: { manager: "pnpm", path: "deps/pnpm-deps", mode: "locked" },
          bun: { manager: "bun", path: "deps/bun-deps", mode: "locked" },
          uv: { manager: "uv", path: "deps/uv-deps", mode: "locked" },
          pip: { manager: "pip", path: "deps/pip-deps" },
          pip3: { manager: "pip3", path: "deps/pip3-deps" },
        },
      }),
      DockRef.parse("test/deps@1.0.0"),
    );

    const result = withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DependencyRunner().run(manifest, {
        projectDir: project,
        dockId: "test/deps",
        phase: "install",
        platform: "macos",
        live: false,
      }),
    );

    expect(result.reports.every((report) => report.status === "Ready")).toBe(true);
    expect(result.dependencies.map((dependency) => dependency.name).sort()).toEqual([
      "bun",
      "npm",
      "pip",
      "pip3",
      "pnpm",
      "uv",
    ]);
    const dependencyRoot = realpathSync(project);
    const logLines = readFileSync(log, "utf8").trim().split("\n").sort();
    expect(logLines).toEqual(
      [
        `bun:${join(dependencyRoot, "deps", "bun-deps")}:install --frozen-lockfile`,
        `npm:${join(dependencyRoot, "deps", "npm-deps")}:ci --no-audit --no-fund`,
        `pip:${join(dependencyRoot, "deps", "pip-deps")}:install -r ${join(
          project,
          "deps",
          "pip-deps",
          "requirements.txt",
        )} --target ${join(project, "deps", "pip-deps", ".opendock", "python")}`,
        `pip3:${join(dependencyRoot, "deps", "pip3-deps")}:install -r ${join(
          project,
          "deps",
          "pip3-deps",
          "requirements.txt",
        )} --target ${join(project, "deps", "pip3-deps", ".opendock", "python")}`,
        `pnpm:${join(dependencyRoot, "deps", "pnpm-deps")}:install --frozen-lockfile`,
        `uv:${join(dependencyRoot, "deps", "uv-deps")}:sync --frozen`,
      ].sort(),
    );
    expect(existsSync(join(project, "deps", "uv-deps", ".venv", "uv.txt"))).toBe(true);
    expect(existsSync(join(project, "deps", "pip-deps", ".opendock", "python", "pip.txt"))).toBe(
      true,
    );
    expect(existsSync(join(project, "deps", "pip3-deps", ".opendock", "python", "pip3.txt"))).toBe(
      true,
    );
  }, 30_000);

  it("uses project-managed command shims before host dependency managers", () => {
    const project = tempDir();
    const hostBin = tempDir();
    const projectBin = join(project, ".opendock", "bin");
    const log = join(project, "commands.log");
    writeFailingDependencyManager(hostBin, "npm", log);
    writeFakeDependencyManager(projectBin, "npm", log, "node_modules/project-shim.txt");
    mkdirSync(join(project, "deps", "image2html"), { recursive: true });
    writeFileSync(join(project, "deps", "image2html", "package.json"), "{}\n");
    const manifest = manifestForRef(
      parseManifestText({
        opendock: 1,
        dependencies: {
          image2html: {
            manager: "npm",
            path: "deps/image2html",
          },
        },
      }),
      DockRef.parse("test/dependency-project-shim@1.0.0"),
    );

    withEnv({ PATH: `${hostBin}:${process.env.PATH ?? ""}` }, () =>
      new DependencyRunner().run(manifest, {
        projectDir: project,
        dockId: "test/dependency-project-shim",
        phase: "install",
        platform: "macos",
        live: false,
      }),
    );

    expect(
      existsSync(join(project, "deps", "image2html", "node_modules", "project-shim.txt")),
    ).toBe(true);
    expect(readFileSync(log, "utf8")).toContain("npm:");
  });

  it("prefers Windows command shims for dependency managers", () => {
    const project = tempDir();
    const projectBin = join(project, ".opendock", "bin");
    mkdirSync(projectBin, { recursive: true });
    writeFileSync(join(projectBin, "npm"), "#!/usr/bin/env sh\nexit 1\n");
    writeFileSync(join(projectBin, "npm.cmd"), "@echo off\r\nexit /b 0\r\n");

    expect(resolveProgramFromPath("npm", `${projectBin};C:\\Windows\\System32`, "windows")).toBe(
      join(projectBin, "npm.cmd"),
    );

    const windowsPath =
      "C:\\Users\\12rnw\\OpenDock Projects\\빈 프로젝트1\\.opendock\\bin\\npm.cmd";
    expect(windowsBatchSpawnArgs(windowsPath, ["install", "--no-audit", "--no-fund"])).toEqual([
      "/d",
      "/c",
      "call",
      windowsPath,
      "install",
      "--no-audit",
      "--no-fund",
    ]);
  });

  it("verifies dependency integrity after install and during doctor", () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    const dependencyPath = join(project, "deps", "verified");
    const binaryPath = join(dependencyPath, "node_modules", "binary", "tool.bin");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/binary/tool.bin");
    mkdirSync(dependencyPath, { recursive: true });
    writeFileSync(join(dependencyPath, "package.json"), "{}\n");
    const manifest = manifestForRef(
      parseManifestText({
        opendock: 1,
        dependencies: {
          verified: {
            manager: "npm",
            path: "deps/verified",
            integrity: [
              {
                path: "node_modules/binary/tool.bin",
                sha256: ["0".repeat(64), createHash("sha256").update("npm\n").digest("hex")],
              },
            ],
          },
        },
      }),
      DockRef.parse("test/dependency-integrity@1.0.0"),
    );

    const installed = withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DependencyRunner().run(manifest, {
        projectDir: project,
        dockId: "test/dependency-integrity",
        phase: "install",
        platform: "macos",
        live: false,
      }),
    );
    expect(installed.reports[0]).toMatchObject({ status: "Ready" });

    const healthy = new DependencyRunner().run(manifest, {
      projectDir: project,
      dockId: "test/dependency-integrity",
      phase: "doctor",
      platform: "macos",
      live: false,
    });
    expect(healthy.reports[0]).toMatchObject({ status: "Ready" });

    writeFileSync(binaryPath, "tampered\n");
    const tampered = new DependencyRunner().run(manifest, {
      projectDir: project,
      dockId: "test/dependency-integrity",
      phase: "doctor",
      platform: "macos",
      live: false,
    });
    expect(tampered.reports[0]).toMatchObject({
      status: "Failed",
      message: expect.stringContaining("dependency integrity mismatch"),
    });
  });

  it("rolls back dependency outputs when install integrity verification fails", () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    const dependencyPath = join(project, "deps", "bad-integrity");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/binary/tool.bin");
    mkdirSync(dependencyPath, { recursive: true });
    writeFileSync(join(dependencyPath, "package.json"), "{}\n");
    const manifest = manifestForRef(
      parseManifestText({
        opendock: 1,
        dependencies: {
          bad: {
            manager: "npm",
            path: "deps/bad-integrity",
            integrity: [
              {
                path: "node_modules/binary/tool.bin",
                sha256: ["0".repeat(64)],
              },
            ],
          },
        },
      }),
      DockRef.parse("test/dependency-bad-integrity@1.0.0"),
    );

    expect(() =>
      withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DependencyRunner().run(manifest, {
          projectDir: project,
          dockId: "test/dependency-bad-integrity",
          phase: "install",
          platform: "macos",
          live: false,
        }),
      ),
    ).toThrow("dependency integrity mismatch");
    expect(existsSync(join(dependencyPath, "node_modules"))).toBe(false);
  });

  it("rejects dependency roots replaced with symlinks without deleting external outputs", () => {
    for (const [label, sha256] of [
      ["matching", createHash("sha256").update("npm\n").digest("hex")],
      ["mismatched", "0".repeat(64)],
    ] as const) {
      const project = tempDir();
      const outside = tempDir();
      const bin = tempDir();
      const dependencyPath = join(project, "deps", label);
      const externalModules = join(outside, "node_modules");
      mkdirSync(dependencyPath, { recursive: true });
      mkdirSync(externalModules, { recursive: true });
      writeFileSync(join(dependencyPath, "package.json"), "{}\n");
      writeFileSync(join(externalModules, "sentinel.txt"), "keep\n");
      writeExecutable(
        join(bin, "npm"),
        `#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ]; then
  printf '1.0.0\n'
  exit 0
fi
mv "${dependencyPath}" "${dependencyPath}.original"
ln -s "${outside}" "${dependencyPath}"
mkdir -p "${externalModules}/binary"
printf 'npm\n' > "${externalModules}/binary/tool.bin"
`,
      );
      const manifest = manifestForRef(
        parseManifestText({
          opendock: 1,
          dependencies: {
            linked: {
              manager: "npm",
              path: `deps/${label}`,
              integrity: [{ path: "node_modules/binary/tool.bin", sha256: [sha256] }],
            },
          },
        }),
        DockRef.parse(`test/dependency-root-${label}@1.0.0`),
      );

      expect(() =>
        withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
          new DependencyRunner().run(manifest, {
            projectDir: project,
            dockId: `test/dependency-root-${label}`,
            phase: "install",
            platform: "macos",
            live: false,
          }),
        ),
      ).toThrow(`dependency path cannot be a symlink: deps/${label}`);
      expect(readFileSync(join(externalModules, "sentinel.txt"), "utf8")).toBe("keep\n");
      expect(readFileSync(join(externalModules, "binary", "tool.bin"), "utf8")).toBe("npm\n");
    }
  });

  it("restores managed files and prior dependency outputs when update integrity fails", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/binary/tool.bin");
    const dependency = {
      manager: "npm",
      path: ".codex/skills/transactional",
      mode: "locked",
    };
    writeDock(docks, "test", "transactional", "1.0.0", {
      dependencies: { transactional: dependency },
      files: [
        { path: ".codex/skills/transactional/package.json", content: '{"version":"1"}\n' },
        { path: "CONFIG.md", content: "old managed content\n" },
      ],
    });
    writeDock(docks, "test", "transactional", "2.0.0", {
      dependencies: {
        transactional: {
          ...dependency,
          integrity: [{ path: "node_modules/binary/tool.bin", sha256: ["0".repeat(64)] }],
        },
      },
      files: [
        { path: ".codex/skills/transactional/package.json", content: '{"version":"2"}\n' },
        { path: "CONFIG.md", content: "new managed content\n" },
        { path: "NEW.md", content: "new file\n" },
      ],
    });

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/transactional@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );
    const dependencyPath = join(project, ".codex", "skills", "transactional");
    const priorConfig = readFileSync(join(project, "CONFIG.md"));
    const priorPackage = readFileSync(join(dependencyPath, "package.json"));
    writeFileSync(join(dependencyPath, "node_modules", "old-output.txt"), "preserve\n");

    await expect(
      withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DockInstaller().install({
          dockRef: DockRef.parse("test/transactional@2.0.0"),
          projectDir: project,
          phase: "update",
          platform: "macos",
          live: false,
          runTasks: true,
          resolve: localResolver(docks),
        }),
      ),
    ).rejects.toThrow("dependency integrity mismatch");

    expect(readFileSync(join(project, "CONFIG.md"))).toEqual(priorConfig);
    expect(readFileSync(join(dependencyPath, "package.json"))).toEqual(priorPackage);
    expect(existsSync(join(project, "NEW.md"))).toBe(false);
    expect(readFileSync(join(dependencyPath, "node_modules", "old-output.txt"), "utf8")).toBe(
      "preserve\n",
    );
    expect(new OpenDockStateStore(project).findDock("test/transactional")?.version).toBe("1.0.0");
  });

  it("keeps the previous files and dependencies when update state persistence fails", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/binary/tool.bin");
    const dependency = {
      manager: "npm",
      path: ".codex/skills/state-save",
      mode: "locked",
    };
    writeDock(docks, "test", "state-save", "1.0.0", {
      dependencies: { stateSave: dependency },
      files: [
        { path: ".codex/skills/state-save/package.json", content: '{"version":"1"}\n' },
        { path: "CONFIG.md", content: "old managed content\n" },
      ],
    });
    writeDock(docks, "test", "state-save", "2.0.0", {
      dependencies: {
        stateSave: {
          ...dependency,
          integrity: [
            {
              path: "node_modules/binary/tool.bin",
              sha256: [createHash("sha256").update("npm\n").digest("hex")],
            },
          ],
        },
      },
      files: [
        { path: ".codex/skills/state-save/package.json", content: '{"version":"2"}\n' },
        { path: "CONFIG.md", content: "new managed content\n" },
        { path: "NEW.md", content: "new file\n" },
      ],
    });

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/state-save@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );
    const dependencyPath = join(project, ".codex", "skills", "state-save");
    const priorConfig = readFileSync(join(project, "CONFIG.md"));
    const priorPackage = readFileSync(join(dependencyPath, "package.json"));
    writeFileSync(join(dependencyPath, "node_modules", "old-output.txt"), "preserve\n");
    vi.spyOn(OpenDockStateStore.prototype, "saveDock").mockImplementationOnce(() => {
      throw new Error("simulated state persistence failure");
    });

    await expect(
      withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DockInstaller().install({
          dockRef: DockRef.parse("test/state-save@2.0.0"),
          projectDir: project,
          phase: "update",
          platform: "macos",
          live: false,
          runTasks: true,
          resolve: localResolver(docks),
        }),
      ),
    ).rejects.toThrow("simulated state persistence failure");

    expect(readFileSync(join(project, "CONFIG.md"))).toEqual(priorConfig);
    expect(readFileSync(join(dependencyPath, "package.json"))).toEqual(priorPackage);
    expect(existsSync(join(project, "NEW.md"))).toBe(false);
    expect(readFileSync(join(dependencyPath, "node_modules", "old-output.txt"), "utf8")).toBe(
      "preserve\n",
    );
    expect(new OpenDockStateStore(project).findDock("test/state-save")?.version).toBe("1.0.0");
  });

  it("restores existing managed-block and forced managed-file targets when first install fails", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "first-install-rollback", "1.0.0", {
      files: [
        { path: "README.md", content: "dock readme\n" },
        { path: "settings.json", content: '{"dock":true}\n' },
      ],
    });
    const priorReadme = Buffer.from("user readme\n");
    const priorSettings = Buffer.from('{"user":true}\n');
    writeFileSync(join(project, "README.md"), priorReadme);
    writeFileSync(join(project, "settings.json"), priorSettings);
    vi.spyOn(OpenDockStateStore.prototype, "saveDock").mockImplementationOnce(() => {
      throw new Error("simulated first-install state failure");
    });

    await expect(
      new DockInstaller().install({
        dockRef: DockRef.parse("test/first-install-rollback@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        force: true,
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("simulated first-install state failure");

    expect(readFileSync(join(project, "README.md"))).toEqual(priorReadme);
    expect(readFileSync(join(project, "settings.json"))).toEqual(priorSettings);
    expect(new OpenDockStateStore(project).findDock("test/first-install-rollback")).toBeUndefined();
    expect(
      existsSync(
        join(
          project,
          ".opendock",
          "workdirs",
          safeDockDirectoryName("test/first-install-rollback"),
        ),
      ),
    ).toBe(false);
  });

  it("restores pre-existing dependency outputs when first install integrity verification fails", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/binary/tool.bin");
    writeDock(docks, "test", "existing-output", "1.0.0", {
      dependencies: {
        existingOutput: {
          manager: "npm",
          path: ".codex/skills/existing-output",
          mode: "locked",
          integrity: [{ path: "node_modules/binary/tool.bin", sha256: ["0".repeat(64)] }],
        },
      },
      files: [{ path: ".codex/skills/existing-output/package.json", content: '{"version":"1"}\n' }],
    });
    const dependencyPath = join(project, ".codex", "skills", "existing-output");
    mkdirSync(join(dependencyPath, "node_modules"), { recursive: true });
    writeFileSync(join(dependencyPath, "node_modules", "user-output.txt"), "preserve\n");

    await expect(
      withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DockInstaller().install({
          dockRef: DockRef.parse("test/existing-output@1.0.0"),
          projectDir: project,
          phase: "install",
          platform: "macos",
          live: false,
          runTasks: true,
          resolve: localResolver(docks),
        }),
      ),
    ).rejects.toThrow("dependency integrity mismatch");

    expect(readFileSync(join(dependencyPath, "node_modules", "user-output.txt"), "utf8")).toBe(
      "preserve\n",
    );
    expect(existsSync(join(dependencyPath, "node_modules", "binary", "tool.bin"))).toBe(false);
    expect(existsSync(join(dependencyPath, "package.json"))).toBe(false);
    expect(new OpenDockStateStore(project).findDock("test/existing-output")).toBeUndefined();
  });

  it("restores the previous workdir when an update fails", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/binary/tool.bin");
    const dependency = {
      manager: "npm",
      path: ".codex/skills/workdir-transaction",
      mode: "locked",
    };
    writeDock(docks, "test", "workdir-transaction", "1.0.0", {
      dependencies: { workdirTransaction: dependency },
      files: [
        {
          path: ".codex/skills/workdir-transaction/package.json",
          content: '{"version":"1"}\n',
        },
      ],
      workdirFiles: [{ path: "config.txt", content: "old workdir\n" }],
    });
    writeDock(docks, "test", "workdir-transaction", "2.0.0", {
      dependencies: {
        workdirTransaction: {
          ...dependency,
          integrity: [{ path: "node_modules/binary/tool.bin", sha256: ["0".repeat(64)] }],
        },
      },
      files: [
        {
          path: ".codex/skills/workdir-transaction/package.json",
          content: '{"version":"2"}\n',
        },
      ],
      workdirFiles: [{ path: "config.txt", content: "new workdir\n" }],
    });

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/workdir-transaction@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );
    const workdir = join(
      project,
      ".opendock",
      "workdirs",
      safeDockDirectoryName("test/workdir-transaction"),
    );
    writeFileSync(join(workdir, "runtime-cache.txt"), "preserve\n");
    symlinkSync("runtime-cache.txt", join(workdir, "runtime-cache-link.txt"));

    await expect(
      withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DockInstaller().install({
          dockRef: DockRef.parse("test/workdir-transaction@2.0.0"),
          projectDir: project,
          phase: "update",
          platform: "macos",
          live: false,
          runTasks: true,
          resolve: localResolver(docks),
        }),
      ),
    ).rejects.toThrow("dependency integrity mismatch");

    expect(readFileSync(join(workdir, "config.txt"), "utf8")).toBe("old workdir\n");
    expect(readFileSync(join(workdir, "runtime-cache.txt"), "utf8")).toBe("preserve\n");
    expect(readFileSync(join(workdir, "runtime-cache-link.txt"), "utf8")).toBe("preserve\n");
    expect(new OpenDockStateStore(project).findDock("test/workdir-transaction")?.version).toBe(
      "1.0.0",
    );
  });

  it("restores the previous tool directory and command shims when an update fails", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeToolAndDependencyManager(bin, log);
    const dependency = {
      manager: "npm",
      path: ".codex/skills/task-output-transaction",
      mode: "locked",
    };
    writeDock(docks, "test", "task-output-transaction", "1.0.0", {
      tools: {
        agent: {
          manager: "npm",
          package: "@test/acme-v1",
          version: "1.0.0",
          commands: ["acme"],
        },
      },
      dependencies: { taskOutputTransaction: dependency },
      files: [
        {
          path: ".codex/skills/task-output-transaction/package.json",
          content: '{"version":"1"}\n',
        },
      ],
    });
    writeDock(docks, "test", "task-output-transaction", "2.0.0", {
      tools: {
        agent: {
          manager: "npm",
          package: "@test/acme-v2",
          version: "2.0.0",
          commands: ["acme2"],
        },
      },
      dependencies: {
        taskOutputTransaction: {
          ...dependency,
          integrity: [{ path: "node_modules/binary/tool.bin", sha256: ["0".repeat(64)] }],
        },
      },
      files: [
        {
          path: ".codex/skills/task-output-transaction/package.json",
          content: '{"version":"2"}\n',
        },
      ],
    });

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/task-output-transaction@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );
    const priorDock = new OpenDockStateStore(project).findDock("test/task-output-transaction");
    expect(priorDock).toBeDefined();
    const toolDir = join(project, priorDock?.tools[0]?.path ?? "missing-tool");
    const priorToolPackage = readFileSync(join(toolDir, "package.json"));
    const priorShim = readFileSync(join(project, ".opendock", "bin", "acme"));
    writeFileSync(join(toolDir, "node_modules", "v1-only.txt"), "preserve\n");

    await expect(
      withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DockInstaller().install({
          dockRef: DockRef.parse("test/task-output-transaction@2.0.0"),
          projectDir: project,
          phase: "update",
          platform: "macos",
          live: false,
          runTasks: true,
          resolve: localResolver(docks),
        }),
      ),
    ).rejects.toThrow("dependency integrity mismatch");

    expect(readFileSync(join(toolDir, "package.json"))).toEqual(priorToolPackage);
    expect(readFileSync(join(toolDir, "node_modules", "v1-only.txt"), "utf8")).toBe("preserve\n");
    expect(readFileSync(join(project, ".opendock", "bin", "acme"))).toEqual(priorShim);
    expect(existsSync(join(project, ".opendock", "bin", "acme2"))).toBe(false);
    expect(new OpenDockStateStore(project).findDock("test/task-output-transaction")?.version).toBe(
      "1.0.0",
    );
  });

  it("removes new tool outputs when first-install state persistence fails", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    const dockId = "test/tool-first-install";
    writeFakeToolAndDependencyManager(bin, log);
    writeDock(docks, "test", "tool-first-install", "1.0.0", {
      tools: {
        agent: {
          manager: "npm",
          package: "@test/acme",
          version: "1.0.0",
          commands: ["acme"],
        },
      },
      files: [],
    });
    vi.spyOn(OpenDockStateStore.prototype, "saveDock").mockImplementationOnce(() => {
      throw new Error("simulated tool state failure");
    });

    await expect(
      withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DockInstaller().install({
          dockRef: DockRef.parse(`${dockId}@1.0.0`),
          projectDir: project,
          phase: "install",
          platform: "macos",
          live: false,
          runTasks: true,
          resolve: localResolver(docks),
        }),
      ),
    ).rejects.toThrow("simulated tool state failure");

    expect(existsSync(join(project, ".opendock", "tools", safeDockDirectoryName(dockId)))).toBe(
      false,
    );
    expect(existsSync(join(project, ".opendock", "bin", "acme"))).toBe(false);
    expect(new OpenDockStateStore(project).findDock(dockId)).toBeUndefined();
  });

  it("removes stale tool directories and command shims after a successful update", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeToolAndDependencyManager(bin, log);
    writeDock(docks, "test", "tool-replacement", "1.0.0", {
      tools: {
        agentV1: {
          manager: "npm",
          package: "@test/acme-v1",
          version: "1.0.0",
          commands: ["acme"],
        },
      },
      files: [],
    });
    writeDock(docks, "test", "tool-replacement", "2.0.0", {
      tools: {
        agentV2: {
          manager: "npm",
          package: "@test/acme-v2",
          version: "2.0.0",
          commands: ["acme2"],
        },
      },
      files: [],
    });

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/tool-replacement@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );
    const priorToolPath = new OpenDockStateStore(project).findDock("test/tool-replacement")
      ?.tools[0]?.path;
    expect(priorToolPath).toBeDefined();

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/tool-replacement@2.0.0"),
        projectDir: project,
        phase: "update",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    const updatedDock = new OpenDockStateStore(project).findDock("test/tool-replacement");
    expect(updatedDock?.version).toBe("2.0.0");
    expect(updatedDock?.tools.map((tool) => tool.name)).toEqual(["agentV2"]);
    expect(existsSync(join(project, priorToolPath ?? "missing-tool"))).toBe(false);
    expect(existsSync(join(project, ".opendock", "bin", "acme"))).toBe(false);
    expect(existsSync(join(project, ".opendock", "bin", "acme2"))).toBe(true);
  });

  it("removes a newly seeded workdir when file preflight fails", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "workdir-preflight", "1.0.0", {
      files: [{ path: "settings.json", content: '{"dock":true}\n' }],
      workdirFiles: [{ path: "config.txt", content: "seeded\n" }],
    });
    writeFileSync(join(project, "settings.json"), '{"user":true}\n');

    await expect(
      new DockInstaller().install({
        dockRef: DockRef.parse("test/workdir-preflight@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("target already exists and is not OpenDock-owned");

    expect(readFileSync(join(project, "settings.json"), "utf8")).toBe('{"user":true}\n');
    expect(
      existsSync(
        join(project, ".opendock", "workdirs", safeDockDirectoryName("test/workdir-preflight")),
      ),
    ).toBe(false);
    expect(new OpenDockStateStore(project).findDock("test/workdir-preflight")).toBeUndefined();
  });

  it("rejects a symlinked workdir parent without touching external files", async () => {
    const docks = tempDir();
    const project = tempDir();
    const outside = tempDir();
    const dockId = "test/workdir-parent-symlink";
    writeDock(docks, "test", "workdir-parent-symlink", "1.0.0", {
      files: [],
      workdirFiles: [{ path: "config.txt", content: "seeded\n" }],
    });
    const outsideWorkdir = join(outside, safeDockDirectoryName(dockId));
    mkdirSync(outsideWorkdir, { recursive: true });
    const sentinel = join(outsideWorkdir, "sentinel.txt");
    writeFileSync(sentinel, "outside\n");
    mkdirSync(join(project, ".opendock"), { recursive: true });
    symlinkSync(outside, join(project, ".opendock", "workdirs"));

    await expect(
      new DockInstaller().install({
        dockRef: DockRef.parse(`${dockId}@1.0.0`),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("dock workdir parent cannot be a symlink");

    expect(readFileSync(sentinel, "utf8")).toBe("outside\n");
    expect(existsSync(join(outsideWorkdir, "config.txt"))).toBe(false);
  });

  it("preserves command shims when the second task-output snapshot fails", async () => {
    const docks = tempDir();
    const project = tempDir();
    const outside = tempDir();
    writeDock(docks, "test", "task-output-prepare", "1.0.0", {
      files: [],
    });
    const binDir = join(project, ".opendock", "bin");
    mkdirSync(binDir, { recursive: true });
    const shimSentinel = join(binDir, "sentinel");
    writeFileSync(shimSentinel, "shim\n");
    const outsideSentinel = join(outside, "outside.txt");
    writeFileSync(outsideSentinel, "outside\n");
    symlinkSync(outside, join(project, ".opendock", "tools"));

    await expect(
      new DockInstaller().install({
        dockRef: DockRef.parse("test/task-output-prepare@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("dock tool directory parent cannot be a symlink");

    expect(readFileSync(shimSentinel, "utf8")).toBe("shim\n");
    expect(readFileSync(outsideSentinel, "utf8")).toBe("outside\n");
  });

  it("treats progress reporter failures as non-fatal", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "test", "progress", "1.0.0", {
      files: [{ path: "READY.md", content: "ready\n" }],
    });

    await expect(
      new DockInstaller().install({
        dockRef: DockRef.parse("test/progress@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: false,
        progress: () => {
          throw new Error("simulated observer failure");
        },
        resolve: localResolver(docks),
      }),
    ).resolves.toMatchObject({ dockId: "test/progress", version: "1.0.0" });
    expect(readFileSync(join(project, "READY.md"), "utf8")).toContain("ready\n");
    expect(new OpenDockStateStore(project).findDock("test/progress")?.version).toBe("1.0.0");
  });

  it("preserves restored outputs when dependency detachment fails partway", async () => {
    const docks = tempDir();
    const project = tempDir();
    const outside = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/package.txt");
    const dependencies = {
      first: { manager: "npm", path: "deps/first", mode: "locked" },
      second: { manager: "npm", path: "deps/second", mode: "locked" },
    };
    for (const version of ["1.0.0", "2.0.0"]) {
      writeDock(docks, "test", "partial-detach", version, {
        dependencies,
        files: [
          { path: "deps/first/package.json", content: `{"version":"${version}"}\n` },
          { path: "deps/second/package.json", content: `{"version":"${version}"}\n` },
          { path: "STATE.txt", content: `${version}\n` },
        ],
      });
    }

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/partial-detach@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );
    const firstOutput = join(project, "deps", "first", "node_modules");
    const secondOutput = join(project, "deps", "second", "node_modules");
    writeFileSync(join(firstOutput, "preserved.txt"), "keep first\n");
    rmSync(secondOutput, { force: true, recursive: true });
    mkdirSync(join(outside, "node_modules"), { recursive: true });
    writeFileSync(join(outside, "node_modules", "sentinel.txt"), "keep outside\n");
    symlinkSync(join(outside, "node_modules"), secondOutput);
    const priorState = readFileSync(join(project, "STATE.txt"));

    await expect(
      withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DockInstaller().install({
          dockRef: DockRef.parse("test/partial-detach@2.0.0"),
          projectDir: project,
          phase: "update",
          platform: "macos",
          live: false,
          runTasks: true,
          resolve: localResolver(docks),
        }),
      ),
    ).rejects.toThrow("dependency output must be a real directory");

    expect(readFileSync(join(firstOutput, "preserved.txt"), "utf8")).toBe("keep first\n");
    expect(readFileSync(join(outside, "node_modules", "sentinel.txt"), "utf8")).toBe(
      "keep outside\n",
    );
    expect(readFileSync(join(project, "STATE.txt"))).toEqual(priorState);
    expect(new OpenDockStateStore(project).findDock("test/partial-detach")?.version).toBe("1.0.0");
  });

  it("rejects symlinked dependency integrity files during doctor", () => {
    const project = tempDir();
    const outside = tempDir();
    const dependencyPath = join(project, "deps", "linked-integrity");
    mkdirSync(join(dependencyPath, "node_modules"), { recursive: true });
    writeFileSync(join(outside, "tool.bin"), "trusted\n");
    symlinkSync(join(outside, "tool.bin"), join(dependencyPath, "node_modules", "tool.bin"));
    const manifest = manifestForRef(
      parseManifestText({
        opendock: 1,
        dependencies: {
          linked: {
            manager: "npm",
            path: "deps/linked-integrity",
            integrity: [
              {
                path: "node_modules/tool.bin",
                sha256: [createHash("sha256").update("trusted\n").digest("hex")],
              },
            ],
          },
        },
      }),
      DockRef.parse("test/dependency-linked-integrity@1.0.0"),
    );

    const result = new DependencyRunner().run(manifest, {
      projectDir: project,
      dockId: "test/dependency-linked-integrity",
      phase: "doctor",
      platform: "macos",
      live: false,
    });
    expect(result.reports[0]).toMatchObject({
      status: "Failed",
      message: expect.stringContaining("must be a regular file"),
    });
  });

  it("rejects missing integrity files and symlinked integrity parents during doctor", () => {
    const project = tempDir();
    const outside = tempDir();
    const dependencyPath = join(project, "deps", "integrity-edges");
    mkdirSync(join(dependencyPath, "node_modules"), { recursive: true });
    writeFileSync(join(outside, "tool.bin"), "trusted\n");

    const manifestFor = (path: string) =>
      manifestForRef(
        parseManifestText({
          opendock: 1,
          dependencies: {
            edges: {
              manager: "npm",
              path: "deps/integrity-edges",
              integrity: [
                {
                  path,
                  sha256: [createHash("sha256").update("trusted\n").digest("hex")],
                },
              ],
            },
          },
        }),
        DockRef.parse("test/dependency-integrity-edges@1.0.0"),
      );

    const missing = new DependencyRunner().run(manifestFor("node_modules/missing/tool.bin"), {
      projectDir: project,
      dockId: "test/dependency-integrity-edges",
      phase: "doctor",
      platform: "macos",
      live: false,
    });
    expect(missing.reports[0]).toMatchObject({
      status: "Failed",
      message: expect.stringContaining("missing dependency integrity file"),
    });

    symlinkSync(outside, join(dependencyPath, "node_modules", "linked"));
    const linked = new DependencyRunner().run(manifestFor("node_modules/linked/tool.bin"), {
      projectDir: project,
      dockId: "test/dependency-integrity-edges",
      phase: "doctor",
      platform: "macos",
      live: false,
    });
    expect(linked.reports[0]).toMatchObject({
      status: "Failed",
      message: expect.stringContaining("dependency integrity parent cannot be a symlink"),
    });
  });

  it("reports missing dependency outputs during doctor", () => {
    const project = tempDir();
    mkdirSync(join(project, "deps", "image2html"), { recursive: true });
    writeFileSync(join(project, "deps", "image2html", "package.json"), "{}\n");
    const manifest = manifestForRef(
      parseManifestText({
        opendock: 1,
        dependencies: {
          image2html: {
            manager: "npm",
            path: "deps/image2html",
          },
        },
      }),
      DockRef.parse("test/dependency-doctor@1.0.0"),
    );

    const result = new DependencyRunner().run(manifest, {
      projectDir: project,
      dockId: "test/dependency-doctor",
      phase: "doctor",
      platform: "macos",
      live: false,
    });

    expect(result.reports).toEqual([
      expect.objectContaining({
        id: "dependency-image2html",
        status: "Failed",
        message: expect.stringContaining("missing dependency output"),
      }),
    ]);
  });

  it("rejects missing, file, and symlink dependency paths before running managers", () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/sharp/package.json");
    mkdirSync(join(project, "deps", "real"), { recursive: true });
    writeFileSync(join(project, "deps", "file"), "{}\n");
    symlinkSync("real", join(project, "deps", "link"));

    for (const [path, expected] of [
      ["deps/missing", "dependency path does not exist"],
      ["deps/file", "dependency path must be a directory"],
      ["deps/link", "dependency path cannot be a symlink"],
    ] as const) {
      const manifest = manifestForRef(
        parseManifestText({
          opendock: 1,
          dependencies: {
            bad: {
              manager: "npm",
              path,
            },
          },
        }),
        DockRef.parse("test/bad-dependency-path@1.0.0"),
      );

      expect(() =>
        withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
          new DependencyRunner().run(manifest, {
            projectDir: project,
            dockId: "test/bad-dependency-path",
            phase: "install",
            platform: "macos",
            live: false,
          }),
        ),
      ).toThrow(expected);
    }

    expect(existsSync(log)).toBe(false);
  });

  it("rejects dependency paths with symlink ancestors before running managers", () => {
    const project = tempDir();
    const outside = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/sharp/package.json");
    mkdirSync(join(project, "deps"), { recursive: true });
    mkdirSync(join(outside, "pkg"), { recursive: true });
    symlinkSync(outside, join(project, "deps", "link"));
    const manifest = manifestForRef(
      parseManifestText({
        opendock: 1,
        dependencies: {
          bad: {
            manager: "npm",
            path: "deps/link/pkg",
          },
        },
      }),
      DockRef.parse("test/symlink-ancestor@1.0.0"),
    );

    expect(() =>
      withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DependencyRunner().run(manifest, {
          projectDir: project,
          dockId: "test/symlink-ancestor",
          phase: "install",
          platform: "macos",
          live: false,
        }),
      ),
    ).toThrow("dependency path cannot be a symlink: deps/link/pkg");
    expect(existsSync(log)).toBe(false);
  });

  it("rejects tampered lock dependency cleanup paths before deleting outputs", () => {
    const project = tempDir();
    const outside = tempDir();
    mkdirSync(join(project, "deps"), { recursive: true });
    mkdirSync(join(outside, "pkg", "node_modules"), { recursive: true });
    writeFileSync(join(outside, "pkg", "node_modules", "sentinel.txt"), "keep\n");
    symlinkSync(outside, join(project, "deps", "link"));
    mkdirSync(join(project, ".opendock", "bin", "node_modules"), { recursive: true });
    writeFileSync(join(project, ".opendock", "bin", "node_modules", "sentinel.txt"), "keep\n");

    for (const [path, expected] of [
      ["../outside", "unsafe installed dependency path"],
      [".opendock/bin", "protected installed dependency path"],
      ["deps/link/pkg", "installed dependency path cannot be a symlink"],
    ] as const) {
      expect(() =>
        removeInstalledDependencyOutputs(project, [
          {
            manager: "npm",
            mode: "install",
            name: "tampered",
            path,
          },
        ]),
      ).toThrow(expected);
    }

    expect(existsSync(join(outside, "pkg", "node_modules", "sentinel.txt"))).toBe(true);
    expect(existsSync(join(project, ".opendock", "bin", "node_modules", "sentinel.txt"))).toBe(
      true,
    );
  });

  it("removes dependency output symlinks without deleting their targets", () => {
    const project = tempDir();
    const outside = tempDir();
    mkdirSync(join(project, "deps", "image2html"), { recursive: true });
    mkdirSync(join(outside, "node_modules"), { recursive: true });
    writeFileSync(join(outside, "node_modules", "sentinel.txt"), "keep\n");
    symlinkSync(join(outside, "node_modules"), join(project, "deps", "image2html", "node_modules"));

    removeInstalledDependencyOutputs(project, [
      {
        manager: "npm",
        mode: "install",
        name: "image2html",
        path: "deps/image2html",
      },
    ]);

    expect(existsSync(join(project, "deps", "image2html", "node_modules"))).toBe(false);
    expect(existsSync(join(outside, "node_modules", "sentinel.txt"))).toBe(true);
  });

  it("requires requirements.txt for pip dependency installs", () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakePip(bin, "pip", log);
    mkdirSync(join(project, "deps", "python-checks"), { recursive: true });
    const manifest = manifestForRef(
      parseManifestText({
        opendock: 1,
        dependencies: {
          pythonChecks: {
            manager: "pip",
            path: "deps/python-checks",
          },
        },
      }),
      DockRef.parse("test/pip-dependencies@1.0.0"),
    );

    expect(() =>
      withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
        new DependencyRunner().run(manifest, {
          projectDir: project,
          dockId: "test/pip-dependencies",
          phase: "install",
          platform: "macos",
          live: false,
        }),
      ),
    ).toThrow("pip dependency path must contain requirements.txt");
    expect(existsSync(log)).toBe(false);
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-dependencies-test-"));
  tempRoots.push(dir);
  return dir;
}

function parseManifestText(manifest: Record<string, unknown>) {
  const root = tempDir();
  writeFileSync(join(root, "dock.yml"), YAML.stringify(manifest));
  return parseManifestFile(join(root, "dock.yml"));
}

function writeDock(
  root: string,
  owner: string,
  name: string,
  version: string,
  options: {
    dependencies?: Record<string, unknown>;
    files: Array<{ content: string; path: string }>;
    tools?: Record<string, unknown>;
    workdirFiles?: Array<{ content: string; path: string; to?: string }>;
  },
): void {
  const dockRoot = join(root, `${owner}-${name}-${version}`);
  mkdirSync(join(dockRoot, "files"), { recursive: true });
  for (const file of options.files) {
    const filePath = join(dockRoot, "files", file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content);
  }
  for (const file of options.workdirFiles ?? []) {
    const filePath = join(dockRoot, "workdir-files", file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content);
  }
  writeFileSync(
    join(dockRoot, "dock.yml"),
    YAML.stringify({
      opendock: 1,
      summary: "",
      dependencies: options.dependencies ?? {},
      tools: options.tools ?? {},
      files: options.files.map((file) => ({
        from: `files/${file.path}`,
        to: file.path,
      })),
      workdir: {
        files: (options.workdirFiles ?? []).map((file) => ({
          from: `workdir-files/${file.path}`,
          to: file.to ?? file.path,
        })),
      },
    }),
  );
}

function localResolver(root: string) {
  return (dockRef: DockRef): ResolvedDock => {
    const dockRoot = join(root, `${dockRef.owner}-${dockRef.name}-${dockRef.requested()}`);
    return {
      manifest: manifestForRef(parseManifestFile(join(dockRoot, "dock.yml")), dockRef),
      version: dockRef.requested(),
      platform: "macos",
      root: dockRoot,
      checksum: `${dockRef.id()}-${dockRef.requested()}-checksum`,
      signature: "test-signature",
    };
  };
}

function writeFakeToolAndDependencyManager(bin: string, log: string): void {
  writeExecutable(
    join(bin, "npm"),
    `#!/bin/sh
set -eu
printf 'npm:%s:%s\\n' "$PWD" "$*" >> "${log}"
if [ "$1" = "--version" ]; then
  printf '10.0.0\\n'
  exit 0
fi
mkdir -p node_modules/.bin node_modules/binary
for command in acme acme2; do
  printf '#!/bin/sh\\nexit 0\\n' > "node_modules/.bin/$command"
  chmod +x "node_modules/.bin/$command"
done
printf 'npm\\n' > node_modules/binary/tool.bin
`,
  );
}

function writeFakeDependencyManager(
  bin: string,
  command: "bun" | "npm" | "pnpm" | "uv",
  log: string,
  output: string,
): void {
  writeExecutable(
    join(bin, command),
    `#!/bin/sh
set -eu
printf '${command}:%s:%s\\n' "$PWD" "$*" >> "${log}"
if [ "$1" = "--version" ]; then
  printf '1.0.0\\n'
  exit 0
fi
mkdir -p "$(dirname "${output}")"
printf '${command}\\n' > "${output}"
`,
  );
}

function writeFailingDependencyManager(
  bin: string,
  command: "bun" | "npm" | "pnpm" | "uv",
  log: string,
): void {
  writeExecutable(
    join(bin, command),
    `#!/bin/sh
set -eu
printf '${command}:%s:%s\\n' "$PWD" "$*" >> "${log}"
printf 'simulated failure\\n' >&2
exit 42
`,
  );
}

function writeFakePip(bin: string, command: "pip" | "pip3", log: string): void {
  writeExecutable(
    join(bin, command),
    `#!/bin/sh
set -eu
printf '${command}:%s:%s\\n' "$PWD" "$*" >> "${log}"
target=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--target" ]; then
    shift
    target="$1"
  fi
  shift || true
done
if [ -z "$target" ]; then
  exit 2
fi
mkdir -p "$target"
printf '${command}\\n' > "$target/${command}.txt"
`,
  );
}

function writeExecutable(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function withEnv<T>(env: Record<string, string | undefined>, callback: () => T): T {
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
    return callback();
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

async function withEnvAsync<T>(
  env: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
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
    return await callback();
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
