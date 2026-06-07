import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
    const data = await tempDir();
    writeTestPack(packs, "test", "harness", "1.0.0", "# Starter README\n");
    writeFileSync(join(project, "README.md"), "# User README\n");
    writeFileSync(join(project, ".gitignore"), "node_modules/\n");

    const first = runCli(project, { OPENDOCK_PACKS_DIR: packs, OPENDOCK_DATA_DIR: data }, [
      "install",
      "test/harness",
    ]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("Installed test/harness@1.0.0");

    const second = runCli(project, { OPENDOCK_PACKS_DIR: packs, OPENDOCK_DATA_DIR: data }, [
      "install",
      "test/harness",
    ]);
    expect(second.status).toBe(0);

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

  it("reports doctor, log, and up-to-date update state", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    const data = await tempDir();
    writeTestPack(packs, "test", "harness", "1.0.0", "# Starter README\n");
    const env = { OPENDOCK_PACKS_DIR: packs, OPENDOCK_DATA_DIR: data };
    expect(runCli(project, env, ["install", "test/harness"]).status).toBe(0);

    const doctor = runCli(project, env, ["doctor"]);
    expect(doctor.status).toBe(0);
    expect(doctor.stdout).toContain("Status: Ready");
    expect(doctor.stdout).toContain("test/harness@1.0.0");

    const logs = runCli(project, env, ["log"]);
    expect(logs.status).toBe(0);
    expect(logs.stdout).toContain("install test/harness");

    const update = runCli(project, env, ["update"]);
    expect(update.status).toBe(0);
    expect(update.stdout).toContain("test/harness is up to date at 1.0.0");
  });

  it("supports opendock v1 files lifecycle and doctor checks", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    const data = await tempDir();
    writeModernPack(packs);
    writeFileSync(join(project, "README.md"), "# User README\n");
    writeFileSync(join(project, "DESIGN.md"), "# User Design\n");
    writeFileSync(join(project, ".gitignore"), "node_modules/\n");
    const env = { OPENDOCK_PACKS_DIR: packs, OPENDOCK_DATA_DIR: data };

    const install = runCli(project, env, ["install", "test/modern"]);
    expect(install.status).toBe(0);
    expect(install.stdout).toContain("Installed test/modern@1.0.0");
    expect(existsSync(join(project, ".opendock-fixture"))).toBe(true);

    const readme = readFileSync(join(project, "README.md"), "utf8");
    expect(readme).toBe("# User README\n");
    const design = readFileSync(join(project, "DESIGN.md"), "utf8");
    expect(design).toContain("# User Design");
    expect(design.match(/OPENDOCK:START test\/modern:DESIGN\.md/g)).toHaveLength(1);
    const gitignore = readFileSync(join(project, ".gitignore"), "utf8");
    expect(gitignore.match(/node_modules\//g)).toHaveLength(1);
    expect(gitignore).toContain(".DS_Store");

    const reinstall = runCli(project, env, ["install", "test/modern"]);
    expect(reinstall.status).toBe(0);
    const reinstalledDesign = readFileSync(join(project, "DESIGN.md"), "utf8");
    expect(reinstalledDesign).toContain("# User Design");
    expect(reinstalledDesign.match(/OPENDOCK:START test\/modern:DESIGN\.md/g)).toHaveLength(1);

    const doctor = runCli(project, env, ["doctor"]);
    expect(doctor.status).toBe(0);
    expect(doctor.stdout).toContain("✓ node");
    expect(doctor.stdout).toContain("✓ fixture");

    const update = runCli(project, env, ["update"]);
    expect(update.status).toBe(0);
    expect(update.stdout).toContain("Updated test/modern at 1.0.0");
    expect(existsSync(join(project, ".opendock-updated"))).toBe(true);
  });

  it("streams setup command output and fails unmet post-run version checks", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    const data = await tempDir();
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

    const install = runCli(
      project,
      {
        OPENDOCK_PACKS_DIR: packs,
        OPENDOCK_DATA_DIR: data,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      },
      ["install", "test/version-fail"],
    );
    expect(install.status).not.toBe(0);
    expect(install.stdout).toContain("→ install-oma-cli: bun install --global oh-my-agent@latest");
    expect(install.stdout).toContain("Downloading oh-my-agent");
    expect(install.stderr).toContain("6.4.0 does not satisfy >=9.0.0");
  });

  it("times out hanging doctor checks", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    const data = await tempDir();
    writeTimeoutDoctorPack(packs);
    const env = {
      OPENDOCK_PACKS_DIR: packs,
      OPENDOCK_DATA_DIR: data,
      _VOLTA_TOOL_RECURSION: "1",
    };

    const install = runCli(project, env, ["install", "test/timeout"]);
    expect(install.status).toBe(0);

    const doctor = runCli(project, env, ["doctor"]);
    expect(doctor.status).toBe(0);
    expect(doctor.stdout).toContain("✓ volta-env");
    expect(doctor.stdout).toContain("! slow (timed out after 50ms)");
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
    const data = await tempDir();
    writeTestPack(packs, "test", "demo", "1.0.0", "# Version One\n");

    expect(
      runCli(project, { OPENDOCK_PACKS_DIR: packs, OPENDOCK_DATA_DIR: data }, [
        "install",
        "test/demo",
      ]).status,
    ).toBe(0);

    writeTestPack(packs, "test", "demo", "2.0.0", "# Version Two\n");

    const update = runCli(project, { OPENDOCK_PACKS_DIR: packs, OPENDOCK_DATA_DIR: data }, [
      "update",
    ]);
    expect(update.status).toBe(0);
    expect(update.stdout).toContain("Updated test/demo: 1.0.0 -> 2.0.0");

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

    const install = runCli(project, { OPENDOCK_PACKS_DIR: packs, OPENDOCK_DATA_DIR: data }, [
      "install",
      "test/bad",
    ]);
    expect(install.status).not.toBe(0);
    expect(install.stderr).toContain("not allowed");

    const logs = runCli(project, { OPENDOCK_PACKS_DIR: packs, OPENDOCK_DATA_DIR: data }, ["log"]);
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

function runCli(cwd: string, env: NodeJS.ProcessEnv, args: string[]) {
  return spawnSync(process.execPath, [builtCli, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
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

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}
