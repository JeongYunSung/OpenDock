import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDeployPlatform } from "../src/cli-options.js";
import type { DockManifest } from "../src/core/domain/manifest.js";
import { safeDockDirectoryName } from "../src/core/files/path-utils.js";
import { CommandRunner } from "../src/core/runtime/command-runner.js";
import { createProjectCommandShim } from "../src/core/runtime/command-shim.js";
import { projectCommandPathEntries } from "../src/core/runtime/project-layout.js";
import { RequirementRunner } from "../src/core/runtime/requirement-runner.js";
import type {
  RuntimeInstaller,
  RuntimeInstallRequest,
} from "../src/core/runtime/runtime-installer.js";
import { validateManifestTaskCommands } from "../src/core/runtime/task-command-validation.js";
import { TaskRunner } from "../src/core/runtime/task-runner.js";
import type { ToolRunner } from "../src/core/runtime/tool-runner.js";
import { detectPlatform, type OpenDockPlatform } from "../src/platform.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runtime, tool, PATH, and platform isolation edge cases", () => {
  it("reuses shared managed runtime directories across projects while separating incompatible versions", async () => {
    const home = realpathSync(tempDir());
    const hostBin = tempDir();
    const projectA = tempDir();
    const projectB = tempDir();
    const projectC = tempDir();
    writeFakeRuntime(hostBin, "node", "v1.0.0");

    const installer = new FakeRuntimeInstaller(home);
    const runner = new RequirementRunner(new CommandRunner(), installer);

    await withEnv({ HOME: home, PATH: `${hostBin}:${process.env.PATH ?? ""}` }, async () => {
      runner.run(runtimeManifest("node", ">=22.0.0 <23.0.0"), {
        phase: "install",
        platform: "macos",
        projectDir: projectA,
      });
      runner.run(runtimeManifest("node", ">=22.0.0 <23.0.0"), {
        phase: "install",
        platform: "macos",
        projectDir: projectB,
      });
      runner.run(runtimeManifest("node", ">=24.0.0 <25.0.0"), {
        phase: "install",
        platform: "macos",
        projectDir: projectC,
      });
    });

    const node22 = join(home, ".opendock", "runtimes", "node", "22.12.0", "bin", "node");
    const node24 = join(home, ".opendock", "runtimes", "node", "24.4.0", "bin", "node");
    expect(existsSync(node22)).toBe(true);
    expect(existsSync(node24)).toBe(true);
    expect(node22).not.toBe(node24);
    expect(readFileSync(join(projectA, ".opendock", "bin", "node"), "utf8")).toContain(node22);
    expect(readFileSync(join(projectB, ".opendock", "bin", "node"), "utf8")).toContain(node22);
    expect(readFileSync(join(projectC, ".opendock", "bin", "node"), "utf8")).toContain(node24);
    expect(installer.requests).toEqual([
      { requested: ">=22.0.0 <23.0.0", runtime: "node" },
      { requested: ">=22.0.0 <23.0.0", runtime: "node" },
      { requested: ">=24.0.0 <25.0.0", runtime: "node" },
    ]);
  });

  it("puts project .opendock/bin before host globals only for declared tool commands", async () => {
    const project = tempDir();
    const hostBin = tempDir();
    const projectLog = join(project, "project-tool.log");
    const hostLog = join(project, "host-tool.log");
    writeExecutable(
      join(hostBin, "oma"),
      `#!/bin/sh
printf 'host:%s\\n' "$*" >> "${hostLog}"
`,
    );
    createProjectCommandShim({
      command: "oma",
      owner: { dockId: "test/path", kind: "tool", name: "oma" },
      platform: "macos",
      projectDir: project,
      target: writeExecutable(
        join(tempDir(), "oma"),
        `#!/bin/sh
printf 'project:%s\\n' "$*" >> "${projectLog}"
`,
      ),
    });

    const runner = new CommandRunner();
    await withEnv({ PATH: `${hostBin}:${process.env.PATH ?? ""}` }, () => {
      const result = runner.run("oma -y install", {
        cwd: project,
        pathEntries: projectCommandPathEntries(project),
        permissionPrograms: ["oma"],
        permissions: ["oma -y install"],
        platform: "macos",
      });
      expect(result.success).toBe(true);

      expect(() =>
        runner.run("oma -y update", {
          cwd: project,
          pathEntries: projectCommandPathEntries(project),
          permissions: ["oma -y update"],
          platform: "macos",
        }),
      ).toThrow("not declared in tools.commands");
    });

    expect(readFileSync(projectLog, "utf8")).toBe("project:-y install\n");
    expect(existsSync(hostLog)).toBe(false);
  });

  it("installs tools into dock-local folders and runs their wrappers instead of host commands", async () => {
    const project = tempDir();
    const home = realpathSync(tempDir());
    const bin = tempDir();
    const toolLog = join(project, "tool.log");
    const hostLog = join(project, "host.log");
    writeFakeBun(bin, toolLog);
    writeExecutable(
      join(bin, "oma"),
      `#!/bin/sh
printf 'host:%s\\n' "$*" >> "${hostLog}"
`,
    );

    const result = await withEnv({ HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new TaskRunner().run(omaToolManifest(), {
        dockId: "test/oma-tool",
        live: false,
        phase: "install",
        platform: "macos",
        projectDir: project,
      }),
    );

    const toolDir = join(
      project,
      ".opendock",
      "tools",
      safeDockDirectoryName("test/oma-tool"),
      "oma",
    );
    expect(result.reports.map((report) => `${report.id}:${report.status}`)).toEqual([
      "require-runtime-bun:Ready",
      "require-tool-oma:Ready",
      "apply-oma:Ran",
    ]);
    expect(existsSync(join(toolDir, "package.json"))).toBe(true);
    expect(readFileSync(join(project, ".opendock", "bin", "oma"), "utf8")).toContain(
      join(toolDir, "node_modules", ".bin", "oma"),
    );
    expect(readFileSync(toolLog, "utf8")).toContain("bun:add oh-my-agent@8.52.9");
    expect(readFileSync(toolLog, "utf8")).toContain("oma:-y install");
    expect(existsSync(hostLog)).toBe(false);
    expect(existsSync(join(project, "node_modules"))).toBe(false);
  }, 15_000);

  it("wraps pip-installed console scripts with the target package path", async () => {
    const project = tempDir();
    const bin = tempDir();
    const toolLog = join(project, "python-tool.log");
    writeFakePip(bin, toolLog);

    const result = await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new TaskRunner().run(pythonToolManifest(), {
        dockId: "test/python-tool",
        live: false,
        phase: "install",
        platform: "macos",
        projectDir: project,
      }),
    );

    const toolDir = join(
      project,
      ".opendock",
      "tools",
      safeDockDirectoryName("test/python-tool"),
      "fake-python-tool",
    );
    const commandShim = readFileSync(join(project, ".opendock", "bin", "fake-tool"), "utf8");
    const wrapper = join(toolDir, ".opendock-command-wrappers", "fake-tool");
    expect(result.reports.map((report) => `${report.id}:${report.status}`)).toEqual([
      "require-tool-fake-python-tool:Ready",
      "check-fake-python-tool:Ran",
    ]);
    expect(commandShim).toContain(wrapper);
    expect(readFileSync(wrapper, "utf8")).toContain(join(toolDir, "python"));
    expect(readFileSync(toolLog, "utf8")).toBe("fake-python-tool:ok\n");
  });

  it("blocks package-manager installs in task commands", () => {
    for (const command of [
      "npm install left-pad",
      "bun add left-pad",
      "pip install unsafe-package",
      "pipx install unsafe-tool",
      "uv tool install unsafe-tool",
      "brew install node",
      "winget install Git.Git",
    ]) {
      expect(() =>
        validateManifestTaskCommands(
          manifest({
            permission: [command],
            tasks: { install: [{ id: "blocked", run: command, platforms: {} }] },
          }),
          "macos",
        ),
      ).toThrow(/package installs and updates|system package installs|not allowed|not declared/);
    }
  });

  it("selects concrete macOS and Windows platforms without falling back to any", () => {
    expect(resolveDeployPlatform(undefined, "dock.yml")).toBe(detectPlatform());
    expect(resolveDeployPlatform(undefined, "dock.macos.yml")).toBe("macos");
    expect(resolveDeployPlatform(undefined, "dock.windows.yml")).toBe("windows");
    expect(resolveDeployPlatform("win", "dock.macos.yml")).toBe("windows");

    const selected = new Set<OpenDockPlatform>([
      resolveDeployPlatform(undefined, "dock.yml"),
      resolveDeployPlatform(undefined, "dock.macos.yml"),
      resolveDeployPlatform(undefined, "dock.windows.yml"),
    ]);
    expect(selected.has("macos") || selected.has("windows") || selected.has("linux")).toBe(true);
    expect([...selected]).not.toContain("any" as OpenDockPlatform);
  });

  it("applies platform-specific task commands while preserving task order", async () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "platform.log");
    writeExecutable(
      join(bin, "git"),
      `#!/bin/sh
printf 'git:%s\\n' "$*" >> "${log}"
exit 0
`,
    );
    writeExecutable(
      join(bin, "powershell"),
      `#!/bin/sh
printf 'powershell:%s\\n' "$*" >> "${log}"
exit 0
`,
    );
    const runner = new TaskRunner(new CommandRunner(), undefined, undefined, emptyToolRunner());

    const macosReports = await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      runner.run(platformTaskManifest(), {
        dockId: "test/platform",
        live: false,
        phase: "install",
        platform: "macos",
        projectDir: project,
      }),
    );
    expect(macosReports.reports.map((report) => `${report.id}:${report.status}`)).toEqual([
      "before:Ran",
      "platform-step:Ran",
      "after:Ran",
    ]);
    expect(readFileSync(log, "utf8")).toBe("git:--version\ngit:status\ngit:--version\n");

    writeFileSync(log, "");
    const windowsReports = await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      runner.run(platformTaskManifest(), {
        dockId: "test/platform",
        live: false,
        phase: "install",
        platform: "windows",
        projectDir: project,
      }),
    );
    expect(windowsReports.reports.map((report) => `${report.id}:${report.status}`)).toEqual([
      "before:Ran",
      "platform-step:Ran",
      "after:Ran",
    ]);
    expect(readFileSync(log, "utf8")).toBe(
      "git:--version\npowershell:-NoProfile -NonInteractive -Command if (Test-Path -LiteralPath runtime-ready) { exit 0 } else { exit 1 }\ngit:--version\n",
    );
  });
});

class FakeRuntimeInstaller implements RuntimeInstaller {
  readonly requests: Array<{ requested: string; runtime: string }> = [];

  constructor(private readonly home: string) {}

  install(request: RuntimeInstallRequest) {
    this.requests.push({ requested: request.requested, runtime: request.runtime });
    const version = request.requested.includes(">=24.") ? "24.4.0" : "22.12.0";
    const bin = join(this.home, ".opendock", "runtimes", request.runtime, version, "bin");
    const target = join(bin, request.runtime);
    if (!existsSync(target)) {
      mkdirSync(bin, { recursive: true });
      writeFakeRuntime(bin, request.runtime, `v${version}`);
    }
    return {
      commands: [request.runtime],
      path: bin,
      requested: request.requested,
      source: "managed" as const,
      targets: { [request.runtime]: target },
      version,
    };
  }
}

function runtimeManifest(runtime: "node", version: string): DockManifest {
  return manifest({
    requires: {
      runtimes: {
        [runtime]: version,
      },
    },
  });
}

function omaToolManifest(): DockManifest {
  return manifest({
    permission: ["oma -y install"],
    requires: {
      runtimes: {
        bun: ">=1.3.0",
      },
    },
    tools: {
      oma: {
        manager: "bun",
        package: "oh-my-agent",
        version: "8.52.9",
        commands: ["oma"],
      },
    },
    tasks: {
      install: [
        {
          id: "apply-oma",
          run: "oma -y install",
          platforms: {},
        },
      ],
    },
  });
}

function pythonToolManifest(): DockManifest {
  return manifest({
    tools: {
      "fake-python-tool": {
        manager: "pip",
        package: "fake-python-tool",
        version: "1.0.0",
        commands: ["fake-tool"],
      },
    },
    tasks: {
      install: [
        {
          id: "check-fake-python-tool",
          run: "fake-tool --version",
          platforms: {},
        },
      ],
    },
  });
}

function platformTaskManifest(): DockManifest {
  return manifest({
    tasks: {
      install: [
        { id: "before", run: "git --version", platforms: {} },
        {
          id: "platform-step",
          run: "git status",
          platforms: {
            macos: {
              run: "git status",
            },
            windows: {
              run: 'powershell -NoProfile -NonInteractive -Command "if (Test-Path -LiteralPath runtime-ready) { exit 0 } else { exit 1 }"',
            },
          },
        },
        { id: "after", run: "git --version", platforms: {} },
      ],
    },
  });
}

type ManifestOverrides = Omit<Partial<DockManifest>, "requires" | "tasks"> & {
  requires?: { runtimes?: Record<string, string> };
  tasks?: Partial<DockManifest["tasks"]>;
};

function manifest(overrides: ManifestOverrides): DockManifest {
  const { requires, tasks, ...rest } = overrides;
  return {
    opendock: 1,
    id: "test/runtime-tool-isolation",
    summary: "",
    tags: [],
    permission: [],
    tools: {},
    files: [],
    ...rest,
    requires: {
      runtimes: {
        ...(requires?.runtimes ?? {}),
      },
    },
    tasks: {
      install: tasks?.install ?? [],
      update: tasks?.update ?? [],
      doctor: tasks?.doctor ?? [],
    },
  };
}

function emptyToolRunner(): ToolRunner {
  return {
    run() {
      return { reports: [], tools: [] };
    },
  } as unknown as ToolRunner;
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-runtime-tool-isolation-"));
  tempRoots.push(dir);
  return dir;
}

function writeFakeBun(bin: string, log: string): void {
  writeExecutable(
    join(bin, "bun"),
    `#!/bin/sh
set -eu
printf 'bun:%s\\n' "$*" >> "${log}"
if [ "$1" = "--version" ]; then
  printf '1.3.11\\n'
  exit 0
fi
if [ "$1" = "add" ]; then
  mkdir -p node_modules/.bin
  /bin/cat > node_modules/.bin/oma <<'EOF'
#!/bin/sh
set -eu
printf 'oma:%s\\n' "$*" >> "${log}"
exit 0
EOF
  /bin/chmod +x node_modules/.bin/oma
  exit 0
fi
exit 1
`,
  );
}

function writeFakePip(bin: string, log: string): void {
  writeExecutable(
    join(bin, "pip"),
    `#!/bin/sh
set -eu
if [ "$1" = "--version" ]; then
  printf 'pip 24.0\\n'
  exit 0
fi
if [ "$1" = "install" ] && [ "$2" = "--target" ]; then
  target="$3"
  mkdir -p "$target/bin" "$target/fake_tool"
  /bin/cat > "$target/fake_tool/__init__.py" <<'EOF'
VALUE = "ok"
EOF
  /bin/cat > "$target/bin/fake-tool" <<'EOF'
#!/bin/sh
python3 - <<'PY'
from pathlib import Path
import fake_tool
Path("${log}").write_text(f"fake-python-tool:{fake_tool.VALUE}\\n")
PY
EOF
  /bin/chmod +x "$target/bin/fake-tool"
  exit 0
fi
exit 1
`,
  );
}

function writeFakeRuntime(bin: string, command: string, version: string): void {
  writeExecutable(
    join(bin, command),
    `#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ] || [ "\${1:-}" = "-v" ] || [ "\${1:-}" = "-V" ]; then
  printf '${version}\\n'
  exit 0
fi
printf '${version}\\n'
`,
  );
}

function writeExecutable(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return path;
}

async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T> | T): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
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
