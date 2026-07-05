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
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { DockInstaller } from "../src/core/app/dock-installer.js";
import { DockRef, manifestForRef, parseManifestFile } from "../src/core/domain/manifest.js";
import { OpenDockStateStore } from "../src/core/domain/state-store.js";
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
  });

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
  },
): void {
  const dockRoot = join(root, `${owner}-${name}-${version}`);
  mkdirSync(join(dockRoot, "files"), { recursive: true });
  for (const file of options.files) {
    const filePath = join(dockRoot, "files", file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content);
  }
  writeFileSync(
    join(dockRoot, "dock.yml"),
    YAML.stringify({
      opendock: 1,
      summary: "",
      dependencies: options.dependencies ?? {},
      files: options.files.map((file) => ({
        from: `files/${file.path}`,
        to: file.path,
      })),
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
