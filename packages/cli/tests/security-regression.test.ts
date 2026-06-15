import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { TokenStore } from "../src/auth.js";
import { browserOpenCommand, performBrowserLogin } from "../src/browser-auth.js";
import { DockRef } from "../src/core/domain/manifest.js";
import { safeDockDirectoryName } from "../src/core/files/path-utils.js";
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
