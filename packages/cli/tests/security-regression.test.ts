import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
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
import { DockInstaller } from "../src/core/app/dock-installer.js";
import { ProjectOperationLock } from "../src/core/app/project-operation-lock.js";
import { type DockManifest, DockRef } from "../src/core/domain/manifest.js";
import { OpenDockStateStore } from "../src/core/domain/state-store.js";
import type { FileCandidate } from "../src/core/files/file-candidate.js";
import { FilePlan } from "../src/core/files/file-plan.js";
import { safeDockDirectoryName } from "../src/core/files/path-utils.js";
import { CommandRunner } from "../src/core/runtime/command-runner.js";
import { projectCommandPathEntries } from "../src/core/runtime/project-layout.js";
import { validateManifestTaskCommands } from "../src/core/runtime/task-command-validation.js";
import { TaskRunner } from "../src/core/runtime/task-runner.js";
import { ToolRunner } from "../src/core/runtime/tool-runner.js";
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
      "npx create-react-app",
      "npx .",
      "bunx create-vite",
      "bunx .",
    ]) {
      expect(() => runner.run(command, { cwd: project, platform: "macos" })).toThrow("not allowed");
    }
  });

  it("does not let project shims shadow OpenDock default commands", () => {
    const project = tempDir();
    const marker = join(project, "shadowed");
    const projectBin = join(project, ".opendock", "bin");
    mkdirSync(projectBin, { recursive: true });
    const fakeGit = join(projectBin, "git");
    writeFileSync(fakeGit, `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);
    chmodSync(fakeGit, 0o755);

    const result = new CommandRunner().run("git --version", {
      cwd: project,
      pathEntries: projectCommandPathEntries(project),
      platform: "macos",
    });

    expect(result.success).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it("allows non-default commands only when the exact permission and tool program are declared", () => {
    const project = tempDir();
    const bin = tempDir();
    const runner = new CommandRunner();
    const customTool = join(bin, "custom-tool");
    writeFileSync(customTool, "#!/bin/sh\nmkdir -p generated\n");
    chmodSync(customTool, 0o755);

    expect(() =>
      runner.run("custom-tool generate", {
        cwd: project,
        pathEntries: [bin],
        permissions: ["custom-tool generate"],
        platform: "macos",
      }),
    ).toThrow("not declared in tools.commands");

    const result = runner.run("custom-tool generate", {
      cwd: project,
      pathEntries: [bin],
      permissionPrograms: ["custom-tool"],
      permissions: ["custom-tool generate"],
      platform: "macos",
    });

    expect(result.success).toBe(true);
    expect(existsSync(join(project, "generated"))).toBe(true);
    expect(() =>
      runner.run("custom-tool other", {
        cwd: project,
        pathEntries: [bin],
        permissionPrograms: ["custom-tool"],
        permissions: ["custom-tool generate"],
        platform: "macos",
      }),
    ).toThrow("not allowed");
  });

  it("blocks global or system installs even when exact permissions are declared", () => {
    const project = tempDir();
    const runner = new CommandRunner();

    for (const [command, platform] of [
      ["npm install --global @openai/codex", "macos"],
      ["npm install oh-my-codex", "macos"],
      ["bun install -g oh-my-agent", "macos"],
      ["bun add oh-my-agent", "macos"],
      ["pnpm add -g @anthropic-ai/claude-code", "macos"],
      ["pnpm update @anthropic-ai/claude-code", "macos"],
      ["pip install some-tool", "macos"],
      ["pipx install some-tool", "macos"],
      ["uv tool install some-tool", "macos"],
      ["brew install node", "macos"],
      [
        "winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements",
        "windows",
      ],
    ] as const) {
      expect(() =>
        runner.run(command, {
          cwd: project,
          permissions: [command],
          platform,
        }),
      ).toThrow(/not allowed|install/);
    }
  });

  it("blocks global installs during manifest task validation for deploy", () => {
    const manifest: DockManifest = {
      opendock: 1,
      id: "test/global-install",
      summary: "",
      tags: [],
      permission: ["npm install --global @openai/codex"],
      requires: { runtimes: {} },
      files: [],
      tasks: {
        install: [
          {
            id: "install-codex",
            platforms: {},
            run: "npm install --global @openai/codex",
          },
        ],
        update: [],
        doctor: [],
      },
    };

    expect(() => validateManifestTaskCommands(manifest, "macos")).toThrow(
      "package installs and updates are not allowed",
    );
  });

  it("requires custom permission commands to be declared by tools", () => {
    const manifest: DockManifest = {
      opendock: 1,
      id: "test/undeclared-tool",
      summary: "",
      tags: [],
      permission: ["oma -y install"],
      requires: { runtimes: {} },
      files: [],
      tasks: {
        install: [{ id: "apply-oma", run: "oma -y install", platforms: {} }],
        update: [],
        doctor: [],
      },
    };

    expect(() => validateManifestTaskCommands(manifest, "macos")).toThrow(
      "is not declared in tools.commands",
    );
  });

  it("allows exact permission commands for declared tools", () => {
    const manifest: DockManifest = {
      opendock: 1,
      id: "test/declared-tool",
      summary: "",
      tags: [],
      permission: ["oma -y install"],
      requires: { runtimes: {} },
      tools: {
        oma: {
          manager: "bun",
          package: "oh-my-agent",
          version: "8.52.9",
          commands: ["oma"],
        },
      },
      files: [],
      tasks: {
        install: [{ id: "apply-oma", run: "oma -y install", platforms: {} }],
        update: [],
        doctor: [],
      },
    };

    expect(() => validateManifestTaskCommands(manifest, "macos")).not.toThrow();
  });

  it("rejects shell operators in doctor checks even when permissions are declared", () => {
    const project = tempDir();
    const manifest: DockManifest = {
      opendock: 1,
      id: "test/doctor-shell",
      summary: "",
      tags: [],
      permission: ["git status"],
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

  it("rejects hardlinked managed targets and state files", () => {
    const project = tempDir();
    const outside = tempDir();
    const victim = join(outside, "victim.txt");
    writeFileSync(victim, "preserve\n");
    linkSync(victim, join(project, "CONFIG.md"));
    const candidate: FileCandidate = {
      content: Buffer.from("managed\n"),
      executable: false,
      mode: "managed_file",
      path: "CONFIG.md",
      source: "files",
    };

    expect(() => new FilePlan(project, "test/hardlink", [], true).preflight([candidate])).toThrow(
      "target cannot be a hardlink",
    );
    expect(readFileSync(victim, "utf8")).toBe("preserve\n");

    mkdirSync(join(project, ".opendock"));
    const outsideLock = join(outside, "dock.lock.yml");
    writeFileSync(outsideLock, "schema: opendock.lock/v1\ndocks: []\n");
    linkSync(outsideLock, join(project, ".opendock", "dock.lock.yml"));
    writeFileSync(
      join(project, ".opendock", "project.yml"),
      "schema: opendock.project/v1\ndocks: []\n",
    );
    expect(() => new OpenDockStateStore(project).readLock()).toThrow(
      "OpenDock state file cannot be a hardlink",
    );
  });

  it("rejects incomplete, unsupported, malformed and divergent state pairs", () => {
    const project = tempDir();
    mkdirSync(join(project, ".opendock"));
    writeFileSync(
      join(project, ".opendock", "project.yml"),
      "schema: opendock.project/v1\ndocks: []\n",
    );
    expect(() => new OpenDockStateStore(project).readLock()).toThrow(
      "OpenDock state is incomplete",
    );

    writeFileSync(
      join(project, ".opendock", "dock.lock.yml"),
      "schema: opendock.lock/v999\ndocks: []\n",
    );
    expect(() => new OpenDockStateStore(project).readLock()).toThrow(
      "unsupported OpenDock lock schema",
    );

    writeFileSync(
      join(project, ".opendock", "dock.lock.yml"),
      "schema: opendock.lock/v1\ndocks: {}\n",
    );
    expect(() => new OpenDockStateStore(project).readLock()).toThrow(
      "OpenDock lock docks must be an array",
    );

    writeFileSync(
      join(project, ".opendock", "dock.lock.yml"),
      "schema: opendock.lock/v1\ndocks: []\n",
    );
    writeFileSync(
      join(project, ".opendock", "project.yml"),
      [
        "schema: opendock.project/v1",
        "docks:",
        "  - id: test/divergent",
        "    name: divergent",
        "    requested: 1.0.0",
        "    version: 1.0.0",
        "    platform: macos",
        "    workdir: .opendock/workdirs/test__divergent",
        "",
      ].join("\n"),
    );
    expect(() => new OpenDockStateStore(project).readLock()).toThrow(
      "project.yml and dock.lock.yml describe different installed docks",
    );
  });

  it("serializes project operations and releases the lock", () => {
    const project = tempDir();
    const first = ProjectOperationLock.acquire(project, "install");
    expect(() => ProjectOperationLock.acquire(project, "update")).toThrow(
      "another OpenDock operation is in progress",
    );
    first.release();
    const second = ProjectOperationLock.acquire(project, "uninstall");
    second.release();
    expect(existsSync(join(project, ".opendock", "operation.lock"))).toBe(false);

    const staleLock = join(project, ".opendock", "operation.lock");
    mkdirSync(staleLock, { recursive: true });
    writeFileSync(
      join(staleLock, "owner.json"),
      `${JSON.stringify({
        nonce: "stale-operation",
        operation: "update",
        pid: 99_999_999,
        startedAt: "2026-08-14T00:00:00.000Z",
      })}\n`,
    );
    expect(() => new OpenDockStateStore(project).readLock()).toThrow(
      "previous OpenDock operation was interrupted",
    );
    expect(() => ProjectOperationLock.acquire(project, "install")).toThrow(
      "rerun the intended install, update, or uninstall with --force",
    );
    const recovery = ProjectOperationLock.acquire(project, "install", true);
    recovery.release();
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

  it("rejects managed block payloads that contain OpenDock block markers", () => {
    const project = tempDir();
    const candidate: FileCandidate = {
      content: Buffer.from("safe\n<!-- OPENDOCK:END injected -->\n"),
      executable: false,
      markerId: "files:AGENTS.md",
      mode: "managed_block",
      path: "AGENTS.md",
      source: "files",
    };

    expect(() => new FilePlan(project, "test/marker", [], false).preflight([candidate])).toThrow(
      "managed block content cannot contain OpenDock markers",
    );
  });

  it("fails closed when a declared tool package does not install the declared command", () => {
    const project = tempDir();
    const fakeBin = tempDir();
    const fakeBun = join(fakeBin, "bun");
    writeFileSync(fakeBun, "#!/bin/sh\nexit 0\n");
    chmodSync(fakeBun, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${originalPath ?? ""}`;
    try {
      const manifest: DockManifest = {
        opendock: 1,
        id: "test/missing-tool-command",
        summary: "",
        tags: [],
        permission: [],
        requires: { runtimes: {} },
        tools: {
          missing: {
            manager: "bun",
            package: "missing-tool-command",
            version: "1.0.0",
            commands: ["missing-tool-command"],
          },
        },
        files: [],
        tasks: { install: [], update: [], doctor: [] },
      };

      expect(() =>
        new ToolRunner().run(manifest, {
          dockId: manifest.id,
          live: false,
          phase: "install",
          platform: "macos",
          projectDir: project,
        }),
      ).toThrow("did not provide command `missing-tool-command`");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("does not trust lockfile paths when uninstalling tools", () => {
    const project = tempDir();
    const victim = join(project, "victim");
    mkdirSync(victim);
    writeFileSync(join(victim, "keep.txt"), "keep\n");
    mkdirSync(join(project, ".opendock"), { recursive: true });
    writeFileSync(
      join(project, ".opendock", "dock.lock.yml"),
      [
        "schema: opendock.lock/v1",
        "docks:",
        "  - id: test/bad-lock",
        "    name: bad-lock",
        "    requested: 1.0.0",
        "    version: 1.0.0",
        "    checksum: checksum",
        "    signature: signature",
        "    platform: macos",
        "    workdir: .opendock/workdirs/test__bad-lock",
        "    runtimes: []",
        "    files: []",
        "    tools:",
        "      - name: bad",
        "        manager: npm",
        "        package: bad",
        "        version: 1.0.0",
        "        commands:",
        "          - bad",
        "        path: ../victim",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(project, ".opendock", "project.yml"),
      [
        "schema: opendock.project/v1",
        "docks:",
        "  - id: test/bad-lock",
        "    name: bad-lock",
        "    requested: 1.0.0",
        "    version: 1.0.0",
        "    platform: macos",
        "    workdir: .opendock/workdirs/test__bad-lock",
        "",
      ].join("\n"),
    );

    expect(() =>
      new DockInstaller().uninstall({ dockId: "test/bad-lock", projectDir: project }),
    ).toThrow("unsafe installed tool path");
    expect(readFileSync(join(victim, "keep.txt"), "utf8")).toBe("keep\n");
  });

  it("quotes runtime shim targets restored from lockfile paths", () => {
    const project = tempDir();
    const marker = join(tempDir(), "pwned");
    mkdirSync(join(project, ".opendock"), { recursive: true });
    writeFileSync(
      join(project, ".opendock", "dock.lock.yml"),
      [
        "schema: opendock.lock/v1",
        "docks:",
        "  - id: test/first",
        "    name: first",
        "    requested: 1.0.0",
        "    version: 1.0.0",
        "    checksum: checksum",
        "    signature: signature",
        "    platform: macos",
        "    workdir: .opendock/workdirs/test__first",
        "    files: []",
        "    tools: []",
        "    runtimes:",
        "      - name: node",
        "        requested: '>=22.0.0'",
        "        source: managed",
        "        version: 22.0.0",
        `        path: .opendock/runtimes/$(touch ${marker})/bin`,
        "        commands:",
        "          - node",
        "  - id: test/second",
        "    name: second",
        "    requested: 1.0.0",
        "    version: 1.0.0",
        "    checksum: checksum",
        "    signature: signature",
        "    platform: macos",
        "    workdir: .opendock/workdirs/test__second",
        "    files: []",
        "    tools: []",
        "    runtimes:",
        "      - name: node",
        "        requested: '>=24.0.0'",
        "        source: managed",
        "        version: 24.0.0",
        "        path: .opendock/runtimes/node24/bin",
        "        commands:",
        "          - node",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(project, ".opendock", "project.yml"),
      [
        "schema: opendock.project/v1",
        "docks:",
        "  - id: test/first",
        "    name: first",
        "    requested: 1.0.0",
        "    version: 1.0.0",
        "    platform: macos",
        "    workdir: .opendock/workdirs/test__first",
        "  - id: test/second",
        "    name: second",
        "    requested: 1.0.0",
        "    version: 1.0.0",
        "    platform: macos",
        "    workdir: .opendock/workdirs/test__second",
        "",
      ].join("\n"),
    );

    new DockInstaller().uninstall({ dockId: "test/second", projectDir: project });
    const shim = join(project, ".opendock", "bin", "node");
    expect(readFileSync(shim, "utf8")).toContain("exec '");

    spawnSync(shim, [], { cwd: project });

    expect(existsSync(marker)).toBe(false);
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
    const url =
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&redirect_uri=https%3A%2F%2Fregistry.opendock.app%2Fv1%2Fauth%2Fgoogle%2Fcallback&scope=openid%20email%20profile&response_type=code";

    expect(browserOpenCommand(url, "win32")).toEqual({
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
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
  writeFileSync(join(root, "dock.yml"), "opendock: 1\nfiles: []\n");
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
