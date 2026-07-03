import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { parseDeployRef, resolveDeployPlatform } from "../src/cli-options.js";
import { DockInstaller } from "../src/core/app/dock-installer.js";
import {
  type DockManifest,
  DockRef,
  manifestForRef,
  parseManifestFile,
} from "../src/core/domain/manifest.js";
import { validateManifestTaskCommands } from "../src/core/runtime/task-command-validation.js";
import { createDeployArchive, readDeployLogo, readDeployReadme } from "../src/deploy-package.js";
import { detectPlatform, type OpenDockPlatform } from "../src/platform.js";
import { type ResolvedDock, resolveDock } from "../src/resolver.js";
import { testReleaseSignature } from "./release-signature-helper.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("deploy manifest hardening", () => {
  it("does not require a top-level id and binds identity from the deploy reference", () => {
    const root = tempDir();
    writeManifest(root, {
      opendock: 1,
      summary: "Identity comes from owner/name@version.",
    });

    const parsed = parseManifestFile(join(root, "dock.yml"));
    const bound = manifestForRef(parsed, DockRef.parse("test/idless@1.0.0"));

    expect(parsed.id).toBe("");
    expect(bound.id).toBe("test/idless");
  });

  it("rejects top-level id because the current dock.yml spec derives identity from the deploy reference", () => {
    const root = tempDir();
    writeManifest(root, {
      opendock: 1,
      id: "test/legacy-id",
      summary: "Legacy identity field should not be accepted.",
    });

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow(
      /unsupported dock\.yml field `id`|invalid dock\.yml field `id`/,
    );
  });

  it("rejects missing deploy archive source files before submission", async () => {
    const root = tempDir();
    const manifest = boundManifest(root, "test/missing-source@1.0.0", {
      files: [{ from: "files/missing.md", to: "README.md" }],
    });

    await expect(createArchive(root, manifest)).rejects.toThrow(
      /ENOENT|does not exist|no such file/,
    );
  });

  it("rejects traversal deploy archive sources before submission", async () => {
    const root = tempDir();
    const manifest = boundManifest(root, "test/source-traversal@1.0.0", {
      files: [{ from: "../outside.md", to: "README.md" }],
      workdir: {
        files: [{ from: "seeds/../../outside.yml", to: ".agents/oma-config.yaml" }],
      },
    });

    await expect(createArchive(root, manifest)).rejects.toThrow("unsafe deploy archive path");
  });

  it("rejects absolute and traversal install targets from manifest file mappings", async () => {
    const root = tempDir();
    const project = tempDir();
    mkdirSync(join(root, "files"), { recursive: true });
    writeFileSync(join(root, "files", "AGENTS.md"), "# agent\n");

    for (const [target, expected] of [
      ["/tmp/opendock-owned.txt", "unsafe file target"],
      ["nested/../../opendock-owned.txt", "unsafe file target"],
    ] as const) {
      const manifest = boundManifest(root, "test/unsafe-target@1.0.0", {
        files: [{ from: "files/AGENTS.md", to: target }],
      });

      await expect(installResolved(project, root, manifest)).rejects.toThrow(expected);
    }
  });

  it("rejects symlink deploy archive sources before submission", async () => {
    const root = tempDir();
    mkdirSync(join(root, "files"), { recursive: true });
    writeFileSync(join(root, "files", "real.md"), "# real\n");
    symlinkSync("real.md", join(root, "files", "link.md"));
    const manifest = boundManifest(root, "test/symlink-source@1.0.0", {
      files: [{ from: "files/link.md", to: "README.md" }],
    });

    await expect(createArchive(root, manifest)).rejects.toThrow(
      "deploy archive entry cannot be a symlink",
    );
  });

  it("rejects symlink entries in downloaded dock archives before install", async () => {
    const archive = await createSymlinkArchive();
    const restore = mockRegistryArchive({
      archive,
      id: "test/archive-symlink",
      platform: "macos",
      version: "1.0.0",
    });

    try {
      await expect(
        resolveDock(DockRef.parse("test/archive-symlink@1.0.0"), "macos"),
      ).rejects.toThrow("archive entry type `SymbolicLink` is not allowed");
    } finally {
      restore();
    }
  });

  it("rejects shell metacharacters in deploy task run and check commands", () => {
    const root = tempDir();
    writeManifest(root, {
      opendock: 1,
      permission: ["git status"],
      install: [{ id: "bad-run", run: "git status && curl https://example.test" }],
      doctor: [{ id: "bad-check", check: "test -f AGENTS.md; touch owned" }],
    });
    const manifest = manifestForRef(
      parseManifestFile(join(root, "dock.yml")),
      DockRef.parse("test/shell-meta@1.0.0"),
    );

    expect(() => validateManifestTaskCommands(manifest, "macos")).toThrow(/shell operators/);
  });

  it("rejects unsafe dependency paths before submission", () => {
    for (const [path, expected] of [
      ["../outside", "unsafe dependency path"],
      [".opendock/bin", "protected dependency path"],
    ] as const) {
      const root = tempDir();
      writeManifest(root, {
        opendock: 1,
        dependencies: {
          bad: {
            manager: "npm",
            path,
          },
        },
      });
      const manifest = manifestForRef(
        parseManifestFile(join(root, "dock.yml")),
        DockRef.parse("test/bad-dependency@1.0.0"),
      );

      expect(() => validateManifestTaskCommands(manifest, "macos")).toThrow(expected);
    }
  });

  it("validates readme, logo, and tags types while parsing dock.yml", () => {
    for (const [field, value] of [
      ["readme", ["DOCK.md"]],
      ["logo", { path: "logo.png" }],
      ["tags", "security"],
    ] as const) {
      const root = tempDir();
      writeManifest(root, {
        opendock: 1,
        [field]: value,
      });

      expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow(
        new RegExp(`invalid dock\\.yml field \`${field}\``),
      );
    }
  });

  it("validates readme and logo paths and logo bytes before submission", () => {
    const parent = tempDir();
    const root = join(parent, "dock");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(parent, "outside.md"), "# outside\n");

    const readmeManifest = manifestForRef(
      parsedManifest(root, { opendock: 1, readme: "../outside.md" }),
      DockRef.parse("test/readme-path@1.0.0"),
    );
    expect(() => readDeployReadme(root, readmeManifest)).toThrow(
      "manifest `readme` path must stay inside the dock directory",
    );

    writeFileSync(join(root, "logo.png"), "not a png");
    const logoManifest = manifestForRef(
      parsedManifest(root, { opendock: 1, logo: "logo.png" }),
      DockRef.parse("test/logo-bytes@1.0.0"),
    );
    expect(() => readDeployLogo(root, logoManifest)).toThrow(
      "manifest `logo` bytes do not match file type",
    );
  });

  it("uses the current platform, not any, when deploy has no platform flag or filename hint", () => {
    expect(resolveDeployPlatform(undefined, "dock.yml")).toBe(detectPlatform());
  });

  it("reports malformed yaml and schema mismatches with actionable manifest paths", () => {
    const malformed = tempDir();
    writeFileSync(join(malformed, "dock.yml"), "opendock: [\n");
    expect(() => parseManifestFile(join(malformed, "dock.yml"))).toThrow(
      new RegExp(`failed to parse ${escapeRegExp(join(malformed, "dock.yml"))}:`),
    );

    const mismatch = tempDir();
    writeManifest(mismatch, { opendock: "1", tags: ["security"] });
    expect(() => parseManifestFile(join(mismatch, "dock.yml"))).toThrow(
      /invalid dock\.yml field `opendock`/,
    );
  });

  it("rejects unsafe deploy version identifiers before contacting Registry", () => {
    for (const ref of ["test/dock@latest", "test/dock@../1.0.0", "test/dock@1.0.0@extra"]) {
      expect(() => parseDeployRef(ref)).toThrow(/version selector|version identifier/);
    }
  });

  it("rejects mismatched Registry version metadata before downloading the archive", async () => {
    let downloaded = false;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/download")) {
        downloaded = true;
        return new Response("should not download", { status: 200 });
      }
      return new Response(
        JSON.stringify({
          approved: true,
          checksum: "unused",
          id: "test/unsafe-version",
          platform: "macos",
          signature: testReleaseSignature({
            checksum: "unused",
            id: "test/unsafe-version",
            platform: "macos",
            version: "1.0.0",
          }),
          version: "../1.0.0",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      );
    }) as typeof fetch;

    try {
      await expect(
        resolveDock(DockRef.parse("test/unsafe-version@1.0.0"), "macos"),
      ).rejects.toThrow("resolved version ../1.0.0 does not satisfy selector 1.0.0");
      expect(downloaded).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-deploy-hardening-test-"));
  tempRoots.push(dir);
  return dir;
}

function writeManifest(root: string, manifest: Record<string, unknown>): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "dock.yml"), YAML.stringify(manifest));
}

function parsedManifest(root: string, manifest: Record<string, unknown>): DockManifest {
  writeManifest(root, manifest);
  return parseManifestFile(join(root, "dock.yml"));
}

function boundManifest(
  root: string,
  ref: string,
  overrides: Record<string, unknown>,
): DockManifest {
  return manifestForRef(
    parsedManifest(root, {
      opendock: 1,
      summary: "Hardening fixture",
      ...overrides,
    }),
    DockRef.parse(ref),
  );
}

async function createArchive(root: string, manifest: DockManifest) {
  return createDeployArchive(
    root,
    manifest,
    "1.0.0",
    "macos",
    readFileSync(join(root, "dock.yml"), "utf8"),
  );
}

function installResolved(project: string, root: string, manifest: DockManifest) {
  const resolved: ResolvedDock = {
    checksum: "test-checksum",
    manifest,
    platform: "macos",
    root,
    signature: "test-signature",
    version: "1.0.0",
  };
  return new DockInstaller().install({
    dockRef: DockRef.parse(`${manifest.id}@1.0.0`),
    platform: "macos",
    projectDir: project,
    resolve: async () => resolved,
    runTasks: false,
  });
}

async function createSymlinkArchive(): Promise<Buffer> {
  const root = tempDir();
  writeManifest(root, {
    opendock: 1,
    summary: "Archive symlink fixture",
  });
  writeFileSync(join(root, "target.txt"), "target\n");
  symlinkSync("target.txt", join(root, "link.txt"));

  const archivePath = join(tempDir(), "dock.tgz");
  await createTar({ cwd: root, file: archivePath, gzip: true }, [
    "dock.yml",
    "target.txt",
    "link.txt",
  ]);
  return readFileSync(archivePath);
}

function mockRegistryArchive(options: {
  archive: Buffer;
  id: string;
  platform: OpenDockPlatform;
  version: string;
}): () => void {
  const previousFetch = globalThis.fetch;
  const checksum = sha256(options.archive);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/download")) {
      return new Response(options.archive, {
        headers: { "content-length": String(options.archive.length) },
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({
        approved: true,
        checksum,
        id: options.id,
        platform: options.platform,
        signature: testReleaseSignature({
          checksum,
          id: options.id,
          platform: options.platform,
          version: options.version,
        }),
        version: options.version,
      }),
      { headers: { "content-type": "application/json" }, status: 200 },
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
