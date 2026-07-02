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

describe("lifecycle conflict edge cases", () => {
  it("blocks managed block update and uninstall after user edits the block unless forced", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "qa", "block-edit", "1.0.0", {
      files: [{ path: "AGENTS.md", content: "# Managed v1\n" }],
    });
    writeDock(docks, "qa", "block-edit", "1.0.1", {
      files: [{ path: "AGENTS.md", content: "# Managed v2\n" }],
    });

    await installDock(docks, project, "qa/block-edit@1.0.0");
    writeFileSync(
      join(project, "AGENTS.md"),
      readProjectFile(project, "AGENTS.md").replace("# Managed v1", "# User changed managed block"),
    );

    await expect(
      installDock(docks, project, "qa/block-edit@1.0.1", { phase: "update" }),
    ).rejects.toThrow("checksum mismatch for managed block AGENTS.md");
    expect(() => uninstallDock(project, "qa/block-edit")).toThrow(
      "checksum mismatch for managed block AGENTS.md",
    );
    expect(readProjectFile(project, "AGENTS.md")).toContain("# User changed managed block");

    const forcedUpdate = await installDock(docks, project, "qa/block-edit@1.0.1", {
      force: true,
      phase: "update",
    });
    expect(forcedUpdate.fileChanges.updated).toEqual(["AGENTS.md"]);
    expect(readProjectFile(project, "AGENTS.md")).toContain("# Managed v2");

    writeFileSync(
      join(project, "AGENTS.md"),
      readProjectFile(project, "AGENTS.md").replace("# Managed v2", "# User changed again"),
    );
    const forcedUninstall = uninstallDock(project, "qa/block-edit", { force: true });
    expect(forcedUninstall.fileChanges.deleted).toEqual(["AGENTS.md"]);
    expect(existsProjectPath(project, "AGENTS.md")).toBe(false);
    expect(installedDocks(project)).toEqual([]);
  });

  it("recovers a deleted managed file only when update is forced", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "qa", "deleted-file", "1.0.0", {
      files: [{ path: "config/tool.json", content: '{"version":1}\n' }],
    });
    writeDock(docks, "qa", "deleted-file", "1.0.1", {
      files: [{ path: "config/tool.json", content: '{"version":2}\n' }],
    });

    await installDock(docks, project, "qa/deleted-file@1.0.0");
    rmSync(join(project, "config", "tool.json"));

    await expect(
      installDock(docks, project, "qa/deleted-file@1.0.1", { phase: "update" }),
    ).rejects.toThrow("managed file missing: config/tool.json");
    expect(existsProjectPath(project, "config/tool.json")).toBe(false);
    expect(installedDocks(project)[0]?.version).toBe("1.0.0");

    const forcedUpdate = await installDock(docks, project, "qa/deleted-file@1.0.1", {
      force: true,
      phase: "update",
    });
    expect(forcedUpdate.fileChanges.created).toEqual(["config/tool.json"]);
    expect(readProjectFile(project, "config/tool.json")).toBe('{"version":2}\n');
    expect(installedDocks(project)[0]?.version).toBe("1.0.1");
  });

  it("does not remove a file dropped by the new version if the user modified it", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "qa", "removed-file", "1.0.0", {
      files: [
        { path: "config/current.json", content: '{"current":1}\n' },
        { path: "config/legacy.json", content: '{"legacy":1}\n' },
      ],
    });
    writeDock(docks, "qa", "removed-file", "1.0.1", {
      files: [{ path: "config/current.json", content: '{"current":2}\n' }],
    });

    await installDock(docks, project, "qa/removed-file@1.0.0");
    writeFileSync(join(project, "config", "legacy.json"), '{"legacy":"user-edit"}\n');

    await expect(
      installDock(docks, project, "qa/removed-file@1.0.1", { phase: "update" }),
    ).rejects.toThrow("checksum mismatch for managed file config/legacy.json");
    expect(readProjectFile(project, "config/current.json")).toBe('{"current":1}\n');
    expect(readProjectFile(project, "config/legacy.json")).toBe('{"legacy":"user-edit"}\n');
    expect(installedDocks(project)[0]?.version).toBe("1.0.0");

    const forcedUpdate = await installDock(docks, project, "qa/removed-file@1.0.1", {
      force: true,
      phase: "update",
    });
    expect(forcedUpdate.fileChanges).toMatchObject({
      deleted: ["config/legacy.json"],
      updated: ["config/current.json"],
    });
    expect(existsProjectPath(project, "config/legacy.json")).toBe(false);
    expect(readProjectFile(project, "config/current.json")).toBe('{"current":2}\n');
  });

  it("preserves user files in a directory when update removes the last managed file there", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "qa", "directory-preserve", "1.0.0", {
      files: [
        { path: "nested/shared/managed.json", content: '{"managed":true}\n' },
        { path: "root.json", content: '{"root":1}\n' },
      ],
    });
    writeDock(docks, "qa", "directory-preserve", "1.0.1", {
      files: [{ path: "root.json", content: '{"root":2}\n' }],
    });

    await installDock(docks, project, "qa/directory-preserve@1.0.0");
    writeFileSync(join(project, "nested", "shared", "user.json"), '{"owner":"user"}\n');

    await installDock(docks, project, "qa/directory-preserve@1.0.1", { phase: "update" });

    expect(existsProjectPath(project, "nested/shared/managed.json")).toBe(false);
    expect(readProjectFile(project, "nested/shared/user.json")).toBe('{"owner":"user"}\n');
    expect(existsProjectPath(project, "nested/shared")).toBe(true);
    expect(readProjectFile(project, "root.json")).toBe('{"root":2}\n');
  });

  it("keeps shared AGENTS.md blocks isolated when one dock updates and another uninstalls", async () => {
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
    uninstallDock(project, "qa/alpha");

    const agents = readProjectFile(project, "AGENTS.md");
    expect(agents).toContain("# Project Header");
    expect(agents).not.toContain("# Alpha v1");
    expect(agents).toContain("# Beta v2");
    expect(countOccurrences(agents, "dock=qa/alpha")).toBe(0);
    expect(countOccurrences(agents, "dock=qa/beta")).toBe(2);
    expect(installedDocks(project).map((dock) => dock.id)).toEqual(["qa/beta"]);
  });

  it("preflights all update outputs before touching root files", async () => {
    const docks = tempDir();
    const project = tempDir();
    writeDock(docks, "qa", "atomic-update", "1.0.0", {
      files: [{ path: "config/owned.json", content: '{"version":1}\n' }],
    });
    writeDock(docks, "qa", "atomic-update", "1.0.1", {
      files: [
        { path: "config/owned.json", content: '{"version":2}\n' },
        { path: "config/new.json", content: '{"new":true}\n' },
      ],
    });

    await installDock(docks, project, "qa/atomic-update@1.0.0");
    writeFileSync(join(project, "config", "owned.json"), '{"version":"user-edit"}\n');

    await expect(
      installDock(docks, project, "qa/atomic-update@1.0.1", { phase: "update" }),
    ).rejects.toThrow("checksum mismatch for managed file config/owned.json");
    expect(readProjectFile(project, "config/owned.json")).toBe('{"version":"user-edit"}\n');
    expect(existsProjectPath(project, "config/new.json")).toBe(false);
    expect(installedDocks(project)[0]?.version).toBe("1.0.0");
  });
});

interface DockFile {
  content: string;
  path: string;
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-lifecycle-edge-"));
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
