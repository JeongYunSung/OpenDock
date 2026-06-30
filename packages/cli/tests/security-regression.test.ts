import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { TokenStore } from "../src/auth.js";
import {
  browserOpenCommand,
  performBrowserLogin,
  selectAuthProvider,
} from "../src/browser-auth.js";
import { type DockManifest, DockRef } from "../src/core/domain/manifest.js";
import { OpenDockStateStore } from "../src/core/domain/state-store.js";
import type { FileCandidate } from "../src/core/files/file-candidate.js";
import { FilePlan } from "../src/core/files/file-plan.js";
import { safeDockDirectoryName } from "../src/core/files/path-utils.js";
import { CommandRunner } from "../src/core/runtime/command-runner.js";
import { TaskRunner } from "../src/core/runtime/task-runner.js";
import { resolveDock } from "../src/resolver.js";
import { testReleaseSignature } from "./release-signature-helper.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("security regression coverage", () => {
  it("binds browser login callbacks to a client-generated state value", async () => {
    const tokenRoot = tempDir();
    let redirectUri = "";
    const token = await performBrowserLogin({
      client: {
        async startCliLogin(nextRedirectUri: string) {
          redirectUri = nextRedirectUri;
          return { authUrl: "https://registry.opendock.test/login", expiresAt: "soon" };
        },
        async exchangeCliCode(code: string) {
          expect(code).toBe("good-code");
          return {
            token: "test-token",
            expiresAt: "later",
            user: { id: "user-1", email: "user@example.com" },
          };
        },
      },
      openBrowser: async () => {
        const response = await fetch(`${redirectUri}&code=good-code`);
        expect(response.status).toBe(200);
      },
      timeoutMs: 1_000,
      tokenStore: new TokenStore(tokenRoot),
      write: () => undefined,
    });

    expect(token.token).toBe("test-token");
    expect(readFileSync(join(tokenRoot, "auth-token"), "utf8")).toBe("test-token");
  });

  it("normalizes registry browser login URLs before opening them", async () => {
    const tokenRoot = tempDir();
    let redirectUri = "";
    let openedUrl = "";

    await performBrowserLogin({
      client: {
        async startCliLogin(nextRedirectUri: string) {
          redirectUri = nextRedirectUri;
          return {
            authUrl:
              "https://registry.opendock.test/login?scope=openid email profile&response_type=code",
            expiresAt: "soon",
          };
        },
        async exchangeCliCode(code: string) {
          expect(code).toBe("good-code");
          return {
            token: "test-token",
            expiresAt: "later",
            user: { id: "user-1", email: "user@example.com" },
          };
        },
      },
      openBrowser: async (url) => {
        openedUrl = url;
        const response = await fetch(`${redirectUri}&code=good-code`);
        expect(response.status).toBe(200);
      },
      timeoutMs: 1_000,
      tokenStore: new TokenStore(tokenRoot),
      write: () => undefined,
    });

    expect(openedUrl).toContain("scope=openid%20email%20profile");
    expect(openedUrl).toContain("response_type=code");
    expect(openedUrl).not.toContain(" ");
  });

  it("rejects browser login callbacks with the wrong state before exchanging codes", async () => {
    const tokenRoot = tempDir();
    let redirectUri = "";
    let exchanged = false;

    await expect(
      performBrowserLogin({
        client: {
          async startCliLogin(nextRedirectUri: string) {
            redirectUri = nextRedirectUri;
            return { authUrl: "https://registry.opendock.test/login", expiresAt: "soon" };
          },
          async exchangeCliCode() {
            exchanged = true;
            throw new Error("should not exchange forged callback code");
          },
        },
        openBrowser: async () => {
          const forged = new URL(redirectUri);
          forged.searchParams.set("state", "forged");
          forged.searchParams.set("code", "bad-code");
          const response = await fetch(forged);
          expect(response.status).toBe(400);
        },
        timeoutMs: 1_000,
        tokenStore: new TokenStore(tokenRoot),
        write: () => undefined,
      }),
    ).rejects.toThrow("invalid state");

    expect(exchanged).toBe(false);
    expect(existsSync(join(tokenRoot, "auth-token"))).toBe(false);
  });

  it("rejects non-http browser login URLs returned by the Registry", async () => {
    const tokenRoot = tempDir();

    await expect(
      performBrowserLogin({
        client: {
          async startCliLogin() {
            return { authUrl: "file:///tmp/opendock-login", expiresAt: "soon" };
          },
          async exchangeCliCode() {
            throw new Error("should not exchange without opening a safe URL");
          },
        },
        openBrowser: async () => {
          throw new Error("unsafe URL should not be opened");
        },
        timeoutMs: 1_000,
        tokenStore: new TokenStore(tokenRoot),
        write: () => undefined,
      }),
    ).rejects.toThrow("unsupported browser login URL scheme");
  });

  it("rejects plaintext remote browser login URLs", async () => {
    const tokenRoot = tempDir();

    await expect(
      performBrowserLogin({
        client: {
          async startCliLogin() {
            return { authUrl: "http://registry.opendock.test/login", expiresAt: "soon" };
          },
          async exchangeCliCode() {
            throw new Error("should not exchange without opening a safe URL");
          },
        },
        openBrowser: async () => {
          throw new Error("insecure URL should not be opened");
        },
        timeoutMs: 1_000,
        tokenStore: new TokenStore(tokenRoot),
        write: () => undefined,
      }),
    ).rejects.toThrow("insecure browser login URL");
  });

  it("uses an absolute macOS browser opener for packaged app environments", () => {
    expect(browserOpenCommand("https://registry.opendock.app/login", "darwin")).toEqual({
      command: "/usr/bin/open",
      args: ["https://registry.opendock.app/login"],
    });
  });

  it("lets TTY users choose GitHub login with arrow keys", async () => {
    const input = new PassThrough() as PassThrough & {
      isRaw?: boolean;
      isTTY?: boolean;
      setRawMode: (mode: boolean) => void;
    };
    const output = new PassThrough() as PassThrough & { isTTY?: boolean };
    let rendered = "";
    let paused = false;

    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = function setRawMode(this: typeof input, mode: boolean) {
      expect(this).toBe(input);
      input.isRaw = mode;
    };
    const originalPause = input.pause.bind(input);
    input.pause = () => {
      paused = true;
      return originalPause();
    };
    output.isTTY = true;
    output.on("data", (chunk) => {
      rendered += chunk.toString();
    });

    const selection = selectAuthProvider({ input, output });
    await Promise.resolve();
    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "return" });

    await expect(selection).resolves.toBe("github");
    expect(rendered).toContain("OpenDock Login");
    expect(rendered).toContain("Choose a login method:");
    expect(rendered).toContain("❯ Google");
    expect(rendered).toContain("❯ GitHub");
    expect(rendered).toContain("↑/↓ to move, Enter to continue");
    expect(input.isRaw).toBe(false);
    expect(paused).toBe(true);
  });

  it("defaults auth provider selection to Google outside an interactive terminal", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let rendered = "";

    output.on("data", (chunk) => {
      rendered += chunk.toString();
    });

    await expect(selectAuthProvider({ input, output })).resolves.toBe("google");
    expect(rendered).toBe("");
  });

  it("stores auth tokens in a private file and private data directory", async () => {
    const tokenRoot = tempDir();
    const store = new TokenStore(tokenRoot);

    await store.saveToken("test-token\n");

    expect(store.loadToken()).toBe("test-token");
    if (process.platform !== "win32") {
      expect(statSync(tokenRoot).mode & 0o777).toBe(0o700);
      expect(statSync(store.tokenPath()).mode & 0o777).toBe(0o600);
    }
  });

  it("uses collision-resistant dock workdir names", () => {
    const first = safeDockDirectoryName("acme/tools__agent");
    const second = safeDockDirectoryName("acme__tools/agent");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^acme__tools__agent__[a-f0-9]{12}$/);
    expect(second).toMatch(/^acme__tools__agent__[a-f0-9]{12}$/);
  });

  it("rejects local path package specs in package-manager task commands", () => {
    const project = tempDir();
    const runner = new CommandRunner();

    for (const command of [
      "npm install --global .",
      "bun install -g .",
      "pnpm add -g .",
      "pip install .",
      "pip3 install .",
      "pipx install .",
      "uv tool install .",
      "npx .",
      "bunx .",
    ]) {
      expect(() => runner.run(command, { cwd: project, platform: "macos" })).toThrow("not allowed");
    }
  });

  it("allows non-default command shapes only when the exact permission is declared", () => {
    const project = tempDir();
    const runner = new CommandRunner();

    expect(() => runner.run("mkdir -p generated", { cwd: project, platform: "macos" })).toThrow(
      "not allowed",
    );

    const result = runner.run("mkdir -p generated", {
      cwd: project,
      permissions: ["mkdir -p generated"],
      platform: "macos",
    });

    expect(result.success).toBe(true);
    expect(existsSync(join(project, "generated"))).toBe(true);
    expect(() =>
      runner.run("mkdir -p other", {
        cwd: project,
        permissions: ["mkdir -p generated"],
        platform: "macos",
      }),
    ).toThrow("not allowed");
  });

  it("rejects shell operators in doctor checks even when permissions are declared", () => {
    const project = tempDir();
    const manifest: DockManifest = {
      opendock: 1,
      id: "test/doctor-shell",
      summary: "",
      tags: [],
      permission: ["mkdir -p generated"],
      requires: { runtimes: {} },
      files: [],
      tasks: {
        install: [],
        update: [],
        doctor: [
          { id: "bad-check", check: "test -f AGENTS.md && mkdir -p generated", platforms: {} },
        ],
      },
    };

    expect(() =>
      new TaskRunner().run(manifest, {
        dockId: manifest.id,
        phase: "doctor",
        platform: "macos",
        projectDir: project,
      }),
    ).toThrow("shell operators are not allowed");
    expect(existsSync(join(project, "generated"))).toBe(false);
  });

  it("rejects symlinked OpenDock state directories and files", () => {
    const project = tempDir();
    const outside = tempDir();
    symlinkSync(outside, join(project, ".opendock"));

    expect(() => new OpenDockStateStore(project).readLock()).toThrow(
      "OpenDock state directory cannot be a symlink",
    );

    rmSync(join(project, ".opendock"), { force: true });
    mkdirSync(join(project, ".opendock"));
    const outsideStateFile = join(outside, "project.yml");
    writeFileSync(outsideStateFile, "outside: true\n");
    symlinkSync(outsideStateFile, join(project, ".opendock", "project.yml"));

    expect(() => new OpenDockStateStore(project).hasState()).toThrow(
      "OpenDock state file cannot be a symlink",
    );
  });

  it("rejects symlinked dock workdir roots before running task commands", () => {
    const project = tempDir();
    const outside = tempDir();
    const dockId = "test/workdir";
    const workdirRoot = join(project, ".opendock", "workdirs");
    mkdirSync(workdirRoot, { recursive: true });
    symlinkSync(outside, join(workdirRoot, safeDockDirectoryName(dockId)));
    const manifest: DockManifest = {
      opendock: 1,
      id: dockId,
      summary: "",
      tags: [],
      permission: [],
      requires: { runtimes: {} },
      files: [],
      tasks: {
        install: [{ id: "check-workdir", check: "test -d .", workdir: "dock", platforms: {} }],
        update: [],
        doctor: [],
      },
    };

    expect(() =>
      new TaskRunner().run(manifest, {
        dockId,
        phase: "install",
        platform: "macos",
        projectDir: project,
      }),
    ).toThrow("dock workdir cannot be a symlink");
  });

  it("does not adopt pre-existing unmanaged managed-file targets even when bytes match", () => {
    const project = tempDir();
    const candidate: FileCandidate = {
      content: Buffer.from('{"keep":true}\n'),
      executable: false,
      mode: "managed_file",
      path: "secret.json",
      source: "export",
    };
    writeFileSync(join(project, candidate.path), candidate.content);

    expect(() => new FilePlan(project, "test/dock", [], false).preflight([candidate])).toThrow(
      "target already exists and is not OpenDock-owned",
    );
    expect(() => new FilePlan(project, "test/dock", [], true).preflight([candidate])).not.toThrow();
  });

  it("rejects broken symlink managed-file targets as symlinks", () => {
    const project = tempDir();
    const outside = tempDir();
    const candidate: FileCandidate = {
      content: Buffer.from("new content\n"),
      executable: false,
      mode: "managed_file",
      path: "secret.txt",
      source: "files",
    };
    symlinkSync(join(outside, "missing.txt"), join(project, candidate.path));

    expect(() => new FilePlan(project, "test/dock", [], false).preflight([candidate])).toThrow(
      "target cannot be a symlink",
    );
  });

  it("uses a shell-free Windows browser opener for auth URLs", () => {
    const url = "https://registry.opendock.app/login?next=1&provider=github";

    expect(browserOpenCommand(url, "win32")).toEqual({
      command: "explorer.exe",
      args: [url],
    });
  });

  it("rejects dock archives with too many entries even when they are directories", async () => {
    const archive = await createManyDirectoryArchive(5_001);
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/download")) {
        return new Response(archive, {
          headers: { "content-length": String(archive.length) },
          status: 200,
        });
      }
      const checksum = createHash("sha256").update(archive).digest("hex");
      return new Response(
        JSON.stringify({
          approved: true,
          checksum,
          id: "test/many-dirs",
          platform: "macos",
          signature: testReleaseSignature({
            id: "test/many-dirs",
            version: "1.0.0",
            platform: "macos",
            checksum,
          }),
          version: "1.0.0",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      );
    }) as typeof fetch;

    try {
      await expect(resolveDock(DockRef.parse("test/many-dirs@1.0.0"), "macos")).rejects.toThrow(
        "downloaded dock archive contains more than 5000 entries",
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("rejects Registry metadata signed for different release fields before download", async () => {
    const archive = Buffer.from("archive");
    const checksum = createHash("sha256").update(archive).digest("hex");
    let downloaded = false;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/download")) {
        downloaded = true;
        return new Response(archive, { status: 200 });
      }
      return new Response(
        JSON.stringify({
          approved: true,
          checksum,
          id: "test/signed",
          platform: "macos",
          signature: testReleaseSignature({
            id: "test/signed",
            version: "1.0.0",
            platform: "macos",
            checksum: "different-checksum",
          }),
          version: "1.0.0",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      );
    }) as typeof fetch;

    try {
      await expect(resolveDock(DockRef.parse("test/signed@1.0.0"), "macos")).rejects.toThrow(
        "OpenDock Registry signature verification failed for `test/signed@1.0.0`",
      );
      expect(downloaded).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-security-test-"));
  tempRoots.push(dir);
  return dir;
}

async function createManyDirectoryArchive(directoryCount: number): Promise<Buffer> {
  const root = tempDir();
  writeFileSync(join(root, "dock.yml"), "opendock: 1\nid: test/many-dirs\nfiles: []\n");
  const entries = ["dock.yml"];
  for (let index = 0; index < directoryCount; index += 1) {
    const name = `dir-${index}`;
    mkdirSync(join(root, name));
    entries.push(name);
  }
  const archivePath = join(tempDir(), "dock.tgz");
  await createTar({ cwd: root, file: archivePath, gzip: true }, entries);
  return readFileSync(archivePath);
}
