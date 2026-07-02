import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DockManifest, ToolSpec } from "../src/core/domain/manifest.js";
import { FileCandidateCollector } from "../src/core/files/file-candidate.js";
import { CommandRunner, failureMessage } from "../src/core/runtime/command-runner.js";
import { createProjectCommandShim } from "../src/core/runtime/command-shim.js";
import { projectBinDir } from "../src/core/runtime/project-layout.js";
import { RequirementRunner } from "../src/core/runtime/requirement-runner.js";
import { validateManifestTaskCommands } from "../src/core/runtime/task-command-validation.js";
import { TaskRunner } from "../src/core/runtime/task-runner.js";
import type { ToolRunner } from "../src/core/runtime/tool-runner.js";

const tempRoots: string[] = [];

const shellOperatorCommands = [
  "git status | git status",
  "git status && git status",
  "git status || git status",
  "git status; git status",
  "git status `git status`",
  "git status $(git status)",
  "git status > out",
  "git status < in",
];

const packageInstallCommands = [
  "npm install left-pad",
  "npm update left-pad",
  "bun add left-pad",
  "bun install",
  "pnpm add left-pad",
  "pnpm update left-pad",
  "pip install some-tool",
  "pip3 install some-tool",
  "pipx install some-tool",
  "pipx upgrade some-tool",
  "uv tool install some-tool",
  "uv tool upgrade some-tool",
];

type ManifestOverrides = Omit<Partial<DockManifest>, "tasks"> & {
  tasks?: Partial<DockManifest["tasks"]>;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("task permission policy", () => {
  it("allows only declared tool commands or OpenDock default commands", () => {
    expect(() =>
      validateManifestTaskCommands(
        manifest({
          permission: ["git status"],
          tasks: { install: [{ id: "default", run: "git status", platforms: {} }] },
        }),
        "macos",
      ),
    ).not.toThrow();

    expect(() =>
      validateManifestTaskCommands(
        manifest({
          tools: { custom: tool("custom-tool") },
          permission: ["custom-tool generate"],
          tasks: { install: [{ id: "tool", run: "custom-tool generate", platforms: {} }] },
        }),
        "macos",
      ),
    ).not.toThrow();

    expect(() =>
      validateManifestTaskCommands(
        manifest({
          permission: ["custom-tool generate"],
          tasks: { install: [{ id: "undeclared", run: "custom-tool generate", platforms: {} }] },
        }),
        "macos",
      ),
    ).toThrow("not declared in tools.commands");
  });

  it("automatically allows simple version checks for declared tool commands", () => {
    expect(() =>
      validateManifestTaskCommands(
        manifest({
          tools: { codex: tool("codex") },
          tasks: { install: [{ id: "version", run: "codex --version", platforms: {} }] },
        }),
        "macos",
      ),
    ).not.toThrow();

    expect(() =>
      validateManifestTaskCommands(
        manifest({
          tools: { codex: tool("codex") },
          tasks: { install: [{ id: "variant", run: "codex login", platforms: {} }] },
        }),
        "macos",
      ),
    ).toThrow("not allowed");
  });

  it("requires exact permission matches for declared tool command variants", () => {
    expect(() =>
      validateManifestTaskCommands(
        manifest({
          tools: { oma: tool("oma") },
          permission: ["oma -y install"],
          tasks: { install: [{ id: "install-oma", run: "oma -y install", platforms: {} }] },
        }),
        "macos",
      ),
    ).not.toThrow();

    expect(() =>
      validateManifestTaskCommands(
        manifest({
          tools: { oma: tool("oma") },
          permission: ["oma -y install"],
          tasks: { update: [{ id: "update-oma", run: "oma update", platforms: {} }] },
        }),
        "macos",
      ),
    ).toThrow("invalid update step `update-oma` run");
  });

  it("runs an exact fake tool permission and rejects an unpermitted variant before spawn", () => {
    const project = tempDir();
    const log = join(project, "oma.log");
    writeProjectCommand(
      project,
      "oma",
      `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
exit 0
`,
    );
    const runner = taskRunnerWithoutToolInstall();

    const exact = manifest({
      tools: { oma: tool("oma") },
      permission: ["oma -y install"],
      tasks: { install: [{ id: "install-oma", run: "oma -y install", platforms: {} }] },
    });

    const result = runner.run(exact, {
      dockId: exact.id,
      phase: "install",
      platform: "macos",
      projectDir: project,
      live: false,
    });

    expect(result.reports.at(-1)).toMatchObject({ id: "install-oma", status: "Ran" });
    expect(readFileSync(log, "utf8")).toBe("-y install\n");

    const variant = manifest({
      tools: { oma: tool("oma") },
      permission: ["oma -y install"],
      tasks: { update: [{ id: "update-oma", run: "oma update", platforms: {} }] },
    });

    expect(() =>
      runner.run(variant, {
        dockId: variant.id,
        phase: "update",
        platform: "macos",
        projectDir: project,
        live: false,
      }),
    ).toThrow("not allowed");
    expect(readFileSync(log, "utf8")).toBe("-y install\n");
  });

  it("rejects shell metacharacters in install, update, and doctor commands", () => {
    for (const command of shellOperatorCommands) {
      expect(() =>
        validateManifestTaskCommands(
          manifest({
            tasks: { install: [{ id: "bad-install", run: command, platforms: {} }] },
          }),
          "macos",
        ),
      ).toThrow("shell operators are not allowed");

      expect(() =>
        validateManifestTaskCommands(
          manifest({
            tasks: { update: [{ id: "bad-update", run: command, platforms: {} }] },
          }),
          "macos",
        ),
      ).toThrow("shell operators are not allowed");

      expect(() =>
        validateManifestTaskCommands(
          manifest({
            tasks: { doctor: [{ id: "bad-doctor", check: command, platforms: {} }] },
          }),
          "macos",
        ),
      ).toThrow("shell operators are not allowed");
    }
  });

  it("rejects direct package install and update task commands", () => {
    for (const command of packageInstallCommands) {
      expect(() =>
        validateManifestTaskCommands(
          manifest({
            permission: [command],
            tasks: { install: [{ id: "package-install", run: command, platforms: {} }] },
          }),
          "macos",
        ),
      ).toThrow("package installs and updates are not allowed");
    }
  });

  it("keeps project command shims isolated by tool owner", () => {
    const project = tempDir();
    const firstTarget = writeExecutable(
      join(tempDir(), "shared-tool"),
      "#!/bin/sh\nprintf 'first\\n'\n",
    );
    const secondTarget = writeExecutable(
      join(tempDir(), "shared-tool"),
      "#!/bin/sh\nprintf 'second\\n'\n",
    );

    createProjectCommandShim({
      command: "shared-tool",
      owner: { dockId: "test/first", kind: "tool", name: "agent" },
      platform: "macos",
      projectDir: project,
      target: firstTarget,
    });

    expect(() =>
      createProjectCommandShim({
        command: "shared-tool",
        owner: { dockId: "test/second", kind: "tool", name: "agent" },
        platform: "macos",
        projectDir: project,
        target: secondTarget,
      }),
    ).toThrow("already provided by tool `agent` from dock `test/first`");
  });

  it("reports missing doctor commands and non-zero task exits clearly", () => {
    const project = tempDir();
    const runner = taskRunnerWithoutToolInstall();

    const missing = runner.run(
      manifest({
        tools: { missing: tool("missing-policy-command") },
        permission: ["missing-policy-command check"],
        tasks: {
          doctor: [{ id: "missing-command", check: "missing-policy-command check", platforms: {} }],
        },
      }),
      {
        dockId: "test/missing",
        phase: "doctor",
        platform: "macos",
        projectDir: project,
        live: false,
      },
    );

    expect(missing.reports.at(-1)).toMatchObject({
      id: "missing-command",
      status: "Failed",
    });
    expect(missing.reports.at(-1)?.message).toContain("missing-policy-command");

    writeProjectCommand(
      project,
      "failing-policy-command",
      "#!/bin/sh\nprintf 'policy failed\\n' >&2\nexit 42\n",
    );

    expect(() =>
      runner.run(
        manifest({
          tools: { failing: tool("failing-policy-command") },
          permission: ["failing-policy-command run"],
          tasks: {
            install: [{ id: "non-zero-command", run: "failing-policy-command run", platforms: {} }],
          },
        }),
        {
          dockId: "test/non-zero",
          phase: "install",
          platform: "macos",
          projectDir: project,
          live: false,
        },
      ),
    ).toThrow("step `non-zero-command` exited with non-zero status: policy failed");
  });

  it("keeps CommandRunner missing and non-zero results actionable with fake commands", () => {
    const project = tempDir();
    const bin = tempDir();
    const runner = new CommandRunner();

    const missing = runner.run("missing-policy-command run", {
      cwd: project,
      missingAsFailure: true,
      permissions: ["missing-policy-command run"],
      permissionPrograms: ["missing-policy-command"],
      platform: "macos",
    });

    expect(missing.success).toBe(false);
    expect(failureMessage(missing)).toContain("missing-policy-command");

    writeExecutable(
      join(bin, "failing-policy-command"),
      "#!/bin/sh\nprintf 'policy failed\\n' >&2\nexit 42\n",
    );

    const failed = runner.run("failing-policy-command run", {
      cwd: project,
      pathEntries: [bin],
      permissions: ["failing-policy-command run"],
      permissionPrograms: ["failing-policy-command"],
      platform: "macos",
    });

    expect(failed.success).toBe(false);
    expect(failureMessage(failed)).toBe("policy failed");
  });
});

function manifest(overrides: ManifestOverrides = {}): DockManifest {
  const { tasks, ...rest } = overrides;
  return {
    opendock: 1,
    id: "test/policy",
    summary: "",
    tags: [],
    permission: [],
    requires: { runtimes: {} },
    tools: {},
    files: [],
    ...rest,
    tasks: {
      install: tasks?.install ?? [],
      update: tasks?.update ?? [],
      doctor: tasks?.doctor ?? [],
    },
  };
}

function tool(command: string): ToolSpec {
  return {
    manager: "bun",
    package: command,
    version: "1.0.0",
    commands: [command],
  };
}

function taskRunnerWithoutToolInstall(): TaskRunner {
  const commandRunner = new CommandRunner();
  const toolRunner = { run: () => ({ reports: [], tools: [] }) } as unknown as ToolRunner;
  return new TaskRunner(
    commandRunner,
    new FileCandidateCollector(),
    new RequirementRunner(commandRunner),
    toolRunner,
  );
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-task-policy-test-"));
  tempRoots.push(dir);
  return dir;
}

function writeProjectCommand(project: string, command: string, content: string): string {
  mkdirSync(projectBinDir(project), { recursive: true });
  return writeExecutable(join(projectBinDir(project), command), content);
}

function writeExecutable(path: string, content: string): string {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return path;
}
