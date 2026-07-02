import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { DockInstaller } from "../src/core/app/dock-installer.js";
import { DockRef, manifestForRef, parseManifestFile } from "../src/core/domain/manifest.js";
import type { InstalledDockRecord } from "../src/core/domain/state-store.js";
import { OpenDockStateStore } from "../src/core/domain/state-store.js";
import type { OpenDockPlatform } from "../src/platform.js";
import type { ResolvedDock } from "../src/resolver.js";

const tempRoots: string[] = [];
const testPlatform: OpenDockPlatform = "macos";

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("file lifecycle matrix", () => {
  it("installs, updates, and uninstalls copy-only managed files", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "qa", "copy-only", "1.0.0", {
      files: [{ path: "config/tool.json", content: '{"version":1}\n' }],
    });
    writeDock(docks, "qa", "copy-only", "1.0.1", {
      files: [{ path: "config/tool.json", content: '{"version":2}\n' }],
    });

    const installReport = await installDock(docks, project, "qa/copy-only@1.0.0");

    expect(installReport.fileChanges).toMatchObject({
      created: ["config/tool.json"],
      deleted: [],
      updated: [],
    });
    expect(readProjectFile(project, "config/tool.json")).toBe('{"version":1}\n');
    expect(installedDocks(project)[0]?.files).toEqual([
      expect.objectContaining({ mode: "managed_file", path: "config/tool.json" }),
    ]);

    const updateReport = await installDock(docks, project, "qa/copy-only@1.0.1", {
      phase: "update",
    });

    expect(updateReport.fileChanges).toMatchObject({
      created: [],
      deleted: [],
      updated: ["config/tool.json"],
    });
    expect(readProjectFile(project, "config/tool.json")).toBe('{"version":2}\n');

    const uninstallReport = uninstallDock(project, "qa/copy-only");

    expect(uninstallReport.fileChanges).toMatchObject({
      deleted: ["config/tool.json"],
      updated: [],
    });
    expect(existsProjectPath(project, "config/tool.json")).toBe(false);
    expect(existsProjectPath(project, "config")).toBe(false);
    expect(installedDocks(project)).toEqual([]);
  });

  it("stops on unmanaged target conflicts before applying any managed outputs", async () => {
    const docks = tempDir();
    const project = tempDir();
    mkdirSync(join(project, "config"), { recursive: true });
    writeFileSync(join(project, "config", "tool.json"), '{"owner":"user"}\n');
    writeDock(docks, "qa", "conflict", "1.0.0", {
      files: [
        { path: "AGENTS.md", content: "# Managed Block\n" },
        { path: "config/tool.json", content: '{"owner":"dock"}\n' },
      ],
    });

    await expect(installDock(docks, project, "qa/conflict@1.0.0")).rejects.toThrow(
      "target already exists and is not OpenDock-owned",
    );

    expect(existsProjectPath(project, "AGENTS.md")).toBe(false);
    expect(readProjectFile(project, "config/tool.json")).toBe('{"owner":"user"}\n');
    expect(installedDocks(project)).toEqual([]);
  });

  it("blocks update and uninstall after user edits a managed file unless force is used", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "qa", "mutable-file", "1.0.0", {
      files: [{ path: "settings/tool.json", content: '{"version":1}\n' }],
    });
    writeDock(docks, "qa", "mutable-file", "1.0.1", {
      files: [{ path: "settings/tool.json", content: '{"version":2}\n' }],
    });
    await installDock(docks, project, "qa/mutable-file@1.0.0");
    writeFileSync(join(project, "settings", "tool.json"), '{"version":"user-edit"}\n');

    await expect(
      installDock(docks, project, "qa/mutable-file@1.0.1", { phase: "update" }),
    ).rejects.toThrow("checksum mismatch for managed file settings/tool.json");
    expect(() => uninstallDock(project, "qa/mutable-file")).toThrow(
      "checksum mismatch for managed file settings/tool.json",
    );
    expect(readProjectFile(project, "settings/tool.json")).toBe('{"version":"user-edit"}\n');

    await installDock(docks, project, "qa/mutable-file@1.0.1", {
      force: true,
      phase: "update",
    });
    expect(readProjectFile(project, "settings/tool.json")).toBe('{"version":2}\n');

    writeFileSync(join(project, "settings", "tool.json"), '{"version":"second-user-edit"}\n');
    uninstallDock(project, "qa/mutable-file", { force: true });
    expect(existsProjectPath(project, "settings/tool.json")).toBe(false);
    expect(installedDocks(project)).toEqual([]);
  });

  it("removes managed files that disappear from a newer dock version", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "qa", "shrinking", "1.0.0", {
      files: [
        { path: "config/current.json", content: '{"current":true}\n' },
        { path: "config/legacy/old.json", content: '{"legacy":true}\n' },
      ],
    });
    writeDock(docks, "qa", "shrinking", "1.0.1", {
      files: [{ path: "config/current.json", content: '{"current":"v2"}\n' }],
    });

    await installDock(docks, project, "qa/shrinking@1.0.0");
    const updateReport = await installDock(docks, project, "qa/shrinking@1.0.1", {
      phase: "update",
    });

    expect(updateReport.fileChanges).toMatchObject({
      deleted: ["config/legacy/old.json"],
      updated: ["config/current.json"],
    });
    expect(existsProjectPath(project, "config/legacy/old.json")).toBe(false);
    expect(existsProjectPath(project, "config/legacy")).toBe(false);
    expect(readProjectFile(project, "config/current.json")).toBe('{"current":"v2"}\n');
    expect(installedDocks(project)[0]?.files.map((file) => file.path)).toEqual([
      "config/current.json",
    ]);
  });

  it("prunes empty managed folders while preserving folders that contain user files", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "qa", "folder-cleanup", "1.0.0", {
      files: [
        { path: "generated/empty/remove.json", content: '{"remove":true}\n' },
        { path: "generated/kept/remove.json", content: '{"remove":true}\n' },
      ],
    });
    await installDock(docks, project, "qa/folder-cleanup@1.0.0");
    writeFileSync(join(project, "generated", "kept", "user.json"), '{"owner":"user"}\n');

    uninstallDock(project, "qa/folder-cleanup");

    expect(existsProjectPath(project, "generated/empty")).toBe(false);
    expect(existsProjectPath(project, "generated/kept/remove.json")).toBe(false);
    expect(readProjectFile(project, "generated/kept/user.json")).toBe('{"owner":"user"}\n');
    expect(existsProjectPath(project, "generated/kept")).toBe(true);
    expect(existsProjectPath(project, "generated")).toBe(true);
    expect(installedDocks(project)).toEqual([]);
  });

  it("keeps A and C managed blocks and files when only B is uninstalled", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "qa", "dock-a", "1.0.0", {
      files: [
        { path: "AGENTS.md", content: "# Dock A\n" },
        { path: "configs/a.json", content: '{"dock":"a"}\n' },
      ],
    });
    writeDock(docks, "qa", "dock-b", "1.0.0", {
      files: [
        { path: "AGENTS.md", content: "# Dock B\n" },
        { path: "configs/b.json", content: '{"dock":"b"}\n' },
      ],
    });
    writeDock(docks, "qa", "dock-c", "1.0.0", {
      files: [
        { path: "AGENTS.md", content: "# Dock C\n" },
        { path: "configs/c.json", content: '{"dock":"c"}\n' },
      ],
    });
    await installDock(docks, project, "qa/dock-a@1.0.0");
    await installDock(docks, project, "qa/dock-b@1.0.0");
    await installDock(docks, project, "qa/dock-c@1.0.0");

    const uninstallReport = uninstallDock(project, "qa/dock-b");
    const agents = readProjectFile(project, "AGENTS.md");

    expect(uninstallReport.fileChanges).toMatchObject({
      deleted: ["configs/b.json"],
      updated: ["AGENTS.md"],
    });
    expect(agents).toContain("dock=qa/dock-a");
    expect(agents).toContain("dock=qa/dock-c");
    expect(agents).not.toContain("dock=qa/dock-b");
    expect(readProjectFile(project, "configs/a.json")).toBe('{"dock":"a"}\n');
    expect(existsProjectPath(project, "configs/b.json")).toBe(false);
    expect(readProjectFile(project, "configs/c.json")).toBe('{"dock":"c"}\n');
    expect(installedDocks(project).map((dock) => dock.id)).toEqual(["qa/dock-a", "qa/dock-c"]);
  });

  it("isolates multiple dock-owned blocks that share the same target file", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeFileSync(join(project, "AGENTS.md"), "# Project Header\n");
    writeDock(docks, "qa", "alpha", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Alpha v1\n" }],
    });
    writeDock(docks, "qa", "beta", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Beta v1\n" }],
    });
    writeDock(docks, "qa", "beta", "1.0.1", {
      files: [{ path: "AGENTS.md", content: "# Beta v2\n" }],
    });

    await installDock(docks, project, "qa/alpha@1.0.0");
    await installDock(docks, project, "qa/beta@1.0.0");
    await installDock(docks, project, "qa/beta@1.0.1", { phase: "update" });

    let agents = readProjectFile(project, "AGENTS.md");
    expect(agents).toContain("# Project Header");
    expect(agents).toContain("# Alpha v1");
    expect(agents).toContain("# Beta v2");
    expect(agents).not.toContain("# Beta v1");
    expect(countOccurrences(agents, "OPENDOCK:START id=files:AGENTS.md dock=qa/alpha")).toBe(1);
    expect(countOccurrences(agents, "OPENDOCK:START id=files:AGENTS.md dock=qa/beta")).toBe(1);

    uninstallDock(project, "qa/beta");
    agents = readProjectFile(project, "AGENTS.md");

    expect(agents).toContain("# Project Header");
    expect(agents).toContain("# Alpha v1");
    expect(agents).not.toContain("# Beta v2");
    expect(agents).toContain("dock=qa/alpha");
    expect(agents).not.toContain("dock=qa/beta");
    expect(installedDocks(project).map((dock) => dock.id)).toEqual(["qa/alpha"]);
  });
});

interface DockFile {
  content: string;
  path: string;
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-file-lifecycle-"));
  tempRoots.push(dir);
  return dir;
}

function writeDock(
  root: string,
  owner: string,
  name: string,
  version: string,
  options: { files: DockFile[] },
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
      files: options.files.map((file) => ({
        from: `files/${file.path}`,
        to: file.path,
      })),
    }),
  );
}

function installDock(
  docksRoot: string,
  projectDir: string,
  dockRef: string,
  options: { force?: boolean; phase?: "install" | "update" } = {},
) {
  return new DockInstaller().install({
    dockRef: DockRef.parse(dockRef),
    projectDir,
    runTasks: false,
    platform: testPlatform,
    resolve: localResolver(docksRoot),
    ...(options.force === undefined ? {} : { force: options.force }),
    ...(options.phase === undefined ? { phase: "install" as const } : { phase: options.phase }),
  });
}

function uninstallDock(projectDir: string, dockId: string, options: { force?: boolean } = {}) {
  return new DockInstaller().uninstall({
    dockId,
    projectDir,
    ...(options.force === undefined ? {} : { force: options.force }),
  });
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

function installedDocks(projectDir: string): InstalledDockRecord[] {
  return new OpenDockStateStore(projectDir).readLock().docks;
}

function readProjectFile(projectDir: string, path: string): string {
  return readFileSync(join(projectDir, path), "utf8");
}

function existsProjectPath(projectDir: string, path: string): boolean {
  return existsSync(join(projectDir, path));
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}
