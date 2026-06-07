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
    const data = await tempDir();
    writeFileSync(join(project, "README.md"), "# User README\n");
    writeFileSync(join(project, ".gitignore"), "node_modules/\n");

    const first = opendock(project, data, ["install", "opendock/codex-designer"]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("Installed opendock/codex-designer@1.0.0");

    const second = opendock(project, data, ["install", "opendock/codex-designer"]);
    expect(second.status).toBe(0);

    const readme = readFileSync(join(project, "README.md"), "utf8");
    expect(readme).toContain("# User README");
    expect(readme.match(/OPENDOCK:START opendock\/codex-designer:README\.md/g)).toHaveLength(1);

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
    const data = await tempDir();
    expect(opendock(project, data, ["install", "opendock/codex-designer"]).status).toBe(0);

    const doctor = opendock(project, data, ["doctor"]);
    expect(doctor.status).toBe(0);
    expect(doctor.stdout).toContain("Status: Ready");
    expect(doctor.stdout).toContain("opendock/codex-designer@1.0.0");

    const logs = opendock(project, data, ["log"]);
    expect(logs.status).toBe(0);
    expect(logs.stdout).toContain("install opendock/codex-designer");

    const update = opendock(project, data, ["update"]);
    expect(update.status).toBe(0);
    expect(update.stdout).toContain("opendock/codex-designer is up to date at 1.0.0");
  });

  it("rejects invalid pack references", () => {
    const result = runCli(process.cwd(), {}, ["install", "codex-designer"]);
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
    const result = runCli(project, { OPENDOCK_DATA_DIR: data }, ["deploy", "codex-designer"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not logged in");
  });

  it("reapplies newer pack versions", async () => {
    const project = await tempDir();
    const packs = await tempDir();
    const data = await tempDir();
    writeTestPack(packs, "1.0.0", "# Version One\n");

    expect(
      runCli(project, { OPENDOCK_PACKS_DIR: packs, OPENDOCK_DATA_DIR: data }, [
        "install",
        "test/demo",
      ]).status,
    ).toBe(0);

    writeTestPack(packs, "2.0.0", "# Version Two\n");

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

function opendock(project: string, data: string, args: string[]) {
  return runCli(
    project,
    {
      OPENDOCK_PACKS_DIR: join(repoRoot, "examples"),
      OPENDOCK_DATA_DIR: data,
    },
    args,
  );
}

function runCli(cwd: string, env: NodeJS.ProcessEnv, args: string[]) {
  return spawnSync(process.execPath, [builtCli, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function writeTestPack(root: string, version: string, readme: string): void {
  const packRoot = join(root, "test", "demo");
  mkdirSync(join(packRoot, "templates"), { recursive: true });
  writeFileSync(
    join(packRoot, "dock.yml"),
    `schema: opendock/v1
kind: starterpack
id: test/demo
name: Demo Pack
version: ${version}
`,
  );
  writeFileSync(join(packRoot, "templates", "README.md"), readme);
}
