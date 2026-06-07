import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapMac, HOMEBREW_INSTALL_COMMAND } from "../src/bootstrap.js";
import { DockHubClient } from "../src/dockhub.js";
import { install, type PackResolver } from "../src/installer.js";
import { PackRef, packManifestSchema } from "../src/pack.js";
import { resolveLocalPack, resolvePack } from "../src/resolver.js";
import { runLifecycle } from "../src/runner.js";

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
    const packs = await tempDir();
    writeTestPack(packs, "test", "harness", "1.0.0", "# Starter README\n");
    writeFileSync(join(project, "README.md"), "# User README\n");
    writeFileSync(join(project, ".gitignore"), "node_modules/\n");

    const resolver = localResolver(packs);
    const first = await install({
      packRef: PackRef.parse("test/harness"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: resolver,
    });
    expect(first.packId).toBe("test/harness");
    expect(first.version).toBe("1.0.0");

    const second = await install({
      packRef: PackRef.parse("test/harness"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: resolver,
    });
    expect(second.packId).toBe("test/harness");

    const readme = readFileSync(join(project, "README.md"), "utf8");
    expect(readme).toContain("# User README");
    expect(readme.match(/OPENDOCK:START test\/harness:README\.md/g)).toHaveLength(1);

    const gitignore = readFileSync(join(project, ".gitignore"), "utf8");
    expect(gitignore.match(/node_modules\//g)).toHaveLength(1);
    expect(gitignore).toContain(".DS_Store");

    expect(existsSync(join(project, ".opendock", "project.yml"))).toBe(true);
    expect(existsSync(join(project, ".opendock", "dock.lock.yml"))).toBe(true);
    expect(existsSync(join(project, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(project, "DESIGN.md"))).toBe(true);
  });

  it("reports log output and fixed registry version", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    const data = await tempDir();
    writeTestPack(packs, "test", "harness", "1.0.0", "# Starter README\n");
    await withEnv({ OPENDOCK_DATA_DIR: data }, async () => {
      await install({
        packRef: PackRef.parse("test/harness"),
        projectDir: project,
        runCommands: true,
        operation: "install",
        phase: "install",
        resolve: localResolver(packs),
      });
    });

    const logs = runCli(project, { OPENDOCK_DATA_DIR: data }, ["log"]);
    expect(logs.status).toBe(0);
    expect(logs.stdout).toContain("install test/harness");

    const version = runCli(project, {}, ["version"]);
    expect(version.status).toBe(0);
    expect(version.stdout).toContain("registry https://opencode.app");
  });

  it("ignores pack source and registry environment overrides", async () => {
    const packs = await tempDir();
    writeTestPack(packs, "test", "harness", "9.9.9", "# Malicious Local Pack\n");
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return new Response("{}", { status: 503, statusText: "Unavailable" });
    }) as typeof fetch;

    try {
      await withEnv(
        {
          OPENDOCK_PACKS_DIR: packs,
          OPENDOCK_REGISTRY_URL: "http://127.0.0.1:9",
        },
        async () => {
          await expect(resolvePack(PackRef.parse("test/harness"))).rejects.toThrow(
            "https://opencode.app/api/v1/packs/test/harness/versions/latest",
          );
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(urls).toEqual(["https://opencode.app/api/v1/packs/test/harness/versions/latest"]);
  });

  it("submits packs only to the fixed OpenCode registry", async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ id: "submission-1", status: "pending" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    try {
      await withEnv({ OPENDOCK_REGISTRY_URL: "http://127.0.0.1:9" }, async () => {
        const response = await new DockHubClient().submitPack(
          { pack_name: "oma-codex", manifest: "opendock: 1" },
          "token",
        );
        expect(response.status).toBe("pending");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(urls).toEqual(["https://opencode.app/api/v1/packs/submissions"]);
  });

  it("supports opendock v1 files lifecycle and doctor checks", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    writeModernPack(packs);
    writeFileSync(join(project, "README.md"), "# User README\n");
    writeFileSync(join(project, "DESIGN.md"), "# User Design\n");
    writeFileSync(join(project, ".gitignore"), "node_modules/\n");
    const resolver = localResolver(packs);

    const installReport = await install({
      packRef: PackRef.parse("test/modern"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: resolver,
    });
    expect(installReport.packId).toBe("test/modern");
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
      packRef: PackRef.parse("test/modern"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: resolver,
    });
    expect(reinstall.packId).toBe("test/modern");
    const reinstalledDesign = readFileSync(join(project, "DESIGN.md"), "utf8");
    expect(reinstalledDesign).toContain("# User Design");
    expect(reinstalledDesign.match(/OPENDOCK:START test\/modern:DESIGN\.md/g)).toHaveLength(1);

    const resolved = await resolver(PackRef.parse("test/modern"));
    const doctor = await runLifecycle(resolved.manifest, "doctor", project);
    expect(doctor.find((report) => report.id === "node")?.status).toBe("Ready");
    expect(doctor.find((report) => report.id === "fixture")?.status).toBe("Ready");

    await install({
      packRef: PackRef.parse("test/modern"),
      projectDir: project,
      runCommands: true,
      operation: "update",
      phase: "update",
      resolve: resolver,
    });
    expect(existsSync(join(project, ".opendock-updated"))).toBe(true);
  });

  it("keeps bundled example manifests valid", () => {
    const refs = [
      "opendock/oma-codex",
      "opendock/git",
      "opendock/codex",
      "opendock/claude-code",
      "opendock/oh-my-codex",
      "opendock/oh-my-openagent",
    ];
    for (const ref of refs) {
      const resolved = resolveLocalPack(join(repoRoot, "examples"), PackRef.parse(ref));
      expect(resolved.manifest.id).toBe(ref);
    }
  });

  it("runs bundled install/update/doctor examples with a fake toolchain", async () => {
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

    await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, async () => {
      for (const ref of refs) {
        const project = await tempDir();
        const packRef = PackRef.parse(ref);
        const resolver = localResolver(examplesRoot);

        const installReport = await install({
          packRef,
          projectDir: project,
          runCommands: true,
          operation: "install",
          phase: "install",
          resolve: resolver,
        });
        expect(installReport.packId).toBe(ref);

        const updateReport = await install({
          packRef,
          projectDir: project,
          runCommands: true,
          operation: "update",
          phase: "update",
          resolve: resolver,
        });
        expect(updateReport.packId).toBe(ref);

        const resolved = resolveLocalPack(examplesRoot, packRef);
        const doctor = await runLifecycle(resolved.manifest, "doctor", project);
        expect(doctor.map((report) => report.status)).toEqual(doctor.map(() => "Ready" as const));
      }
    });
  });

  it("fails unmet post-run version checks", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    const bin = await tempDir();
    writeVersionFailurePack(packs);
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
          packRef: PackRef.parse("test/version-fail"),
          projectDir: project,
          runCommands: true,
          operation: "install",
          phase: "install",
          resolve: localResolver(packs),
        }),
      ).rejects.toThrow("6.4.0 does not satisfy >=9.0.0");
    });
  });

  it("supports user and scripted interactive lifecycle steps", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    writeInteractivePack(packs);
    const resolver = localResolver(packs);

    await expect(
      install({
        packRef: PackRef.parse("test/interactive-user"),
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
const result = await runCommand("node user-interactive.js", process.cwd(), {
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
      packRef: PackRef.parse("test/interactive-scripted"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: resolver,
    });
    expect(scriptedInstall.packId).toBe("test/interactive-scripted");
    expect(readFileSync(join(project, "scripted-input.txt"), "utf8")).toBe("090a");
  });

  it("times out hanging doctor checks", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    writeTimeoutDoctorPack(packs);

    await install({
      packRef: PackRef.parse("test/timeout"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: localResolver(packs),
    });

    const resolved = resolveLocalPack(packs, PackRef.parse("test/timeout"));
    const doctor = await withEnv({ _VOLTA_TOOL_RECURSION: "1" }, () =>
      runLifecycle(resolved.manifest, "doctor", project),
    );
    expect(doctor.find((report) => report.id === "volta-env")?.status).toBe("Ready");
    expect(doctor.find((report) => report.id === "slow")?.message).toBe("timed out after 50ms");
  });

  it("allows documented AI CLI doctor commands", async () => {
    const project = await tempDir();
    const bin = await tempDir();
    for (const command of ["bunx", "claude", "codex", "omo", "omx"]) {
      writeExecutable(
        join(bin, command),
        `#!/bin/sh
echo "${command} 1.2.3"
`,
      );
    }

    const manifest = packManifestSchema.parse({
      opendock: 1,
      id: "test/ai-tools",
      lifecycle: {
        doctor: [
          { id: "claude", check: "claude --version", version: ">=1.0.0" },
          { id: "codex", check: "codex --version", version: ">=1.0.0" },
          { id: "bunx", check: "bunx oh-my-openagent doctor" },
          { id: "omo", check: "omo version", version: ">=1.0.0" },
          { id: "omx", check: "omx doctor" },
        ],
      },
    });

    const reports = await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      runLifecycle(manifest, "doctor", project),
    );
    expect(reports.map((report) => report.status)).toEqual([
      "Ready",
      "Ready",
      "Ready",
      "Ready",
      "Ready",
    ]);
  });

  it("rejects invalid pack references", () => {
    const result = runCli(process.cwd(), {}, ["install", "oma-codex"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("owner/name");
  });

  it("stores auth tokens with private permissions", async () => {
    const data = await tempDir();
    const result = runCli(process.cwd(), { OPENDOCK_DATA_DIR: data }, [
      "auth",
      "login",
      "--token",
      "test-token",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Logged in to DockHub.");
    expect(readFileSync(join(data, "auth-token"), "utf8")).toBe("test-token");
    if (process.platform !== "win32") {
      expect(statSync(join(data, "auth-token")).mode & 0o777).toBe(0o600);
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

  it("requires login before deploy", async () => {
    const project = await tempDir();
    const data = await tempDir();
    const result = runCli(project, { OPENDOCK_DATA_DIR: data }, ["deploy", "oma-codex"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not logged in");
  });

  it("reapplies newer pack versions", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    writeTestPack(packs, "test", "demo", "1.0.0", "# Version One\n");

    await install({
      packRef: PackRef.parse("test/demo"),
      projectDir: project,
      runCommands: true,
      operation: "install",
      phase: "install",
      resolve: localResolver(packs),
    });

    writeTestPack(packs, "test", "demo", "2.0.0", "# Version Two\n");

    const update = await install({
      packRef: PackRef.parse("test/demo"),
      projectDir: project,
      runCommands: true,
      operation: "update",
      phase: "update",
      resolve: localResolver(packs),
    });
    expect(update.version).toBe("2.0.0");

    const readme = readFileSync(join(project, "README.md"), "utf8");
    expect(readme).toContain("# Version Two");
    expect(readme).not.toContain("# Version One");
    expect(readFileSync(join(project, ".opendock", "dock.lock.yml"), "utf8")).toContain(
      "version: 2.0.0",
    );
  });

  it("writes failure logs for rejected setup commands", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    const data = await tempDir();
    const packRoot = join(packs, "test", "bad");
    mkdirSync(packRoot, { recursive: true });
    writeFileSync(
      join(packRoot, "dock.yml"),
      `schema: opendock/v1
kind: starterpack
id: test/bad
name: Bad Pack
version: 1.0.0
setup:
  - id: dangerous
    name: Dangerous command
    run: rm -rf anything
`,
    );

    await withEnv({ OPENDOCK_DATA_DIR: data }, async () => {
      await expect(
        install({
          packRef: PackRef.parse("test/bad"),
          projectDir: project,
          runCommands: true,
          operation: "install",
          phase: "install",
          resolve: localResolver(packs),
        }),
      ).rejects.toThrow("not allowed");
    });

    const logs = runCli(project, { OPENDOCK_DATA_DIR: data }, ["log"]);
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

function localResolver(root: string): PackResolver {
  return (packRef) => resolveLocalPack(root, packRef);
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

function writeTestPack(
  root: string,
  owner: string,
  name: string,
  version: string,
  readme: string,
): void {
  const packRoot = join(root, owner, name);
  mkdirSync(join(packRoot, "templates"), { recursive: true });
  writeFileSync(
    join(packRoot, "dock.yml"),
    `schema: opendock/v1
kind: starterpack
id: ${owner}/${name}
name: Demo Pack
version: ${version}
`,
  );
  writeFileSync(join(packRoot, "templates", "README.md"), readme);
  writeFileSync(join(packRoot, "templates", ".gitignore"), "node_modules/\n.DS_Store\n");
  writeFileSync(join(packRoot, "templates", "AGENTS.md"), "# Agents\n");
  writeFileSync(join(packRoot, "templates", "DESIGN.md"), "# Design\n");
}

function writeModernPack(root: string): void {
  const packRoot = join(root, "test", "modern");
  mkdirSync(join(packRoot, "templates"), { recursive: true });
  writeFileSync(
    join(packRoot, "dock.yml"),
    `opendock: 1
id: test/modern
version: 1.0.0
files:
  - from: templates/DESIGN.md
    to: DESIGN.md
    update: managed_block
  - from: templates/README.md
    to: README.md
    update: manual_review
  - from: templates/.gitignore
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
  writeFileSync(join(packRoot, "templates", "README.md"), "# Starter README\n");
  writeFileSync(join(packRoot, "templates", ".gitignore"), "node_modules/\n.DS_Store\n");
  writeFileSync(join(packRoot, "templates", "DESIGN.md"), "# Design\n");
}

function writeVersionFailurePack(root: string): void {
  const packRoot = join(root, "test", "version-fail");
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(
    join(packRoot, "dock.yml"),
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

function writeTimeoutDoctorPack(root: string): void {
  const packRoot = join(root, "test", "timeout");
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(
    join(packRoot, "dock.yml"),
    `opendock: 1
id: test/timeout
version: 1.0.0
lifecycle:
  doctor:
    - id: volta-env
      check: node -e "if (process.env._VOLTA_TOOL_RECURSION) process.exit(7)"
    - id: slow
      check: node -e "setTimeout(function(){}, 1000)"
      timeout_ms: 50
`,
  );
}

function writeInteractivePack(root: string): void {
  writeInteractivePackVariant(root, "interactive-user", "user", "");
  writeInteractivePackVariant(
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

function writeInteractivePackVariant(
  root: string,
  name: string,
  interactive: string,
  extraRun: string,
): void {
  const packRoot = join(root, "test", name);
  mkdirSync(join(packRoot, "files"), { recursive: true });
  const scriptName =
    name === "interactive-user" ? "user-interactive.js" : "scripted-interactive.js";
  const outputName = name === "interactive-user" ? "user-input.txt" : "scripted-input.txt";
  const label = name === "interactive-user" ? "USER_TTY" : "SCRIPTED_TTY";
  const interactiveYaml = interactive.includes("\n") ? interactive : `interactive: ${interactive}`;
  writeFileSync(
    join(packRoot, "dock.yml"),
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
      run: node ${scriptName}
      ${interactiveYaml}
      timeout_ms: 5000
${extraRun}`,
  );
  writeFileSync(
    join(packRoot, "files", scriptName),
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
    join(bin, "omx"),
    `#!/bin/sh
echo "omx 1.2.3"
`,
  );
}
