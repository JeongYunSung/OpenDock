import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { c as createTar } from "tar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TokenStore } from "../src/auth.js";
import { bootstrapMac, HOMEBREW_INSTALL_COMMAND } from "../src/bootstrap.js";
import { performBrowserLogin } from "../src/browser-auth.js";
import { DockRef, dockManifestSchema, versionSatisfiesSelector } from "../src/dock.js";
import { type DockResolver, install } from "../src/installer.js";
import { lockDocks, readLock, readProjectFile } from "../src/project.js";
import { OpenDockRegistryClient } from "../src/registry.js";
import { resolveDock, resolveLocalDock } from "../src/resolver.js";
import { runCommand, runLifecycle } from "../src/runner.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtCli = join(repoRoot, "bin", "opendock.js");
const tempRoots: string[] = [];

beforeAll(() => {
  const build = spawnSync("bun", ["run", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    throw new Error(`${build.stdout}\n${build.stderr}`);
  }
  chmodSync(builtCli, 0o755);
});

afterAll(async () => {
  await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
});

describe("opendock TypeScript CLI", () => {
  it("installs idempotently and preserves existing files", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeTestDock(docks, "test", "harness", "1.0.0", "# Starter README\n");
    writeFileSync(join(project, "README.md"), "# User README\n");
    writeFileSync(join(project, ".gitignore"), "node_modules/\n");

    const resolver = localResolver(docks);
    const first = await install({
      dockRef: DockRef.parse("test/harness"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: resolver,
    });
    expect(first.dockId).toBe("test/harness");
    expect(first.version).toBe("1.0.0");

    const second = await install({
      dockRef: DockRef.parse("test/harness"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: resolver,
    });
    expect(second.dockId).toBe("test/harness");

    const readme = readFileSync(join(project, "README.md"), "utf8");
    expect(readme).toContain("# User README");
    expect(readme.match(/OPENDOCK:START test\/harness:README\.md/g)).toHaveLength(1);

    const gitignore = readFileSync(join(project, ".gitignore"), "utf8");
    expect(gitignore.match(/node_modules\//g)).toHaveLength(1);
    expect(gitignore).toContain(".DS_Store");

    expect(existsSync(join(project, ".opendock", "project.yml"))).toBe(true);
    expect(existsSync(join(project, ".opendock", "dock.lock.yml"))).toBe(true);
    const projectState = readFileSync(join(project, ".opendock", "project.yml"), "utf8");
    expect(projectState).toContain("applied_docks:");
    const lockState = readFileSync(join(project, ".opendock", "dock.lock.yml"), "utf8");
    expect(lockState).toContain("docks:");
    expect(existsSync(join(project, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(project, "DESIGN.md"))).toBe(true);
  });

  it("reports log output and fixed registry version", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeTestDock(docks, "test", "harness", "1.0.0", "# Starter README\n");
    await install({
      dockRef: DockRef.parse("test/harness"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: localResolver(docks),
    });

    const logs = runCli(project, {}, ["log"]);
    expect(logs.status).toBe(0);
    expect(logs.stdout).toContain("install test/harness");

    const version = runCli(project, {}, ["version"]);
    expect(version.status).toBe(0);
    expect(version.stdout).toContain("registry https://registry.opendock.app");
  });

  it("expands directory file mappings and records managed file policies", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeDirectoryManagedDock(docks, "1.0.0", {
      "rules/frontend.md": "# Frontend\n",
      "skills/design/SKILL.md": "# Design Skill\n",
    });

    const report = await install({
      dockRef: DockRef.parse("test/directory-managed"),
      projectDir: project,
      runCommands: false,
      operation: "install",
      resolve: localResolver(docks),
    });

    expect(report.filesCreated).toBe(2);
    expect(readFileSync(join(project, "project", "rules", "frontend.md"), "utf8")).toBe(
      "# Frontend\n",
    );
    expect(readFileSync(join(project, "project", "skills", "design", "SKILL.md"), "utf8")).toBe(
      "# Design Skill\n",
    );
    expect(readProjectFile(project)?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "project/rules/frontend.md",
          update: "managed_file",
        }),
        expect.objectContaining({
          path: "project/skills/design/SKILL.md",
          update: "managed_file",
        }),
      ]),
    );
  });

  it("stops install before replacing existing untracked managed files unless forced", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeDirectoryManagedDock(docks, "1.0.0", {
      "config.yml": "tool: dock\n",
    });
    mkdirSync(join(project, "project"), { recursive: true });
    writeFileSync(join(project, "project", "config.yml"), "tool: user\n");

    await expect(
      install({
        dockRef: DockRef.parse("test/directory-managed"),
        projectDir: project,
        runCommands: false,
        operation: "install",
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("require review");
    expect(readFileSync(join(project, "project", "config.yml"), "utf8")).toBe("tool: user\n");
    expect(existsSync(join(project, ".opendock", "project.yml"))).toBe(false);

    const report = await install({
      dockRef: DockRef.parse("test/directory-managed"),
      force: true,
      projectDir: project,
      runCommands: false,
      operation: "install",
      resolve: localResolver(docks),
    });

    expect(report.filesUpdated).toBe(1);
    expect(report.filesReviewRequired).toBe(0);
    expect(readFileSync(join(project, "project", "config.yml"), "utf8")).toBe("tool: dock\n");
    expect(existsSync(join(project, ".opendock", "project.yml"))).toBe(true);
  });

  it("reconciles skipped dock versions without git-style conflict resolution", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeDirectoryManagedDock(docks, "0.1.0", {
      "test.md": "version 0.1\n",
    });
    const resolver = localResolver(docks);

    await install({
      dockRef: DockRef.parse("test/directory-managed"),
      projectDir: project,
      runCommands: false,
      operation: "install",
      resolve: resolver,
    });

    writeDirectoryManagedDock(docks, "0.3.0", {
      "machine.md": "version 0.3\n",
    });
    const report = await install({
      dockRef: DockRef.parse("test/directory-managed"),
      projectDir: project,
      runCommands: false,
      operation: "update",
      phase: "update",
      resolve: resolver,
    });

    expect(report.filesCreated).toBe(1);
    expect(report.filesDeleted).toBe(1);
    expect(report.filesReviewRequired).toBe(0);
    expect(existsSync(join(project, "project", "test.md"))).toBe(false);
    expect(readFileSync(join(project, "project", "machine.md"), "utf8")).toBe("version 0.3\n");
    expect(readProjectFile(project)?.files.map((file) => file.path)).toEqual([
      "project/machine.md",
    ]);
  });

  it("stops before applying updates when removed managed files were user-edited", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeDirectoryManagedDock(docks, "0.1.0", {
      "test.md": "version 0.1\n",
    });
    const resolver = localResolver(docks);

    await install({
      dockRef: DockRef.parse("test/directory-managed"),
      projectDir: project,
      runCommands: false,
      operation: "install",
      resolve: resolver,
    });
    writeFileSync(join(project, "project", "test.md"), "user change\n");

    writeDirectoryManagedDock(
      docks,
      "0.3.0",
      {
        "machine.md": "version 0.3\n",
      },
      { updateMarker: true },
    );

    await expect(
      install({
        dockRef: DockRef.parse("test/directory-managed"),
        projectDir: project,
        runCommands: true,
        operation: "update",
        phase: "update",
        resolve: resolver,
      }),
    ).rejects.toThrow("require review");

    expect(readFileSync(join(project, "project", "test.md"), "utf8")).toBe("user change\n");
    expect(existsSync(join(project, "project", "machine.md"))).toBe(false);
    expect(existsSync(join(project, ".updated"))).toBe(false);
    expect(
      readProjectFile(project)
        ?.files.map((file) => file.path)
        .sort(),
    ).toEqual(["project/test.md"]);
  });

  it("force-updates user-edited removed managed files", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeDirectoryManagedDock(docks, "0.1.0", {
      "test.md": "version 0.1\n",
    });
    const resolver = localResolver(docks);

    await install({
      dockRef: DockRef.parse("test/directory-managed"),
      projectDir: project,
      runCommands: false,
      operation: "install",
      resolve: resolver,
    });
    writeFileSync(join(project, "project", "test.md"), "user change\n");

    writeDirectoryManagedDock(docks, "0.3.0", {
      "machine.md": "version 0.3\n",
    });
    const report = await install({
      dockRef: DockRef.parse("test/directory-managed"),
      force: true,
      projectDir: project,
      runCommands: false,
      operation: "update",
      phase: "update",
      resolve: resolver,
    });

    expect(report.filesCreated).toBe(1);
    expect(report.filesDeleted).toBe(1);
    expect(report.filesReviewRequired).toBe(0);
    expect(existsSync(join(project, "project", "test.md"))).toBe(false);
    expect(readFileSync(join(project, "project", "machine.md"), "utf8")).toBe("version 0.3\n");
    expect(readProjectFile(project)?.files.map((file) => file.path)).toEqual([
      "project/machine.md",
    ]);
  });

  it("stops before replacing user-edited managed files", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeDirectoryManagedDock(docks, "1.0.0", {
      "config.yml": "tool: old\n",
    });
    const resolver = localResolver(docks);

    await install({
      dockRef: DockRef.parse("test/directory-managed"),
      projectDir: project,
      runCommands: false,
      operation: "install",
      resolve: resolver,
    });
    writeFileSync(join(project, "project", "config.yml"), "tool: user\n");

    writeDirectoryManagedDock(docks, "1.1.0", {
      "config.yml": "tool: new\n",
    });
    await expect(
      install({
        dockRef: DockRef.parse("test/directory-managed"),
        projectDir: project,
        runCommands: false,
        operation: "update",
        phase: "update",
        resolve: resolver,
      }),
    ).rejects.toThrow("require review");

    expect(readFileSync(join(project, "project", "config.yml"), "utf8")).toBe("tool: user\n");
    expect(readProjectFile(project)?.files).toEqual([
      expect.objectContaining({
        path: "project/config.yml",
        update: "managed_file",
      }),
    ]);
  });

  it("force-replaces user-edited managed files", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeDirectoryManagedDock(docks, "1.0.0", {
      "config.yml": "tool: old\n",
    });
    const resolver = localResolver(docks);

    await install({
      dockRef: DockRef.parse("test/directory-managed"),
      projectDir: project,
      runCommands: false,
      operation: "install",
      resolve: resolver,
    });
    writeFileSync(join(project, "project", "config.yml"), "tool: user\n");

    writeDirectoryManagedDock(docks, "1.1.0", {
      "config.yml": "tool: new\n",
    });
    const report = await install({
      dockRef: DockRef.parse("test/directory-managed"),
      force: true,
      projectDir: project,
      runCommands: false,
      operation: "update",
      phase: "update",
      resolve: resolver,
    });

    expect(report.filesUpdated).toBe(1);
    expect(report.filesReviewRequired).toBe(0);
    expect(readFileSync(join(project, "project", "config.yml"), "utf8")).toBe("tool: new\n");
    expect(readProjectFile(project)?.files).toEqual([
      expect.objectContaining({
        path: "project/config.yml",
        update: "managed_file",
      }),
    ]);
  });

  it("rejects duplicate file mapping targets", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    const dockRoot = join(docks, "test", "duplicate-target");
    mkdirSync(join(dockRoot, "files"), { recursive: true });
    writeFileSync(join(dockRoot, "files", "first.md"), "first\n");
    writeFileSync(join(dockRoot, "files", "second.md"), "second\n");
    writeFileSync(
      join(dockRoot, "dock.yml"),
      `opendock: 1
id: test/duplicate-target
version: 1.0.0
files:
  - from: files/first.md
    to: README.md
    update: managed_file
  - from: files/second.md
    to: README.md
    update: managed_file
`,
    );

    await expect(
      install({
        dockRef: DockRef.parse("test/duplicate-target"),
        projectDir: project,
        runCommands: false,
        operation: "install",
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("duplicate file mapping target");
  });

  it("uses the fixed OpenDock Registry endpoint for remote resolution", async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return new Response("{}", { status: 503, statusText: "Unavailable" });
    }) as typeof fetch;

    try {
      await expect(resolveDock(DockRef.parse("test/harness"))).rejects.toThrow(
        "https://registry.opendock.app/v1/docks/test/harness/versions/latest",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(urls).toEqual(["https://registry.opendock.app/v1/docks/test/harness/versions/latest"]);
  });

  it("resolves remote docks using exact version selectors", async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return new Response("{}", { status: 503, statusText: "Unavailable" });
    }) as typeof fetch;

    try {
      await expect(resolveDock(DockRef.parse("test/harness@designer-build"))).rejects.toThrow(
        "https://registry.opendock.app/v1/docks/test/harness/versions/designer-build",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(urls).toEqual([
      "https://registry.opendock.app/v1/docks/test/harness/versions/designer-build",
    ]);
  });

  it("installs remote docks with exact selector metadata and stores the requested selector", async () => {
    const project = await tempDir();
    const home = await tempDir();
    const archiveRoot = await tempDir();
    const archive = await createRemoteDockArchive(archiveRoot, "test", "remote", "1.5.2");
    const checksum = sha256Bytes(archive);
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://registry.opendock.app/v1/docks/test/remote/versions/1.5.2") {
        return new Response(
          JSON.stringify({
            approved: true,
            checksum,
            id: "test/remote",
            signature: "registry-signature",
            version: "1.5.2",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      if (url === "https://registry.opendock.app/v1/docks/test/remote/versions/1.5.2/download") {
        return new Response(archive, { status: 200 });
      }
      return new Response("{}", { status: 404, statusText: "Not Found" });
    }) as typeof fetch;

    try {
      const report = await withEnv({ HOME: home }, () =>
        install({
          dockRef: DockRef.parse("test/remote@1.5.2"),
          projectDir: project,
          runCommands: true,
          operation: "install",
          phase: "install",
        }),
      );
      expect(report.dockId).toBe("test/remote");
      expect(report.version).toBe("1.5.2");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(urls).toEqual([
      "https://registry.opendock.app/v1/docks/test/remote/versions/1.5.2",
      "https://registry.opendock.app/v1/docks/test/remote/versions/1.5.2/download",
    ]);
    expect(readFileSync(join(project, "README.md"), "utf8")).toBe("# Remote Dock\n");
    const lockedDock = lockDocks(readLock(project))[0];
    if (lockedDock === undefined) {
      throw new Error("expected remote dock in lock file");
    }
    expect(lockedDock).toMatchObject({
      checksum,
      id: "test/remote",
      requested: "1.5.2",
      signature: "registry-signature",
      version: "1.5.2",
    });
  });

  it("rejects unsafe remote versions oversized archives and symlink archive entries", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          approved: true,
          checksum: "unused",
          id: "test/unsafe-version",
          signature: "registry-signature",
          version: "../../bad",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      )) as typeof fetch;

    try {
      await expect(resolveDock(DockRef.parse("test/unsafe-version"))).rejects.toThrow(
        "unsafe dock version",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = (async () =>
      new Response("", {
        headers: { "content-length": String(51 * 1024 * 1024) },
        status: 200,
      })) as typeof fetch;

    try {
      await expect(
        new OpenDockRegistryClient().downloadDock("test", "large", "1.0.0"),
      ).rejects.toThrow("exceeds");
    } finally {
      globalThis.fetch = originalFetch;
    }

    const project = await tempDir();
    const home = await tempDir();
    const archiveRoot = await tempDir();
    const archive = await createSymlinkDockArchive(archiveRoot, "test", "symlink-archive", "1.0.0");
    const checksum = sha256Bytes(archive);
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url === "https://registry.opendock.app/v1/docks/test/symlink-archive/versions/latest") {
        return new Response(
          JSON.stringify({
            approved: true,
            checksum,
            id: "test/symlink-archive",
            signature: "registry-signature",
            version: "1.0.0",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      return new Response(archive, { status: 200 });
    }) as typeof fetch;

    try {
      await expect(
        withEnv({ HOME: home }, () =>
          install({
            dockRef: DockRef.parse("test/symlink-archive"),
            projectDir: project,
            runCommands: false,
            operation: "install",
          }),
        ),
      ).rejects.toThrow("not allowed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("submits docks only to the fixed OpenDock Registry", async () => {
    const urls: string[] = [];
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      urls.push(String(input));
      if (init?.body) {
        bodies.push(String(init.body));
      }
      return new Response(JSON.stringify({ id: "submission-1", status: "pending" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    try {
      const response = await new OpenDockRegistryClient().submitDock(
        {
          dock_name: "codex",
          manifest: "opendock: 1",
          readme_markdown: "# Dock docs\n",
          logo: {
            filename: "logo.png",
            content_type: "image/png",
            data_base64: "iVBORw0KGgo=",
          },
        },
        "token",
      );
      expect(response.status).toBe("pending");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(urls).toEqual(["https://registry.opendock.app/v1/docks/submissions"]);
    expect(bodies).toEqual([
      JSON.stringify({
        dock_name: "codex",
        manifest: "opendock: 1",
        readme_markdown: "# Dock docs\n",
        logo: {
          filename: "logo.png",
          content_type: "image/png",
          data_base64: "iVBORw0KGgo=",
        },
      }),
    ]);
  });

  it("uses the fixed OpenDock Registry for cli auth endpoints", async () => {
    const requests: Array<{ body: string | undefined; method: string; url: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requests.push({
        body: init?.body === undefined ? undefined : String(init.body),
        method: init?.method ?? "GET",
        url: String(input),
      });
      const url = String(input);
      if (url.endsWith("/auth/cli/start")) {
        return new Response(
          JSON.stringify({
            authUrl: "https://accounts.example.test/login",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/auth/cli/exchange")) {
        return new Response(
          JSON.stringify({
            token: "od_test",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            user: { email: "designer@example.com", id: "user-1" },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/auth/me")) {
        return new Response(JSON.stringify({ email: "designer@example.com", id: "user-1" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/auth/logout")) {
        return new Response("", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    try {
      const client = new OpenDockRegistryClient();
      await client.startCliLogin("http://127.0.0.1:49152/callback");
      await client.exchangeCliCode("oc_test_code");
      await client.currentUser("od_test");
      await client.logout("od_test");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([
      {
        body: JSON.stringify({ redirectUri: "http://127.0.0.1:49152/callback" }),
        method: "POST",
        url: "https://registry.opendock.app/v1/auth/cli/start",
      },
      {
        body: JSON.stringify({ code: "oc_test_code" }),
        method: "POST",
        url: "https://registry.opendock.app/v1/auth/cli/exchange",
      },
      {
        body: undefined,
        method: "GET",
        url: "https://registry.opendock.app/v1/auth/me",
      },
      {
        body: undefined,
        method: "POST",
        url: "https://registry.opendock.app/v1/auth/logout",
      },
    ]);
  });

  it("performs browser auth through localhost callback and stores the cli token", async () => {
    const authRoot = await tempDir();
    let callbackUri = "";
    const messages: string[] = [];
    const tokenStore = new TokenStore(authRoot);
    const token = await performBrowserLogin({
      tokenStore,
      write: (message) => messages.push(message),
      client: {
        async startCliLogin(redirectUri: string) {
          callbackUri = redirectUri;
          return {
            authUrl: "https://accounts.example.test/login",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          };
        },
        async exchangeCliCode(code: string) {
          expect(code).toBe("oc_test_login_code");
          return {
            token: "od_test_cli_token",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            user: {
              id: "11111111-1111-1111-1111-111111111111",
              email: "designer@example.com",
              displayName: "Designer",
            },
          };
        },
      },
      openBrowser: async () => {
        const response = await fetch(`${callbackUri}?code=oc_test_login_code`);
        expect(response.status).toBe(200);
      },
    });

    expect(token.token).toBe("od_test_cli_token");
    expect(tokenStore.loadToken()).toBe("od_test_cli_token");
    expect(messages.join("\n")).toContain("Logged in as designer@example.com.");
    expect(messages.join("\n")).toContain(
      "Open this URL if the browser does not open: https://accounts.example.test/login",
    );
  });

  it("fails browser auth cleanly when the callback receives an error", async () => {
    const authRoot = await tempDir();
    let callbackUri = "";
    const tokenStore = new TokenStore(authRoot);

    await expect(
      performBrowserLogin({
        tokenStore,
        client: {
          async startCliLogin(redirectUri: string) {
            callbackUri = redirectUri;
            return {
              authUrl: "https://accounts.example.test/login",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            };
          },
          async exchangeCliCode() {
            throw new Error("should not exchange after callback error");
          },
        },
        openBrowser: async () => {
          const response = await fetch(`${callbackUri}?error=access_denied`);
          expect(response.status).toBe(200);
        },
      }),
    ).rejects.toThrow("OpenDock login failed: access_denied");

    expect(tokenStore.loadToken()).toBeUndefined();
  });

  it("prints a manual login url and rechecks waiting status from tty input", async () => {
    const authRoot = await tempDir();
    let callbackUri = "";
    const messages: string[] = [];
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const tokenStore = new TokenStore(authRoot);

    const login = performBrowserLogin({
      input,
      output,
      tokenStore,
      write: (message) => messages.push(message),
      client: {
        async startCliLogin(redirectUri: string) {
          callbackUri = redirectUri;
          return {
            authUrl: "https://accounts.example.test/login",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          };
        },
        async exchangeCliCode(code: string) {
          expect(code).toBe("oc_tty_code");
          return {
            token: "od_tty_token",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            user: {
              id: "22222222-2222-2222-2222-222222222222",
              email: "designer@example.com",
            },
          };
        },
      },
      openBrowser: async () => {
        throw new Error("browser unavailable");
      },
    });

    await waitFor(() => messages.some((message) => message.includes("Open this URL")));
    input.write("\n");
    await waitFor(() => messages.includes("Still waiting for browser login..."));

    const response = await fetch(`${callbackUri}?code=oc_tty_code`);
    expect(response.status).toBe(200);

    const token = await login;
    expect(token.token).toBe("od_tty_token");
    expect(tokenStore.loadToken()).toBe("od_tty_token");
    expect(messages.join("\n")).toContain(
      "Open this URL if the browser does not open: https://accounts.example.test/login",
    );
    expect(messages.join("\n")).toContain(
      "Browser did not open automatically. Continue with the URL above.",
    );
  });

  it("supports opendock v1 files lifecycle and doctor checks", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeModernDock(docks);
    writeFileSync(join(project, "README.md"), "# User README\n");
    writeFileSync(join(project, "DESIGN.md"), "# User Design\n");
    writeFileSync(join(project, ".gitignore"), "node_modules/\n");
    const resolver = localResolver(docks);

    const installReport = await install({
      dockRef: DockRef.parse("test/modern"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: resolver,
    });
    expect(installReport.dockId).toBe("test/modern");
    expect(existsSync(join(project, ".opendock-fixture"))).toBe(true);

    const readme = readFileSync(join(project, "README.md"), "utf8");
    expect(readme).toBe("# User README\n");
    const design = readFileSync(join(project, "DESIGN.md"), "utf8");
    expect(design).toContain("# User Design");
    expect(design.match(/OPENDOCK:START test\/modern:DESIGN\.md/g)).toHaveLength(1);
    const gitignore = readFileSync(join(project, ".gitignore"), "utf8");
    expect(gitignore.match(/node_modules\//g)).toHaveLength(1);
    expect(gitignore).toContain(".DS_Store");

    const reinstall = await install({
      dockRef: DockRef.parse("test/modern"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: resolver,
    });
    expect(reinstall.dockId).toBe("test/modern");
    const reinstalledDesign = readFileSync(join(project, "DESIGN.md"), "utf8");
    expect(reinstalledDesign).toContain("# User Design");
    expect(reinstalledDesign.match(/OPENDOCK:START test\/modern:DESIGN\.md/g)).toHaveLength(1);

    const resolved = await resolver(DockRef.parse("test/modern"));
    const doctor = await runLifecycle(resolved.manifest, "doctor", project);
    expect(doctor.find((report) => report.id === "node")?.status).toBe("Ready");
    expect(doctor.find((report) => report.id === "fixture")?.status).toBe("Ready");

    await install({
      dockRef: DockRef.parse("test/modern"),
      projectDir: project,
      runCommands: true,
      operation: "update",
      phase: "update",
      resolve: resolver,
    });
    expect(existsSync(join(project, ".opendock-updated"))).toBe(true);
  });

  it("applies only files listed in the manifest", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    const dockRoot = join(docks, "test", "explicit-files");
    mkdirSync(join(dockRoot, "unlisted"), { recursive: true });
    writeFileSync(join(dockRoot, "unlisted", "README.md"), "# Unlisted README\n");
    writeFileSync(
      join(dockRoot, "dock.yml"),
      `opendock: 1
id: test/explicit-files
version: 1.0.0
lifecycle:
  install:
    - id: marker
      run: mkdir .installed
`,
    );

    const report = await install({
      dockRef: DockRef.parse("test/explicit-files"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: localResolver(docks),
    });

    expect(report.filesCreated).toBe(0);
    expect(report.filesUpdated).toBe(0);
    expect(existsSync(join(project, "README.md"))).toBe(false);
    expect(existsSync(join(project, ".installed"))).toBe(true);
  });

  it("keeps bundled example manifests valid", () => {
    const refs = [
      "opendock/git",
      "opendock/codex",
      "opendock/oma",
      "opendock/claude-code",
      "opendock/oh-my-codex",
      "opendock/oh-my-openagent",
    ];
    for (const ref of refs) {
      const resolved = resolveLocalDock(join(repoRoot, "examples"), DockRef.parse(ref));
      expect(resolved.manifest.id).toBe(ref);
      expect(resolved.manifest.summary).not.toBe("");
      expect(resolved.manifest.readme).toBe("DOCK.md");
      expect(existsSync(join(resolved.root, resolved.manifest.readme ?? ""))).toBe(true);
      expect(resolved.manifest.logo).toMatch(/^logo\.(jpg|png)$/);
      const logoPath = join(resolved.root, resolved.manifest.logo ?? "");
      expect(existsSync(logoPath)).toBe(true);
      expect(statSync(logoPath).size).toBeGreaterThan(0);
      expect(statSync(logoPath).size).toBeLessThanOrEqual(512 * 1024);
    }
  });

  it("keeps the bundled oma example without project file payload", () => {
    const resolved = resolveLocalDock(join(repoRoot, "examples"), DockRef.parse("opendock/oma"));

    expect(resolved.manifest.files).toHaveLength(0);
    expect(resolved.manifest.lifecycle.install.map((step) => step.id)).toEqual([
      "install-bun",
      "install-oma-cli",
      "apply-oma-project",
      "verify-oma",
    ]);
    expect(
      resolved.manifest.lifecycle.install.find((step) => step.id === "apply-oma-project"),
    ).toMatchObject({ run: "oma" });
    expect(
      resolved.manifest.lifecycle.update.find((step) => step.id === "update-oma-project"),
    ).toMatchObject({ run: "oma" });
    expect(existsSync(join(resolved.root, "files"))).toBe(false);
  });

  it("runs bundled macos and windows examples with a fake toolchain", async () => {
    const examplesRoot = join(repoRoot, "examples");
    const bin = await tempDir();
    writeFakeToolchain(bin);

    const refs = [
      "opendock/git",
      "opendock/codex",
      "opendock/claude-code",
      "opendock/oh-my-codex",
      "opendock/oh-my-openagent",
    ];

    for (const platform of ["macos", "windows"] as const) {
      await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, async () => {
        for (const ref of refs) {
          const project = await tempDir();
          const dockRef = DockRef.parse(ref);
          const resolver = localResolver(examplesRoot);

          const installReport = await install({
            dockRef,
            projectDir: project,
            runCommands: true,
            operation: "install",
            phase: "install",
            platform,
            resolve: resolver,
          });
          expect(installReport.dockId).toBe(ref);
          if (ref === "opendock/codex") {
            expect(installReport.filesCreated).toBe(4);
            expect(readFileSync(join(project, "README.md"), "utf8")).toContain("opendock/codex");
            expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toContain(
              "AI-ready Codex workspace",
            );
            expect(readFileSync(join(project, "DESIGN.md"), "utf8")).toContain(
              "track design principles",
            );
            expect(readFileSync(join(project, ".gitignore"), "utf8")).toContain("target/");
          }

          const updateReport = await install({
            dockRef,
            projectDir: project,
            runCommands: true,
            operation: "update",
            phase: "update",
            platform,
            resolve: resolver,
          });
          expect(updateReport.dockId).toBe(ref);

          const resolved = resolveLocalDock(examplesRoot, dockRef);
          const doctor = await runLifecycle(resolved.manifest, "doctor", project, { platform });
          expect(doctor.map((report) => report.status)).toEqual(doctor.map(() => "Ready" as const));
        }
      });
    }
  }, 15_000);

  it("merges platform-specific lifecycle steps in declared order and records platform", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writePlatformDock(docks);

    const installReport = await install({
      dockRef: DockRef.parse("test/platforms"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      platform: "windows",
      resolve: localResolver(docks),
    });

    expect(installReport.platform).toBe("windows");
    expect(installReport.steps.map((step) => step.id)).toEqual([
      "common-start",
      "install-tool",
      "common-end",
    ]);
    expect(existsSync(join(project, ".windows-tool"))).toBe(true);
    expect(existsSync(join(project, ".mac-tool"))).toBe(false);
    const lockedPlatform = lockDocks(readLock(project))[0]?.platform;
    if (lockedPlatform === undefined) {
      throw new Error("expected platform in lock file");
    }
    expect(lockedPlatform).toBe("windows");

    const resolved = resolveLocalDock(docks, DockRef.parse("test/platforms"));
    const doctor = await runLifecycle(resolved.manifest, "doctor", project, {
      platform: lockedPlatform,
    });
    expect(doctor.find((report) => report.id === "tool")?.status).toBe("Ready");
  });

  it("rejects unsupported platforms and platform-specific package managers", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    const dockRoot = join(docks, "test", "mac-only");
    mkdirSync(join(dockRoot, "files"), { recursive: true });
    writeFileSync(join(dockRoot, "files", "README.md"), "# Mac-only dock\n");
    writeFileSync(
      join(dockRoot, "dock.yml"),
      `opendock: 1
id: test/mac-only
version: 1.0.0
files:
  - from: files/README.md
    to: README.md
    update: manual_review
lifecycle:
  install:
    - id: install-tool
      platforms:
        macos:
          run: mkdir .mac-tool
`,
    );

    await expect(
      install({
        dockRef: DockRef.parse("test/mac-only"),
        projectDir: project,
        runCommands: true,
        operation: "install",
        phase: "install",
        platform: "windows",
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("does not support platform `windows`");
    expect(existsSync(join(project, "README.md"))).toBe(false);
    expect(existsSync(join(project, ".opendock", "dock.lock.yml"))).toBe(false);

    const macOnly = dockManifestSchema.parse({
      opendock: 1,
      id: "test/mac-only",
      lifecycle: {
        install: [
          {
            id: "install-tool",
            platforms: {
              macos: {
                run: "mkdir .mac-tool",
              },
            },
          },
        ],
      },
    });
    await expect(
      runLifecycle(macOnly, "install", project, { platform: "windows" }),
    ).rejects.toThrow("does not support platform `windows`");

    const unsafeWindows = dockManifestSchema.parse({
      opendock: 1,
      id: "test/unsafe-windows",
      lifecycle: {
        install: [
          {
            id: "wrong-manager",
            run: "brew install git",
          },
        ],
      },
    });
    await expect(
      runLifecycle(unsafeWindows, "install", project, { platform: "windows" }),
    ).rejects.toThrow("not allowed for OpenDock platform `windows`");
  });

  it("exposes platform options in install update and doctor commands", () => {
    for (const command of ["install", "update", "doctor"]) {
      const help = runCli(process.cwd(), {}, [command, "--help"]);
      expect(help.status).toBe(0);
      expect(help.stdout).toContain("--platform <platform>");
    }
    for (const command of ["install", "update"]) {
      const help = runCli(process.cwd(), {}, [command, "--help"]);
      expect(help.status).toBe(0);
      expect(help.stdout).toContain("--force");
    }
  });

  it("fails unmet post-run version checks", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    const bin = await tempDir();
    writeVersionFailureDock(docks);
    writeExecutable(
      join(bin, "oma"),
      `#!/bin/sh
echo "oma 6.4.0"
`,
    );
    writeExecutable(
      join(bin, "bun"),
      `#!/bin/sh
echo "Resolving oh-my-agent"
echo "Downloading oh-my-agent"
`,
    );

    await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, async () => {
      await expect(
        install({
          dockRef: DockRef.parse("test/version-fail"),
          projectDir: project,
          runCommands: true,
          operation: "install",
          phase: "install",
          resolve: localResolver(docks),
        }),
      ).rejects.toThrow("6.4.0 does not satisfy >=9.0.0");
    });
  });

  it("rejects inline interpreter commands and scrubs lifecycle environments", async () => {
    const project = await tempDir();
    const bin = await tempDir();

    await expect(
      runCommand('node -e "console.log(process.env.PRIVATE_SECRET_TOKEN)"', project),
    ).rejects.toThrow("not allowed for OpenDock lifecycle");

    writeExecutable(
      join(bin, "oma"),
      `#!/bin/sh
echo "token=\${PRIVATE_SECRET_TOKEN:-missing}"
`,
    );

    await withEnv(
      {
        PRIVATE_SECRET_TOKEN: "secret-token",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      },
      async () => {
        const result = await runCommand("oma --version", project);
        expect(result.success).toBe(true);
        expect(result.stdout).toContain("token=missing");
      },
    );
  });

  it("rejects symlinked dock file sources and project targets", async () => {
    const outside = await tempDir();
    const sourceProject = await tempDir();
    const sourceDocks = await tempDir();
    const sourceDock = join(sourceDocks, "test", "source-symlink");
    mkdirSync(join(sourceDock, "files"), { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "outside secret\n");
    symlinkSync(join(outside, "secret.txt"), join(sourceDock, "files", "README.md"));
    writeFileSync(
      join(sourceDock, "dock.yml"),
      `opendock: 1
id: test/source-symlink
version: 1.0.0
files:
  - from: files/README.md
    to: README.md
    update: manual_review
`,
    );

    await expect(
      install({
        dockRef: DockRef.parse("test/source-symlink"),
        projectDir: sourceProject,
        runCommands: false,
        operation: "install",
        resolve: () => ({
          checksum: "local",
          manifest: dockManifestSchema.parse({
            files: [
              {
                from: "files/README.md",
                to: "README.md",
                update: "manual_review",
              },
            ],
            id: "test/source-symlink",
            opendock: 1,
            version: "1.0.0",
          }),
          root: sourceDock,
          signature: "local",
        }),
      }),
    ).rejects.toThrow("cannot be a symlink");

    const targetProject = await tempDir();
    const targetDocks = await tempDir();
    writeTestDock(targetDocks, "test", "target-symlink", "1.0.0", "# Safe README\n");
    symlinkSync(join(outside, "secret.txt"), join(targetProject, "README.md"));

    await expect(
      install({
        dockRef: DockRef.parse("test/target-symlink"),
        projectDir: targetProject,
        runCommands: false,
        operation: "install",
        resolve: localResolver(targetDocks),
      }),
    ).rejects.toThrow("target cannot be a symlink");
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("outside secret\n");
  });

  it("rejects symlinked project target parent directories", async () => {
    const outside = await tempDir();
    const project = await tempDir();
    const docks = await tempDir();
    const dockRoot = join(docks, "test", "target-parent-symlink");
    mkdirSync(join(dockRoot, "files"), { recursive: true });
    writeFileSync(join(dockRoot, "files", "safe.md"), "safe\n");
    writeFileSync(
      join(dockRoot, "dock.yml"),
      `opendock: 1
id: test/target-parent-symlink
version: 1.0.0
files:
  - from: files/safe.md
    to: project/safe.md
    update: managed_file
`,
    );
    symlinkSync(outside, join(project, "project"));

    await expect(
      install({
        dockRef: DockRef.parse("test/target-parent-symlink"),
        projectDir: project,
        runCommands: false,
        operation: "install",
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("target parent cannot be a symlink");
    expect(existsSync(join(outside, "safe.md"))).toBe(false);
  });

  it("does not delete through symlinked project target parent directories", async () => {
    const outside = await tempDir();
    const project = await tempDir();
    const docks = await tempDir();
    writeDirectoryManagedDock(docks, "1.0.0", {
      "safe.md": "safe\n",
    });
    const resolver = localResolver(docks);

    await install({
      dockRef: DockRef.parse("test/directory-managed"),
      projectDir: project,
      runCommands: false,
      operation: "install",
      resolve: resolver,
    });

    rmSync(join(project, "project"), { force: true, recursive: true });
    writeFileSync(join(outside, "safe.md"), "safe\n");
    symlinkSync(outside, join(project, "project"));
    const dockRoot = join(docks, "test", "directory-managed");
    rmSync(join(dockRoot, "files"), { force: true, recursive: true });
    writeFileSync(
      join(dockRoot, "dock.yml"),
      `opendock: 1
id: test/directory-managed
version: 1.1.0
files: []
`,
    );

    await expect(
      install({
        dockRef: DockRef.parse("test/directory-managed"),
        projectDir: project,
        runCommands: false,
        operation: "update",
        phase: "update",
        resolve: resolver,
      }),
    ).rejects.toThrow("target parent cannot be a symlink");
    expect(readFileSync(join(outside, "safe.md"), "utf8")).toBe("safe\n");
  });

  it("rejects symlinks inside directory file mappings", async () => {
    const outside = await tempDir();
    const project = await tempDir();
    const docks = await tempDir();
    writeFileSync(join(outside, "secret.txt"), "outside secret\n");
    writeDirectoryManagedDock(docks, "1.0.0", {
      "safe.md": "safe\n",
    });
    symlinkSync(
      join(outside, "secret.txt"),
      join(docks, "test", "directory-managed", "files", "project", "secret.md"),
    );

    await expect(
      install({
        dockRef: DockRef.parse("test/directory-managed"),
        projectDir: project,
        runCommands: false,
        operation: "install",
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("cannot be a symlink");
    expect(existsSync(join(project, "project", "safe.md"))).toBe(false);
  });

  it("supports user and scripted interactive lifecycle steps", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    const bin = await tempDir();
    writeInteractiveOma(bin);
    writeInteractiveDock(docks);
    const resolver = localResolver(docks);

    await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, async () => {
      await expect(
        install({
          dockRef: DockRef.parse("test/interactive-user"),
          projectDir: project,
          runCommands: true,
          operation: "install",
          phase: "install",
          resolve: resolver,
        }),
      ).rejects.toThrow("interactive step requires a TTY");

      const userScript = join(project, "run-user-interactive.ts");
      writeFileSync(
        userScript,
        `import { runCommand } from ${JSON.stringify(join(repoRoot, "src", "runner.ts"))};
const result = await runCommand("oma", process.cwd(), {
  interactive: "user",
  live: true,
  timeoutMs: 5000,
});
if (!result.success) {
  console.error(result.stderr);
  process.exit(1);
}
`,
      );
      const userInstall = runCliInPty(project, ["bun", userScript], {
        inputAfter: "USER_TTY",
        input: "u\r",
      });
      expect(userInstall.exitCode).toBe(0);
      expect(userInstall.output).toContain("USER_TTY");
      expect(readFileSync(join(project, "user-input.txt"), "utf8")).toMatch(/^75(?:0a|0d)$/);

      const scriptedInstall = await install({
        dockRef: DockRef.parse("test/interactive-scripted"),
        projectDir: project,
        runCommands: true,
        operation: "install",
        phase: "install",
        resolve: resolver,
      });
      expect(scriptedInstall.dockId).toBe("test/interactive-scripted");
      expect(readFileSync(join(project, "scripted-input.txt"), "utf8")).toBe("090a");
    });
  });

  it("times out hanging doctor checks", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    const bin = await tempDir();
    writeTimeoutOma(bin);
    writeTimeoutDoctorDock(docks);

    await install({
      dockRef: DockRef.parse("test/timeout"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: localResolver(docks),
    });

    const resolved = resolveLocalDock(docks, DockRef.parse("test/timeout"));
    const doctor = await withEnv(
      { _VOLTA_TOOL_RECURSION: "1", PATH: `${bin}:${process.env.PATH ?? ""}` },
      () => runLifecycle(resolved.manifest, "doctor", project),
    );
    expect(doctor.find((report) => report.id === "volta-env")?.status).toBe("Ready");
    expect(doctor.find((report) => report.id === "slow")?.message).toBe("timed out after 50ms");
  });

  it("allows documented AI CLI doctor commands", async () => {
    const project = await tempDir();
    const bin = await tempDir();
    for (const command of ["claude", "codex", "oma", "omx"]) {
      writeExecutable(
        join(bin, command),
        `#!/bin/sh
echo "${command} 1.2.3"
`,
      );
    }

    const manifest = dockManifestSchema.parse({
      opendock: 1,
      id: "test/ai-tools",
      lifecycle: {
        doctor: [
          { id: "claude", check: "claude --version", version: ">=1.0.0" },
          { id: "codex", check: "codex --version", version: ">=1.0.0" },
          { id: "oma", check: "oma doctor" },
          { id: "omx", check: "omx doctor" },
        ],
      },
    });

    const reports = await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      runLifecycle(manifest, "doctor", project),
    );
    expect(reports.map((report) => report.status)).toEqual(["Ready", "Ready", "Ready", "Ready"]);
  });

  it("rejects invalid dock references", () => {
    const result = runCli(process.cwd(), {}, ["install", "codex"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("owner/name");
  });

  it("rejects unsupported manifest fields", async () => {
    const docks = await tempDir();
    const dockRoot = join(docks, "test", "unsupported-field");
    mkdirSync(dockRoot, { recursive: true });
    writeFileSync(
      join(dockRoot, "dock.yml"),
      `opendock: 1
id: test/unsupported-field
version: 1.0.0
unsupported_field: true
`,
    );

    expect(() => resolveLocalDock(docks, DockRef.parse("test/unsupported-field"))).toThrow(
      "failed to parse",
    );
  });

  it("rejects manifests without opendock version", async () => {
    const docks = await tempDir();
    const dockRoot = join(docks, "test", "missing-opendock");
    mkdirSync(dockRoot, { recursive: true });
    writeFileSync(
      join(dockRoot, "dock.yml"),
      `id: test/missing-opendock
version: 1.0.0
lifecycle:
  install:
    - id: marker
      run: mkdir .unsupported-manifest
`,
    );

    expect(() => resolveLocalDock(docks, DockRef.parse("test/missing-opendock"))).toThrow(
      "must declare `opendock: 1`",
    );
  });

  it("parses dock version selectors", () => {
    expect(DockRef.parse("opendock/codex").requested()).toBe("latest");
    expect(DockRef.parse("opendock/codex@latest").requested()).toBe("latest");
    expect(DockRef.parse("opendock/codex@1").requested()).toBe("1");
    expect(DockRef.parse("opendock/codex@1.5").requested()).toBe("1.5");
    expect(DockRef.parse("opendock/codex@designer-build").requested()).toBe("designer-build");
    expect(DockRef.parse("opendock/codex@1.5.2").requested()).toBe("1.5.2");
    expect(DockRef.parse("opendock/codex@1.5.2").id()).toBe("opendock/codex");
    expect(DockRef.parse("opendock/codex@1.5.2").toString()).toBe("opendock/codex@1.5.2");
    expect(() => DockRef.parse("opendock/codex@")).toThrow("selector cannot be empty");
    expect(() => DockRef.parse("opendock/codex@1@2")).toThrow(
      "may contain only one version selector",
    );
    expect(() => DockRef.parse("opendock/codex@bad/version")).toThrow(
      "dock version selector must be latest",
    );
    expect(() => DockRef.parse("opendock/codex@bad*version")).toThrow(
      "dock version selector must be latest",
    );
  });

  it("matches resolved dock versions against latest or exact selectors", () => {
    const accepted: Array<[string, string]> = [
      ["1.5.2", "latest"],
      ["1.5.2", "1.5.2"],
      ["designer-build", "designer-build"],
    ];
    for (const [version, selector] of accepted) {
      expect(versionSatisfiesSelector(version, selector)).toBe(true);
    }

    const rejected: Array<[string, string]> = [
      ["1.5.2", "1.5"],
      ["1.5.3", "1.5.2"],
      ["designer-build", "designer"],
    ];
    for (const [version, selector] of rejected) {
      expect(versionSatisfiesSelector(version, selector)).toBe(false);
    }
  });

  it("stores auth tokens with private permissions", async () => {
    const home = await tempDir();
    const authPath = join(home, "Library", "Application Support", "OpenDock", "auth-token");
    const result = runCli(process.cwd(), { HOME: home }, [
      "auth",
      "login",
      "--token",
      "test-token",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Logged in to OpenDock Registry.");
    expect(readFileSync(authPath, "utf8")).toBe("test-token");
    if (process.platform !== "win32") {
      expect(statSync(authPath).mode & 0o777).toBe(0o600);
    }
  });

  it("handles mac bootstrap states without running the installer unexpectedly", async () => {
    const readyMessages: string[] = [];
    const ready = await bootstrapMac({
      commandAvailable: () => true,
      pathExists: () => false,
      platform: "darwin",
      runInstall: () => {
        throw new Error("should not install");
      },
      write: (message) => readyMessages.push(message),
    });
    expect(ready.status).toBe("ready");
    expect(readyMessages.join("\n")).toContain("already installed");

    const pathMessages: string[] = [];
    const pathMissing = await bootstrapMac({
      commandAvailable: () => false,
      pathExists: (path) => path === "/opt/homebrew/bin/brew",
      platform: "darwin",
      runInstall: () => {
        throw new Error("should not install");
      },
      write: (message) => pathMessages.push(message),
    });
    expect(pathMissing).toEqual({
      brewPath: "/opt/homebrew/bin/brew",
      status: "path-missing",
    });
    expect(pathMessages.join("\n")).toContain("not available on PATH");

    let skippedInstallRuns = 0;
    const skippedMessages: string[] = [];
    const skipped = await bootstrapMac({
      commandAvailable: () => false,
      confirm: async () => false,
      pathExists: () => false,
      platform: "darwin",
      runInstall: () => {
        skippedInstallRuns += 1;
        return 0;
      },
      write: (message) => skippedMessages.push(message),
    });
    expect(skipped.status).toBe("skipped");
    expect(skippedInstallRuns).toBe(0);
    expect(skippedMessages.join("\n")).toContain(HOMEBREW_INSTALL_COMMAND);

    let installRuns = 0;
    const installed = await bootstrapMac({
      assumeYes: true,
      commandAvailable: () => false,
      pathExists: () => false,
      platform: "darwin",
      runInstall: () => {
        installRuns += 1;
        return 0;
      },
      write: () => undefined,
    });
    expect(installed.status).toBe("installed");
    expect(installRuns).toBe(1);
  });

  it("exposes the mac bootstrap CLI command", () => {
    const help = runCli(process.cwd(), {}, ["bootstrap", "mac", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Install or verify Homebrew");

    const unsupported = runCli(process.cwd(), {}, ["bootstrap", "mac"]);
    if (process.platform !== "darwin") {
      expect(unsupported.status).not.toBe(0);
      expect(unsupported.stderr).toContain("only supported on macOS");
    }
  });

  it("validates deploy files before starting browser login", async () => {
    const project = await tempDir();
    const home = await tempDir();
    writeFileSync(join(project, "dock.yml"), "opendock: 1\nid: test/logo\nlogo: logo.svg\n");
    writeFileSync(join(project, "logo.svg"), "<svg />\n");

    const result = runCli(project, { HOME: home }, ["deploy", "test/logo"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "manifest `logo` path must point to a png, jpg, jpeg, or webp file",
    );
  });

  it("rejects deploy readme paths outside the dock directory", async () => {
    const project = await tempDir();
    const home = await tempDir();
    writeFileSync(
      join(project, "dock.yml"),
      "opendock: 1\nid: test/readme\nreadme: ../OUTSIDE.md\n",
    );
    writeFileSync(join(project, "..", "OUTSIDE.md"), "# Outside\n");
    const login = runCli(project, { HOME: home }, ["auth", "login", "--token", "test-token"]);
    expect(login.status).toBe(0);

    const result = runCli(project, { HOME: home }, ["deploy", "test/readme"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("manifest `readme` path must stay inside the dock directory");
  });

  it("rejects unsupported deploy logo extensions before submission", async () => {
    const project = await tempDir();
    const home = await tempDir();
    writeFileSync(join(project, "dock.yml"), "opendock: 1\nid: test/logo\nlogo: logo.svg\n");
    writeFileSync(join(project, "logo.svg"), "<svg />\n");
    const login = runCli(project, { HOME: home }, ["auth", "login", "--token", "test-token"]);
    expect(login.status).toBe(0);

    const result = runCli(project, { HOME: home }, ["deploy", "test/logo"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "manifest `logo` path must point to a png, jpg, jpeg, or webp file",
    );
  });

  it("rejects deploy logo bytes that do not match the extension", async () => {
    const project = await tempDir();
    const home = await tempDir();
    writeFileSync(join(project, "dock.yml"), "opendock: 1\nid: test/logo\nlogo: logo.png\n");
    writeFileSync(join(project, "logo.png"), "not really png\n");
    const login = runCli(project, { HOME: home }, ["auth", "login", "--token", "test-token"]);
    expect(login.status).toBe(0);

    const result = runCli(project, { HOME: home }, ["deploy", "test/logo"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("manifest `logo` bytes do not match file type");
  });

  it("reapplies newer dock versions", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeTestDock(docks, "test", "demo", "1.0.0", "# Version One\n");

    await install({
      dockRef: DockRef.parse("test/demo"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: localResolver(docks),
    });

    writeTestDock(docks, "test", "demo", "2.0.0", "# Version Two\n");

    const update = await install({
      dockRef: DockRef.parse("test/demo"),
      projectDir: project,
      runCommands: true,
      operation: "update",
      phase: "update",
      resolve: localResolver(docks),
    });
    expect(update.version).toBe("2.0.0");

    const readme = readFileSync(join(project, "README.md"), "utf8");
    expect(readme).toContain("# Version Two");
    expect(readme).not.toContain("# Version One");
    expect(readFileSync(join(project, ".opendock", "dock.lock.yml"), "utf8")).toContain(
      "version: 2.0.0",
    );
  });

  it("stores requested selectors in project state and lock files", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeTestDock(docks, "test", "demo", "1.5.2", "# Version\n");

    await install({
      dockRef: DockRef.parse("test/demo@1.5.2"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: localResolver(docks),
    });

    const projectState = readFileSync(join(project, ".opendock", "project.yml"), "utf8");
    expect(projectState).toMatch(/requested: "?1\.5\.2"?/);
    const lockState = readFileSync(join(project, ".opendock", "dock.lock.yml"), "utf8");
    expect(lockState).toMatch(/requested: "?1\.5\.2"?/);
    expect(lockState).toContain("version: 1.5.2");
    expect(lockDocks(readLock(project))[0]?.requested).toBe("1.5.2");
  });

  it("rejects resolved versions outside the requested selector", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeTestDock(docks, "test", "demo", "2.0.0", "# Version\n");

    await expect(
      install({
        dockRef: DockRef.parse("test/demo@1.5.2"),
        projectDir: project,
        runCommands: true,
        operation: "install",
        phase: "install",
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("resolved version 2.0.0 does not satisfy selector 1.5.2");
  });

  it("keeps exact requested selectors pinned during updates", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    writeTestDock(docks, "test", "pinned", "1.0.0", "# Version One\n");

    await install({
      dockRef: DockRef.parse("test/pinned@1.0.0"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: localResolver(docks),
    });

    const lockedDock = lockDocks(readLock(project))[0];
    if (lockedDock === undefined) {
      throw new Error("expected pinned dock in lock file");
    }
    expect(lockedDock.requested).toBe("1.0.0");

    writeTestDock(docks, "test", "pinned", "1.0.1", "# Version Two\n");

    await expect(
      install({
        dockRef: DockRef.parse(`${lockedDock.id}@${lockedDock.requested}`),
        projectDir: project,
        runCommands: true,
        operation: "update",
        phase: "update",
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("resolved version 1.0.1 does not satisfy selector 1.0.0");
    expect(readFileSync(join(project, "README.md"), "utf8")).toContain("# Version One");
    expect(lockDocks(readLock(project))[0]?.version).toBe("1.0.0");
  });

  it("writes failure logs for rejected lifecycle commands", async () => {
    const project = await tempDir();
    const docks = await tempDir();
    const dockRoot = join(docks, "test", "bad");
    mkdirSync(dockRoot, { recursive: true });
    writeFileSync(
      join(dockRoot, "dock.yml"),
      `opendock: 1
id: test/bad
name: Bad Dock
version: 1.0.0
lifecycle:
  install:
    - id: dangerous
      name: Dangerous command
      run: rm -rf anything
`,
    );

    await expect(
      install({
        dockRef: DockRef.parse("test/bad"),
        projectDir: project,
        runCommands: true,
        operation: "install",
        phase: "install",
        resolve: localResolver(docks),
      }),
    ).rejects.toThrow("not allowed");

    const logs = runCli(project, {}, ["log"]);
    expect(logs.status).toBe(0);
    expect(logs.stdout).toContain("Failure");
    expect(logs.stdout).toContain("not allowed");
  });
});

async function tempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "opendock-test-"));
  tempRoots.push(path);
  return path;
}

function localResolver(root: string): DockResolver {
  return (dockRef) => resolveLocalDock(root, dockRef);
}

async function createRemoteDockArchive(
  root: string,
  owner: string,
  name: string,
  version: string,
): Promise<Buffer> {
  const dockRoot = join(root, "remote-dock");
  mkdirSync(join(dockRoot, "files"), { recursive: true });
  writeFileSync(
    join(dockRoot, "dock.yml"),
    `opendock: 1
id: ${owner}/${name}
version: ${version}
files:
  - from: files/README.md
    to: README.md
    update: manual_review
`,
  );
  writeFileSync(join(dockRoot, "files", "README.md"), "# Remote Dock\n");
  const archivePath = join(root, "dock.tgz");
  await createTar({ cwd: dockRoot, file: archivePath, gzip: true }, ["."]);
  return readFileSync(archivePath);
}

async function createSymlinkDockArchive(
  root: string,
  owner: string,
  name: string,
  version: string,
): Promise<Buffer> {
  const dockRoot = join(root, "symlink-dock");
  mkdirSync(join(dockRoot, "files"), { recursive: true });
  writeFileSync(
    join(dockRoot, "dock.yml"),
    `opendock: 1
id: ${owner}/${name}
version: ${version}
files:
  - from: files/README.md
    to: README.md
    update: manual_review
`,
  );
  writeFileSync(join(dockRoot, "target.txt"), "# Symlink Target\n");
  symlinkSync("../target.txt", join(dockRoot, "files", "README.md"));
  const archivePath = join(root, "symlink-dock.tgz");
  await createTar({ cwd: dockRoot, file: archivePath, gzip: true }, ["."]);
  return readFileSync(archivePath);
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function withEnv<T>(env: NodeJS.ProcessEnv, callback: () => Promise<T> | T): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key]);
    const value = env[key];
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

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}

function runCli(cwd: string, env: NodeJS.ProcessEnv, args: string[]) {
  return spawnSync(process.execPath, [builtCli, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function runCliInPty(
  cwd: string,
  command: string[],
  options: { input: string; inputAfter: string },
): { exitCode: number; output: string } {
  const script = [
    "set timeout 10",
    `spawn ${command.map(tclWord).join(" ")}`,
    `expect ${tclWord(options.inputAfter)}`,
    `send -- [binary format H* ${Buffer.from(options.input, "utf8").toString("hex")}]`,
    "expect eof",
    "catch wait result",
    "if {[llength $result] >= 4} { exit [lindex $result 3] }",
    "exit 1",
  ].join("\n");
  const result = spawnSync("expect", ["-c", script], {
    cwd,
    encoding: "utf8",
    env: process.env,
    timeout: 12_000,
  });

  if (result.error) {
    throw result.error;
  }
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function tclWord(value: string): string {
  return `{${value.replace(/\\/g, "\\\\").replace(/}/g, "\\}")}}`;
}

function writeTestDock(
  root: string,
  owner: string,
  name: string,
  version: string,
  readme: string,
): void {
  const dockRoot = join(root, owner, name);
  mkdirSync(join(dockRoot, "files"), { recursive: true });
  writeFileSync(
    join(dockRoot, "dock.yml"),
    `opendock: 1
id: ${owner}/${name}
name: Demo Dock
version: ${version}
files:
  - from: files/README.md
    to: README.md
    update: managed_block
  - from: files/.gitignore
    to: .gitignore
    update: append_unique
  - from: files/AGENTS.md
    to: AGENTS.md
    update: managed_block
  - from: files/DESIGN.md
    to: DESIGN.md
    update: managed_block
`,
  );
  writeFileSync(join(dockRoot, "files", "README.md"), readme);
  writeFileSync(join(dockRoot, "files", ".gitignore"), "node_modules/\n.DS_Store\n");
  writeFileSync(join(dockRoot, "files", "AGENTS.md"), "# Agents\n");
  writeFileSync(join(dockRoot, "files", "DESIGN.md"), "# Design\n");
}

function writeDirectoryManagedDock(
  root: string,
  version: string,
  files: Record<string, string>,
  options: { updateMarker?: boolean } = {},
): void {
  const dockRoot = join(root, "test", "directory-managed");
  const sourceRoot = join(dockRoot, "files", "project");
  rmSync(dockRoot, { force: true, recursive: true });
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(
    join(dockRoot, "dock.yml"),
    `opendock: 1
id: test/directory-managed
name: Directory Managed Dock
version: ${version}
files:
  - from: files/project
    to: project
    update: managed_file
${options.updateMarker === true ? "lifecycle:\n  update:\n    - id: update-marker\n      run: mkdir .updated\n" : ""}
`,
  );
  for (const [path, content] of Object.entries(files)) {
    const target = join(sourceRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function writeModernDock(root: string): void {
  const dockRoot = join(root, "test", "modern");
  mkdirSync(join(dockRoot, "files"), { recursive: true });
  writeFileSync(
    join(dockRoot, "dock.yml"),
    `opendock: 1
id: test/modern
version: 1.0.0
files:
  - from: files/DESIGN.md
    to: DESIGN.md
    update: managed_block
  - from: files/README.md
    to: README.md
    update: manual_review
  - from: files/.gitignore
    to: .gitignore
    update: append_unique
lifecycle:
  install:
    - id: fixture
      check: test -d .opendock-fixture
      run: mkdir .opendock-fixture
  update:
    - id: update-fixture
      run: mkdir .opendock-updated
  doctor:
    - id: node
      version: ">=0.0.0"
      check: node --version
    - id: fixture
      check: test -d .opendock-fixture
`,
  );
  writeFileSync(join(dockRoot, "files", "README.md"), "# Starter README\n");
  writeFileSync(join(dockRoot, "files", ".gitignore"), "node_modules/\n.DS_Store\n");
  writeFileSync(join(dockRoot, "files", "DESIGN.md"), "# Design\n");
}

function writeVersionFailureDock(root: string): void {
  const dockRoot = join(root, "test", "version-fail");
  mkdirSync(dockRoot, { recursive: true });
  writeFileSync(
    join(dockRoot, "dock.yml"),
    `opendock: 1
id: test/version-fail
version: 1.0.0
lifecycle:
  install:
    - id: install-oma-cli
      check: oma --version
      version: ">=9.0.0"
      run: bun install --global oh-my-agent@latest
`,
  );
}

function writePlatformDock(root: string): void {
  const dockRoot = join(root, "test", "platforms");
  mkdirSync(dockRoot, { recursive: true });
  writeFileSync(
    join(dockRoot, "dock.yml"),
    `opendock: 1
id: test/platforms
version: 1.0.0
lifecycle:
  install:
    - id: common-start
      run: mkdir .common-start

    - id: install-tool
      platforms:
        macos:
          check: test -d .mac-tool
          run: mkdir .mac-tool
        windows:
          check: test -d .windows-tool
          run: mkdir .windows-tool

    - id: common-end
      run: mkdir .common-end

  doctor:
    - id: tool
      platforms:
        macos:
          check: test -d .mac-tool
        windows:
          check: test -d .windows-tool
`,
  );
}

function writeTimeoutDoctorDock(root: string): void {
  const dockRoot = join(root, "test", "timeout");
  mkdirSync(dockRoot, { recursive: true });
  writeFileSync(
    join(dockRoot, "dock.yml"),
    `opendock: 1
id: test/timeout
version: 1.0.0
lifecycle:
  doctor:
    - id: volta-env
      check: oma doctor
    - id: slow
      check: oma update
      timeout_ms: 50
`,
  );
}

function writeInteractiveDock(root: string): void {
  writeInteractiveDockVariant(root, "interactive-user", "user", "");
  writeInteractiveDockVariant(
    root,
    "interactive-scripted",
    `interactive:
        mode: scripted
        inputs:
          - key: tab
          - key: enter`,
    "",
  );
}

function writeInteractiveDockVariant(
  root: string,
  name: string,
  interactive: string,
  extraRun: string,
): void {
  const dockRoot = join(root, "test", name);
  mkdirSync(join(dockRoot, "files"), { recursive: true });
  const scriptName =
    name === "interactive-user" ? "user-interactive.js" : "scripted-interactive.js";
  const outputName = name === "interactive-user" ? "user-input.txt" : "scripted-input.txt";
  const label = name === "interactive-user" ? "USER_TTY" : "SCRIPTED_TTY";
  const interactiveYaml = interactive.includes("\n") ? interactive : `interactive: ${interactive}`;
  writeFileSync(
    join(dockRoot, "dock.yml"),
    `opendock: 1
id: test/${name}
version: 1.0.0
files:
  - from: files/${scriptName}
    to: ${scriptName}
    update: manual_review
lifecycle:
  install:
    - id: interactive
      run: oma
      ${interactiveYaml}
      timeout_ms: 5000
${extraRun}`,
  );
  writeFileSync(
    join(dockRoot, "files", scriptName),
    `const fs = require("node:fs");
console.log(process.stdin.isTTY ? "${label}" : "NO_TTY");
process.stdin.setRawMode(true);
process.stdin.resume();
const bytes = [];
process.stdin.on("data", function(data) {
  for (const byte of data) bytes.push(byte);
  if (bytes.length >= 2) {
    fs.writeFileSync("${outputName}", Buffer.from(bytes.slice(0, 2)).toString("hex"));
    process.exit(0);
  }
});
`,
  );
}

function writeInteractiveOma(bin: string): void {
  writeExecutable(
    join(bin, "oma"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const scripted = fs.existsSync("user-input.txt");
const label = scripted ? "SCRIPTED_TTY" : "USER_TTY";
const outputName = scripted ? "scripted-input.txt" : "user-input.txt";
console.log(process.stdin.isTTY ? label : "NO_TTY");
process.stdin.setRawMode(true);
process.stdin.resume();
const bytes = [];
process.stdin.on("data", function(data) {
  for (const byte of data) bytes.push(byte);
  if (bytes.length >= 2) {
    fs.writeFileSync(outputName, Buffer.from(bytes.slice(0, 2)).toString("hex"));
    process.exit(0);
  }
});
`,
  );
}

function writeTimeoutOma(bin: string): void {
  writeExecutable(
    join(bin, "oma"),
    `#!/bin/sh
if [ -n "$_VOLTA_TOOL_RECURSION" ]; then
  exit 7
fi
if [ "$1" = "update" ]; then
  sleep 1
else
  echo "oma 9.0.0"
fi
`,
  );
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function writeFakeToolchain(bin: string): void {
  writeExecutable(
    join(bin, "brew"),
    `#!/bin/sh
echo "brew $*"
`,
  );
  writeExecutable(
    join(bin, "bun"),
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "1.3.11"
else
  echo "bun $*"
fi
`,
  );
  writeExecutable(
    join(bin, "bunx"),
    `#!/bin/sh
echo "bunx 1.2.3"
`,
  );
  writeExecutable(
    join(bin, "claude"),
    `#!/bin/sh
echo "claude 1.2.3"
`,
  );
  writeExecutable(
    join(bin, "codex"),
    `#!/bin/sh
echo "codex 1.2.3"
`,
  );
  writeExecutable(
    join(bin, "git"),
    `#!/bin/sh
case "$1" in
  --version)
    echo "git version 2.40.0"
    ;;
  status)
    if [ -d .git ]; then
      echo "on branch main"
      exit 0
    fi
    echo "not a git repository" >&2
    exit 1
    ;;
  init)
    mkdir -p .git
    echo "initialized git repository"
    ;;
  *)
    echo "git $*"
    ;;
esac
`,
  );
  writeExecutable(
    join(bin, "node"),
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "v22.18.0"
else
  echo "node $*"
fi
`,
  );
  writeExecutable(
    join(bin, "npm"),
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "10.9.0"
else
  echo "npm $*"
fi
`,
  );
  writeExecutable(
    join(bin, "npx"),
    `#!/bin/sh
echo "npx $*"
`,
  );
  writeExecutable(
    join(bin, "omx"),
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "0.18.10"
else
  echo "omx $*"
fi
`,
  );
  writeExecutable(
    join(bin, "winget"),
    `#!/bin/sh
echo "winget $*"
`,
  );
}
