import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { c as createTar, t as listTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { parseDeployRef, resolveDeployPlatform } from "../src/cli-options.js";
import {
  type DockManifest,
  DockRef,
  manifestForRef,
  parseManifestFile,
} from "../src/core/domain/manifest.js";
import { createDeployArchive, readDeployLogo, readDeployReadme } from "../src/deploy-package.js";
import { detectPlatform, type OpenDockPlatform } from "../src/platform.js";
import { resolveDock } from "../src/resolver.js";
import { testReleaseSignature } from "./release-signature-helper.js";

const tempRoots: string[] = [];
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("deploy and registry edge-case validation", () => {
  it("binds deploy id and version from the ref, not dock.yml", async () => {
    const root = tempDir();
    mkdirSync(join(root, "files"), { recursive: true });
    writeFileSync(join(root, "files", "AGENTS.md"), "# Agent\n");
    writeManifest(root, {
      opendock: 1,
      summary: "No id or version in manifest.",
      files: [{ from: "files/AGENTS.md", to: "AGENTS.md" }],
    });

    const ref = parseDeployRef("owner/ref-bound@2.3.4");
    const manifest = manifestForRef(parseManifestFile(join(root, "dock.yml")), ref);
    const archive = await createDeployArchive(
      root,
      manifest,
      ref.requested(),
      "linux",
      readFileSync(join(root, "dock.yml"), "utf8"),
    );

    expect(manifest.id).toBe("owner/ref-bound");
    expect(archive.filename).toBe("owner-ref-bound-2.3.4-linux.tgz");
    expect(archive.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects legacy manifest identity fields before deploy packaging", () => {
    for (const [field, value] of [
      ["id", "owner/legacy"],
      ["version", "1.0.0"],
    ] as const) {
      const root = tempDir();
      writeManifest(root, {
        opendock: 1,
        summary: "Legacy field fixture.",
        [field]: value,
      });

      expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow(
        new RegExp(`unsupported dock\\.yml field \`${field}\``),
      );
    }
  });

  it("rejects missing readme and logo files before registry submission", () => {
    const readmeRoot = tempDir();
    const readmeManifest = boundManifest(readmeRoot, "owner/missing-readme@1.0.0", {
      readme: "DOCK.md",
    });

    expect(() => readDeployReadme(readmeRoot, readmeManifest)).toThrow(
      /ENOENT|no such file|does not exist/,
    );

    const logoRoot = tempDir();
    const logoManifest = boundManifest(logoRoot, "owner/missing-logo@1.0.0", {
      logo: "logo.png",
    });

    expect(() => readDeployLogo(logoRoot, logoManifest)).toThrow(
      /ENOENT|no such file|does not exist/,
    );
  });

  it("rejects logo MIME spoofing by checking bytes against the file extension", () => {
    const jpegRoot = tempDir();
    writeFileSync(join(jpegRoot, "logo.jpg"), pngSignature);
    const jpegManifest = boundManifest(jpegRoot, "owner/spoofed-jpeg@1.0.0", {
      logo: "logo.jpg",
    });
    expect(() => readDeployLogo(jpegRoot, jpegManifest)).toThrow(
      "manifest `logo` bytes do not match file type",
    );

    const webpRoot = tempDir();
    writeFileSync(join(webpRoot, "logo.webp"), Buffer.from("RIFF0000NOTP", "ascii"));
    const webpManifest = boundManifest(webpRoot, "owner/spoofed-webp@1.0.0", {
      logo: "logo.webp",
    });
    expect(() => readDeployLogo(webpRoot, webpManifest)).toThrow(
      "manifest `logo` bytes do not match file type",
    );
  });

  it("keeps separate readme and logo metadata out of the deploy archive", async () => {
    const root = tempDir();
    mkdirSync(join(root, "files"), { recursive: true });
    writeFileSync(join(root, "DOCK.md"), "# Dock metadata\n");
    writeFileSync(join(root, "logo.png"), pngSignature);
    writeFileSync(join(root, "files", "AGENTS.md"), "# Agent\n");
    const manifest = boundManifest(root, "owner/archive-metadata@1.0.0", {
      readme: "DOCK.md",
      logo: "logo.png",
      files: [{ from: "files/AGENTS.md", to: "AGENTS.md" }],
    });

    const archive = await createArchive(root, manifest);
    const entries = await listArchiveEntryPaths(Buffer.from(archive.data_base64, "base64"));

    expect(entries).toContain("dock.yml");
    expect(entries).toContain("files/AGENTS.md");
    expect(entries).not.toContain("DOCK.md");
    expect(entries).not.toContain("logo.png");
  });

  it("rejects hardlinks and nested symlinks in deploy archive inputs", async () => {
    const hardlinkRoot = tempDir();
    mkdirSync(join(hardlinkRoot, "files"), { recursive: true });
    writeFileSync(join(hardlinkRoot, "files", "real.md"), "# real\n");
    linkSync(join(hardlinkRoot, "files", "real.md"), join(hardlinkRoot, "files", "hard.md"));
    const hardlinkManifest = boundManifest(hardlinkRoot, "owner/hardlink@1.0.0", {
      files: [{ from: "files/hard.md", to: "README.md" }],
    });

    await expect(createArchive(hardlinkRoot, hardlinkManifest)).rejects.toThrow(
      "deploy archive entry cannot be a hardlink",
    );

    const symlinkRoot = tempDir();
    mkdirSync(join(symlinkRoot, "files"), { recursive: true });
    writeFileSync(join(symlinkRoot, "files", "real.md"), "# real\n");
    symlinkSync("real.md", join(symlinkRoot, "files", "link.md"));
    const symlinkManifest = boundManifest(symlinkRoot, "owner/nested-symlink@1.0.0", {
      files: [{ from: "files", to: ".agents/files" }],
    });

    await expect(createArchive(symlinkRoot, symlinkManifest)).rejects.toThrow(
      "deploy archive entry cannot be a symlink",
    );
  });

  it("deduplicates repeated deploy source roots before archive creation", async () => {
    const root = tempDir();
    mkdirSync(join(root, "files"), { recursive: true });
    writeFileSync(join(root, "files", "shared.md"), "# shared\n");
    const manifest = boundManifest(root, "owner/dedupe@1.0.0", {
      files: [
        { from: "files/shared.md", to: "A.md" },
        { from: "files/shared.md", to: "B.md" },
      ],
      workdir: {
        files: [{ from: "files/shared.md", to: "seed.md" }],
      },
    });

    const archive = await createArchive(root, manifest);
    const entries = await listArchiveEntryPaths(Buffer.from(archive.data_base64, "base64"));

    expect(entries.filter((entry) => entry === "files/shared.md")).toHaveLength(1);
  });

  it("rejects duplicate file entries in downloaded registry archives", async () => {
    const archive = await createDuplicateDockArchive();
    const restore = mockRegistryArchive({
      archive,
      id: "owner/duplicate-entry",
      platform: "macos",
      version: "1.0.0",
    });

    try {
      await expect(
        resolveDock(DockRef.parse("owner/duplicate-entry@1.0.0"), "macos"),
      ).rejects.toThrow("duplicate archive file entry is not allowed");
    } finally {
      restore();
    }
  });

  it("rejects case-insensitive file collisions in downloaded registry archives", async () => {
    const archive = await createCaseFoldCollisionDockArchive();
    if (!archive) {
      return;
    }
    const restore = mockRegistryArchive({
      archive,
      id: "owner/case-fold-entry",
      platform: "macos",
      version: "1.0.0",
    });

    try {
      await expect(
        resolveDock(DockRef.parse("owner/case-fold-entry@1.0.0"), "macos"),
      ).rejects.toThrow("case-insensitive archive file collision is not allowed");
    } finally {
      restore();
    }
  });

  it("rejects registry signature mismatches before archive download", async () => {
    let downloaded = false;
    const restore = mockRegistry({
      archive: Buffer.from("not downloaded"),
      checksum: "0".repeat(64),
      id: "owner/bad-signature",
      platform: "macos",
      signature: testReleaseSignature({
        checksum: "1".repeat(64),
        id: "owner/bad-signature",
        platform: "macos",
        version: "1.0.0",
      }),
      version: "1.0.0",
      onDownload: () => {
        downloaded = true;
      },
    });

    try {
      await expect(
        resolveDock(DockRef.parse("owner/bad-signature@1.0.0"), "macos"),
      ).rejects.toThrow("OpenDock Registry signature verification failed");
      expect(downloaded).toBe(false);
    } finally {
      restore();
    }
  });

  it("rejects registry checksum mismatches after archive download", async () => {
    const archive = await createMinimalDockArchive();
    const wrongChecksum = "f".repeat(64);
    const restore = mockRegistry({
      archive,
      checksum: wrongChecksum,
      id: "owner/bad-checksum",
      platform: "macos",
      signature: testReleaseSignature({
        checksum: wrongChecksum,
        id: "owner/bad-checksum",
        platform: "macos",
        version: "1.0.0",
      }),
      version: "1.0.0",
    });

    try {
      await expect(resolveDock(DockRef.parse("owner/bad-checksum@1.0.0"), "macos")).rejects.toThrow(
        "checksum mismatch",
      );
    } finally {
      restore();
    }
  });

  it("defaults deploy platform to the current OS and rejects any or unknown platforms", () => {
    expect(resolveDeployPlatform(undefined, undefined)).toBe(detectPlatform());
    expect(() => resolveDeployPlatform("any", "dock.yml")).toThrow(
      "unsupported OpenDock platform `any`",
    );
    expect(() => resolveDeployPlatform("solaris", "dock.yml")).toThrow(
      "unsupported OpenDock platform `solaris`",
    );
  });
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "opendock-deploy-registry-edge-test-")));
  tempRoots.push(dir);
  return dir;
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
    summary: "Deploy registry edge fixture.",
    ...overrides,
  });
  return manifestForRef(parseManifestFile(join(root, "dock.yml")), DockRef.parse(ref));
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

async function listArchiveEntryPaths(archive: Buffer): Promise<string[]> {
  const archivePath = join(tempDir(), "archive.tgz");
  writeFileSync(archivePath, archive);
  const entries: string[] = [];
  await listTar({
    file: archivePath,
    onReadEntry: (entry) => {
      entries.push(entry.path);
    },
  });
  return entries;
}

async function createMinimalDockArchive(): Promise<Buffer> {
  const root = tempDir();
  writeManifest(root, {
    opendock: 1,
    summary: "Minimal registry fixture.",
  });
  const archivePath = join(tempDir(), "dock.tgz");
  await createTar({ cwd: root, file: archivePath, gzip: true }, ["dock.yml"]);
  return readFileSync(archivePath);
}

async function createDuplicateDockArchive(): Promise<Buffer> {
  const root = tempDir();
  writeManifest(root, {
    opendock: 1,
    summary: "Duplicate registry fixture.",
  });
  const archivePath = join(tempDir(), "dock.tgz");
  await createTar({ cwd: root, file: archivePath, gzip: true }, ["dock.yml", "dock.yml"]);
  return readFileSync(archivePath);
}

async function createCaseFoldCollisionDockArchive(): Promise<Buffer | undefined> {
  const root = tempDir();
  writeManifest(root, {
    opendock: 1,
    summary: "Case-fold duplicate registry fixture.",
  });
  mkdirSync(join(root, "files"), { recursive: true });
  writeFileSync(join(root, "files", "README.md"), "# upper\n");
  if (existsSync(join(root, "files", "readme.md"))) {
    return undefined;
  }
  writeFileSync(join(root, "files", "readme.md"), "# lower\n");
  const archivePath = join(tempDir(), "dock.tgz");
  await createTar({ cwd: root, file: archivePath, gzip: true }, [
    "dock.yml",
    "files/README.md",
    "files/readme.md",
  ]);
  return readFileSync(archivePath);
}

function mockRegistryArchive(options: {
  archive: Buffer;
  id: string;
  platform: OpenDockPlatform;
  version: string;
}): () => void {
  const checksum = sha256(options.archive);
  return mockRegistry({
    archive: options.archive,
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
  });
}

function mockRegistry(options: {
  archive: Buffer;
  checksum: string;
  id: string;
  onDownload?: () => void;
  platform: OpenDockPlatform;
  signature: ReturnType<typeof testReleaseSignature>;
  version: string;
}): () => void {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/download")) {
      options.onDownload?.();
      return new Response(options.archive, {
        headers: { "content-length": String(options.archive.length) },
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({
        approved: true,
        checksum: options.checksum,
        id: options.id,
        platform: options.platform,
        signature: options.signature,
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
