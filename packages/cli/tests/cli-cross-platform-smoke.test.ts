import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { detectPlatform, type OpenDockPlatform } from "../src/platform.js";
import { testReleaseSignature } from "./release-signature-helper.js";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cliBinaryPath = join(packageDir, "bin", "opendock");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("cross-platform CLI smoke", () => {
  it("installs, lists, updates, and uninstalls a signed copy-only dock on the host runner", async () => {
    const platform = detectPlatform();
    const fixture = createFixture();
    writeFileSync(join(fixture.project, "USER.md"), "# User owned\n");
    writeDock(fixture.docks, "smoke", "simple", "1.0.0", {
      files: [
        { path: "AGENTS.md", content: "# Smoke v1\n" },
        { path: "docs/KEEP.md", content: "# Keep v1\n" },
      ],
    });
    writeDock(fixture.docks, "smoke", "simple", "1.0.1", {
      files: [
        { path: "AGENTS.md", content: "# Smoke v2\n" },
        { path: "docs/NEW.md", content: "# New v2\n" },
      ],
    });
    await writeRegistry(fixture, [
      await registryRelease(fixture.docks, "smoke", "simple", "1.0.0", platform),
      await registryRelease(fixture.docks, "smoke", "simple", "1.0.1", platform, {
        latest: true,
      }),
    ]);

    const install = runCli(fixture, ["install", "smoke/simple@1.0.0", "--platform", platform]);
    expect(install.status, combinedOutput(install)).toBe(0);
    expect(readFileSync(join(fixture.project, "AGENTS.md"), "utf8")).toContain("Smoke v1");
    expect(readFileSync(join(fixture.project, "docs", "KEEP.md"), "utf8")).toContain("Keep v1");
    expect(readFileSync(join(fixture.project, "USER.md"), "utf8")).toContain("User owned");

    const list = runCli(fixture, ["list"]);
    expect(list.status, combinedOutput(list)).toBe(0);
    expect(list.stdout).toContain(`smoke/simple@1.0.0 [${platform}]`);

    const update = runCli(fixture, ["update"]);
    expect(update.status, combinedOutput(update)).toBe(0);
    expect(update.stdout).toContain("Updated smoke/simple: 1.0.0 -> 1.0.1");
    expect(readFileSync(join(fixture.project, "AGENTS.md"), "utf8")).toContain("Smoke v2");
    expect(readFileSync(join(fixture.project, "docs", "NEW.md"), "utf8")).toContain("New v2");
    expect(() => readFileSync(join(fixture.project, "docs", "KEEP.md"), "utf8")).toThrow();

    const uninstall = runCli(fixture, ["uninstall", "smoke/simple"]);
    expect(uninstall.status, combinedOutput(uninstall)).toBe(0);
    expect(() => readFileSync(join(fixture.project, "AGENTS.md"), "utf8")).toThrow();
    expect(() => readFileSync(join(fixture.project, "docs", "NEW.md"), "utf8")).toThrow();
    expect(readFileSync(join(fixture.project, "USER.md"), "utf8")).toContain("User owned");
  });
});

interface Fixture {
  docks: string;
  home: string;
  preload: string;
  project: string;
  registry: string;
  root: string;
}

interface TestRelease {
  archiveBase64: string;
  checksum: string;
  id: string;
  latest: boolean;
  platform: OpenDockPlatform;
  signature: unknown;
  version: string;
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "opendock-cli-smoke-"));
  tempRoots.push(root);
  const fixture = {
    docks: join(root, "docks"),
    home: join(root, "home"),
    preload: join(root, "registry-preload.ts"),
    project: join(root, "project"),
    registry: join(root, "registry.json"),
    root,
  };
  mkdirSync(fixture.docks, { recursive: true });
  mkdirSync(fixture.home, { recursive: true });
  mkdirSync(fixture.project, { recursive: true });
  writeFileSync(fixture.registry, "[]\n");
  writeFileSync(fixture.preload, registryPreloadSource());
  return fixture;
}

function runCli(fixture: Fixture, args: string[]): SpawnSyncReturns<string> {
  return spawnSync("bun", ["--preload", fixture.preload, cliBinaryPath, ...args], {
    cwd: fixture.project,
    encoding: "utf8",
    env: {
      BUN_INSTALL: process.env.BUN_INSTALL,
      HOME: fixture.home,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
      LC_CTYPE: process.env.LC_CTYPE,
      NO_COLOR: "1",
      OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_BASE64:
        process.env.OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_BASE64,
      OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_ID: process.env.OPENDOCK_RELEASE_TRUSTED_PUBLIC_KEY_ID,
      OPENDOCK_TEST_REGISTRY_FIXTURE: fixture.registry,
      PATH: process.env.PATH,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TMPDIR: process.env.TMPDIR,
    },
  });
}

function writeDock(
  root: string,
  owner: string,
  name: string,
  version: string,
  options: { files: Array<{ path: string; content: string }> },
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
      summary: `${owner}/${name} smoke dock`,
      readme: "DOCK.md",
      logo: "logo.png",
      files: options.files.map((file) => ({ from: `files/${file.path}`, to: file.path })),
    }),
  );
  writeFileSync(join(dockRoot, "DOCK.md"), `# ${owner}/${name}\n`);
  writeFileSync(
    join(dockRoot, "logo.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
}

async function writeRegistry(fixture: Fixture, releases: TestRelease[]): Promise<void> {
  writeFileSync(fixture.registry, `${JSON.stringify(releases)}\n`);
}

async function registryRelease(
  root: string,
  owner: string,
  name: string,
  version: string,
  platform: OpenDockPlatform,
  options: { latest?: boolean } = {},
): Promise<TestRelease> {
  const archive = await createDockArchive(root, owner, name, version);
  const checksum = createHash("sha256").update(archive).digest("hex");
  const id = `${owner}/${name}`;
  return {
    archiveBase64: archive.toString("base64"),
    checksum,
    id,
    latest: options.latest === true,
    platform,
    signature: testReleaseSignature({ id, version, platform, checksum }),
    version,
  };
}

async function createDockArchive(
  root: string,
  owner: string,
  name: string,
  version: string,
): Promise<Buffer> {
  const dockRoot = join(root, `${owner}-${name}-${version}`);
  const archivePath = join(root, `${owner}-${name}-${version}.tgz`);
  await createTar({ cwd: dockRoot, file: archivePath, gzip: true }, readdirSync(dockRoot));
  return readFileSync(archivePath);
}

function combinedOutput(result: SpawnSyncReturns<string>): string {
  return `${result.stdout}\n${result.stderr}`;
}

function registryPreloadSource(): string {
  return String.raw`
import { readFileSync } from "node:fs";

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname !== "registry.opendock.app") {
    return new Response("unexpected network request", { status: 599, statusText: "Unexpected" });
  }

  const fixturePath = process.env.OPENDOCK_TEST_REGISTRY_FIXTURE;
  if (!fixturePath) {
    return new Response("missing registry fixture", { status: 500 });
  }
  const releases = JSON.parse(readFileSync(fixturePath, "utf8"));
  const match = url.pathname.match(
    /^\/v1\/docks\/([^/]+)\/([^/]+)\/versions\/([^/]+)(\/download)?$/,
  );
  if (!match) {
    return new Response("not found", { status: 404, statusText: "Not Found" });
  }

  const [, owner, name, rawSelector, download] = match;
  const id = owner + "/" + name;
  const selector = decodeURIComponent(rawSelector ?? "");
  const platform = url.searchParams.get("platform");
  const release = releases.find((candidate) => {
    return (
      candidate.id === id &&
      candidate.platform === platform &&
      (selector === "latest" ? candidate.latest === true : candidate.version === selector)
    );
  });
  if (!release) {
    return new Response("not found", { status: 404, statusText: "Not Found" });
  }

  if (download) {
    const archive = Buffer.from(release.archiveBase64, "base64");
    return new Response(archive, {
      headers: { "content-length": String(archive.byteLength) },
      status: 200,
    });
  }

  return new Response(
    JSON.stringify({
      approved: true,
      checksum: release.checksum,
      id: release.id,
      platform: release.platform,
      signature: release.signature,
      version: release.version,
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
};
`;
}
