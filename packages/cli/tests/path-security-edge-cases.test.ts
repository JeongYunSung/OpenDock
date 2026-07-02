import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { DockInstaller } from "../src/core/app/dock-installer.js";
import {
  type DockManifest,
  DockRef,
  manifestForRef,
  parseManifestFile,
} from "../src/core/domain/manifest.js";
import { createDeployArchive } from "../src/deploy-package.js";
import type { OpenDockPlatform } from "../src/platform.js";
import type { ResolvedDock } from "../src/resolver.js";

const tempRoots: string[] = [];
const testPlatform: OpenDockPlatform = "macos";

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("path security edge cases", () => {
  it("rejects traversal, absolute, home, Windows drive, and UNC install targets before writing files", async () => {
    for (const target of [
      "../outside.txt",
      "nested/../../outside.txt",
      "/tmp/opendock-owned.txt",
      "~/opendock-owned.txt",
      "C:/Users/Public/opendock-owned.txt",
      "C:Users/Public/opendock-owned.txt",
      "C:\\Users\\Public\\opendock-owned.txt",
      "\\\\server\\share\\opendock-owned.txt",
    ]) {
      const root = tempDir();
      const project = tempDir();
      writeSource(root, "files/payload.json", '{"owned":true}\n');
      const manifest = boundManifest(root, "evil/target-path@1.0.0", {
        files: [
          { from: "files/payload.json", to: "safe/sentinel.json" },
          { from: "files/payload.json", to: target },
        ],
      });

      await expect(installResolved(project, root, manifest)).rejects.toThrow(
        /unsafe file target|protected file target/,
      );
      expect(existsSync(join(project, "safe", "sentinel.json"))).toBe(false);
    }
  });

  it("rejects traversal, absolute, home, Windows drive, and UNC deploy archive sources", async () => {
    for (const source of [
      "../outside.txt",
      "nested/../../outside.txt",
      "/tmp/opendock-source.txt",
      "~/opendock-source.txt",
      "C:/Users/Public/opendock-source.txt",
      "C:Users/Public/opendock-source.txt",
      "C:\\Users\\Public\\opendock-source.txt",
      "\\\\server\\share\\opendock-source.txt",
    ]) {
      const root = tempDir();
      writeSource(root, "files/payload.json", '{"owned":true}\n');
      const manifest = boundManifest(root, "evil/source-path@1.0.0", {
        files: [{ from: source, to: "payload.json" }],
      });

      await expect(createArchive(root, manifest)).rejects.toThrow("unsafe deploy archive path");
    }
  });

  it("rejects symlink file sources and symlink project targets", async () => {
    const sourceRoot = tempDir();
    const sourceProject = tempDir();
    writeSource(sourceRoot, "files/real.json", '{"real":true}\n');
    symlinkSync("real.json", join(sourceRoot, "files", "link.json"));
    const sourceManifest = boundManifest(sourceRoot, "evil/symlink-source@1.0.0", {
      files: [{ from: "files/link.json", to: "linked.json" }],
    });

    await expect(installResolved(sourceProject, sourceRoot, sourceManifest)).rejects.toThrow(
      "file mapping source cannot be a symlink",
    );

    const parentRoot = tempDir();
    const parentProject = tempDir();
    writeSource(parentRoot, "files/payload.json", '{"owned":true}\n');
    mkdirSync(join(parentProject, "outside"), { recursive: true });
    symlinkSync("outside", join(parentProject, "config"));
    const parentManifest = boundManifest(parentRoot, "evil/symlink-parent@1.0.0", {
      files: [{ from: "files/payload.json", to: "config/tool.json" }],
    });

    await expect(installResolved(parentProject, parentRoot, parentManifest)).rejects.toThrow(
      "target parent cannot be a symlink",
    );

    const targetRoot = tempDir();
    const targetProject = tempDir();
    writeSource(targetRoot, "files/payload.json", '{"owned":true}\n');
    writeSource(targetProject, "real-target.json", "{}\n");
    symlinkSync("real-target.json", join(targetProject, "target.json"));
    const targetManifest = boundManifest(targetRoot, "evil/symlink-target@1.0.0", {
      files: [{ from: "files/payload.json", to: "target.json" }],
    });

    await expect(installResolved(targetProject, targetRoot, targetManifest)).rejects.toThrow(
      "target cannot be a symlink",
    );
  });

  it("rejects hardlinked deploy archive entries", async () => {
    const root = tempDir();
    writeSource(root, "files/real.json", '{"real":true}\n');
    linkSync(join(root, "files", "real.json"), join(root, "files", "hardlink.json"));
    const manifest = boundManifest(root, "evil/hardlink-source@1.0.0", {
      files: [{ from: "files/hardlink.json", to: "hardlink.json" }],
    });

    await expect(createArchive(root, manifest)).rejects.toThrow(
      "deploy archive entry cannot be a hardlink",
    );
  });

  it("rejects case-insensitive deploy archive path collisions", async () => {
    const root = tempDir();
    writeSource(root, "files/README.md", "# upper\n");
    if (existsSync(join(root, "files", "readme.md"))) {
      return;
    }
    writeSource(root, "files/readme.md", "# lower\n");
    const manifest = boundManifest(root, "evil/archive-case-collision@1.0.0", {
      files: [{ from: "files", to: "docs" }],
    });

    await expect(createArchive(root, manifest)).rejects.toThrow(
      "case-insensitive deploy archive path collision",
    );
  });

  it("rejects writes to protected project control and secret paths", async () => {
    for (const target of [
      ".git/config",
      ".ssh/id_rsa",
      ".env",
      ".env.local",
      ".opendock/dock.lock.yml",
      ".opendock/project.yml",
      ".opendock/bin/opendock",
      ".opendock/workdirs/evil__dock/output.json",
    ]) {
      const root = tempDir();
      const project = tempDir();
      writeSource(root, "files/payload.json", '{"owned":true}\n');
      const manifest = boundManifest(root, "evil/protected-target@1.0.0", {
        files: [
          { from: "files/payload.json", to: "safe/sentinel.json" },
          { from: "files/payload.json", to: target },
        ],
      });

      await expect(installResolved(project, root, manifest)).rejects.toThrow(
        "protected file target",
      );
      expect(existsSync(join(project, "safe", "sentinel.json"))).toBe(false);
    }
  });

  it("rejects file-vs-directory target collisions without writing other candidates", async () => {
    const parentFileRoot = tempDir();
    const parentFileProject = tempDir();
    writeSource(parentFileRoot, "files/payload.json", '{"owned":true}\n');
    writeSource(parentFileProject, "config", "user-owned file\n");
    const parentFileManifest = boundManifest(parentFileRoot, "evil/parent-file@1.0.0", {
      files: [
        { from: "files/payload.json", to: "safe/sentinel.json" },
        { from: "files/payload.json", to: "config/tool.json" },
      ],
    });

    await expect(
      installResolved(parentFileProject, parentFileRoot, parentFileManifest),
    ).rejects.toThrow("target parent must be a directory");
    expect(existsSync(join(parentFileProject, "safe", "sentinel.json"))).toBe(false);

    const targetDirRoot = tempDir();
    const targetDirProject = tempDir();
    writeSource(targetDirRoot, "files/payload.json", '{"owned":true}\n');
    mkdirSync(join(targetDirProject, "config", "tool.json"), { recursive: true });
    const targetDirManifest = boundManifest(targetDirRoot, "evil/target-dir@1.0.0", {
      files: [
        { from: "files/payload.json", to: "safe/sentinel.json" },
        { from: "files/payload.json", to: "config/tool.json" },
      ],
    });

    await expect(
      installResolved(targetDirProject, targetDirRoot, targetDirManifest),
    ).rejects.toThrow("target must be a regular file");
    expect(existsSync(join(targetDirProject, "safe", "sentinel.json"))).toBe(false);
  });

  it("rejects case-insensitive target collisions when the filesystem exposes them", async () => {
    const project = tempDir();
    if (!isCaseInsensitive(project)) {
      return;
    }

    const root = tempDir();
    writeSource(root, "files/payload.json", '{"owned":true}\n');
    writeSource(project, "configs/Tool.json", '{"owner":"user"}\n');
    const manifest = boundManifest(root, "evil/case-collision@1.0.0", {
      files: [
        { from: "files/payload.json", to: "safe/sentinel.json" },
        { from: "files/payload.json", to: "configs/tool.json" },
      ],
    });

    await expect(installResolved(project, root, manifest)).rejects.toThrow(
      "target already exists and is not OpenDock-owned",
    );
    expect(existsSync(join(project, "safe", "sentinel.json"))).toBe(false);
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-path-security-"));
  tempRoots.push(dir);
  return dir;
}

function writeSource(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeManifest(root: string, manifest: Record<string, unknown>): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "dock.yml"), YAML.stringify(manifest));
}

function boundManifest(
  root: string,
  ref: string,
  overrides: Record<string, unknown>,
): DockManifest {
  writeManifest(root, {
    opendock: 1,
    summary: "Path security fixture",
    ...overrides,
  });
  return manifestForRef(parseManifestFile(join(root, "dock.yml")), DockRef.parse(ref));
}

function installResolved(project: string, root: string, manifest: DockManifest) {
  const resolved: ResolvedDock = {
    checksum: sha256(JSON.stringify(manifest)),
    manifest,
    platform: testPlatform,
    root,
    signature: "test-signature",
    version: "1.0.0",
  };
  return new DockInstaller().install({
    dockRef: DockRef.parse(`${manifest.id}@1.0.0`),
    platform: testPlatform,
    projectDir: project,
    resolve: async () => resolved,
    runTasks: false,
  });
}

function createArchive(root: string, manifest: DockManifest) {
  return createDeployArchive(
    root,
    manifest,
    "1.0.0",
    testPlatform,
    YAML.stringify({
      opendock: 1,
      summary: manifest.summary,
      files: manifest.files,
      workdir: manifest.workdir,
    }),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isCaseInsensitive(root: string): boolean {
  writeSource(root, "CaseProbe", "probe\n");
  return existsSync(join(root, "caseprobe"));
}
