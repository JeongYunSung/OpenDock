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
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  type DockManifest,
  DockRef,
  manifestForRef,
  parseManifestFile,
} from "../src/core/domain/manifest.js";
import { safeDockDirectoryName } from "../src/core/files/path-utils.js";
import { TaskRunner } from "../src/core/runtime/task-runner.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("requires regression coverage", () => {
  it("parses manifests without a top-level dock id", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        summary: "Identity comes from the install or deploy reference.",
      }),
    );

    const manifest = parseManifestFile(join(root, "dock.yml"));
    const bound = manifestForRef(manifest, DockRef.parse("test/idless@1.0.0"));

    expect(manifest.id).toBe("");
    expect(bound.id).toBe("test/idless");
    expect(manifest.summary).toBe("Identity comes from the install or deploy reference.");
  });

  it("parses runtime requirements from dock.yml", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/requires",
        requires: {
          runtimes: {
            node: ">=22.0.0 <25.0.0",
            bun: ">=1.3.0",
          },
        },
      }),
    );

    const manifest = parseManifestFile(join(root, "dock.yml"));

    expect(manifest.requires.runtimes).toEqual({
      bun: ">=1.3.0",
      node: ">=22.0.0 <25.0.0",
    });
  });

  it("parses catalog tags from dock.yml", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/tags",
        tags: ["frontend", "ai-agent", "workflow"],
      }),
    );

    const manifest = parseManifestFile(join(root, "dock.yml"));

    expect(manifest.tags).toEqual(["frontend", "ai-agent", "workflow"]);
  });

  it("defaults catalog tags to an empty list", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/tags",
      }),
    );

    const manifest = parseManifestFile(join(root, "dock.yml"));

    expect(manifest.tags).toEqual([]);
  });

  it("rejects invalid catalog tags", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/tags",
        tags: ["Frontend"],
      }),
    );

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow("tags must be lowercase slugs");
  });

  it("rejects duplicate catalog tags", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/tags",
        tags: ["frontend", "frontend"],
      }),
    );

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow("duplicate tag");
  });

  it("rejects unknown requires fields with compatibility guidance", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/requires",
        requires: {
          tools: {
            oma: ">=8.43.0",
          },
        },
      }),
    );

    const error = captureManifestError(join(root, "dock.yml"));

    expect(error.message).toContain("unsupported dock.yml field `requires.tools`");
    expect(error.message).toContain("older OpenDock v1 manifest format");
    expect(error.message).not.toContain("Unrecognized key");
  });

  it("parses top-level tasks from dock.yml", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/tasks",
        install: [{ id: "install-step", run: "mkdir -p .opendock" }],
        update: [{ id: "update-step", run: "mkdir -p .opendock" }],
        doctor: [{ id: "doctor-step", check: "test -f AGENTS.md" }],
      }),
    );

    const manifest = parseManifestFile(join(root, "dock.yml"));

    expect(manifest.tasks.install.map((step) => step.id)).toEqual(["install-step"]);
    expect(manifest.tasks.update.map((step) => step.id)).toEqual(["update-step"]);
    expect(manifest.tasks.doctor.map((step) => step.id)).toEqual(["doctor-step"]);
  });

  it("parses dock workdir seed files from dock.yml", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/workdir",
        workdir: {
          files: [{ from: "inputs/oma-config.yaml", to: ".agents/oma-config.yaml" }],
        },
      }),
    );

    const manifest = parseManifestFile(join(root, "dock.yml"));

    expect(manifest.workdir?.files).toEqual([
      { from: "inputs/oma-config.yaml", to: ".agents/oma-config.yaml" },
    ]);
  });

  it("parses exact command permissions from dock.yml", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        permissions: ["oma -y install", "oma link claude codex"],
      }),
    );

    const manifest = parseManifestFile(join(root, "dock.yml"));

    expect(manifest.permission).toEqual(["oma -y install", "oma link claude codex"]);
  });

  it("rejects manifests that mix legacy permission and permissions", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        permission: ["oma -y install"],
        permissions: ["oma -y update"],
      }),
    );

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow(
      "use `permissions`, not both `permission` and `permissions`",
    );
  });

  it("rejects shell operators in dock.yml permissions", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        permissions: ["oma -y install && rm -rf ."],
      }),
    );

    const error = captureManifestError(join(root, "dock.yml"));

    expect(error.message).toContain("shell operators are not allowed in permission command");
  });

  it("parses project-local tool declarations from dock.yml", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        tools: {
          codex: {
            manager: "npm",
            package: "@openai/codex",
            version: "latest",
            commands: ["codex"],
          },
        },
      }),
    );

    const manifest = parseManifestFile(join(root, "dock.yml"));

    expect(manifest.tools?.codex).toEqual({
      manager: "npm",
      package: "@openai/codex",
      version: "latest",
      commands: ["codex"],
    });
  });

  it("rejects unsafe or conflicting tool declarations", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        tools: {
          first: {
            manager: "npm",
            package: "@openai/codex@latest",
            commands: ["codex"],
          },
        },
      }),
    );

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow(
      "tool package must be a safe package name without a version",
    );

    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        tools: {
          first: {
            manager: "npm",
            package: "@openai/codex",
            commands: ["codex"],
          },
          second: {
            manager: "bun",
            package: "other-tool",
            commands: ["codex"],
          },
        },
      }),
    );

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow(
      "tool command `codex` is provided by both `first` and `second`",
    );
  });

  it("rejects legacy lifecycle field with compatibility guidance", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/tasks",
        lifecycle: {
          install: [{ id: "legacy-step", run: "mkdir -p .opendock" }],
        },
      }),
    );

    const error = captureManifestError(join(root, "dock.yml"));

    expect(error.message).toContain("unsupported dock.yml field `lifecycle`");
    expect(error.message).toContain("older OpenDock v1 manifest format");
    expect(error.message).not.toContain("Unrecognized key");
  });

  it("rejects unsupported required runtimes", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/requires",
        requires: {
          runtimes: {
            ruby: ">=3.0.0",
          },
        },
      }),
    );

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow(
      "unsupported required runtime `ruby`",
    );
  });

  it("prepares required runtimes in the home OpenDock runtime store", async () => {
    const home = realpathSync(tempDir());
    const project = tempDir();
    const bin = tempDir();
    writeFakeRuntime(bin, "node", "v22.12.0");

    const result = await withEnv({ HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new TaskRunner().run(runtimeManifest("node", ">=22.0.0 <23.0.0"), {
        projectDir: project,
        dockId: "test/runtime",
        phase: "install",
        platform: "macos",
        live: false,
      }),
    );

    const runtime = result.runtimes[0];
    const sharedBin = join(home, ".opendock", "runtimes", "node", "22.12.0", "bin");
    expect(runtime).toEqual({
      name: "node",
      requested: ">=22.0.0 <23.0.0",
      source: "host",
      version: "22.12.0",
      path: sharedBin,
      commands: ["node"],
    });
    expect(existsSync(join(sharedBin, "node"))).toBe(true);
    expect(readFileSync(join(project, ".opendock", "bin", "node"), "utf8")).toContain(sharedBin);
    expect(existsSync(join(project, ".opendock", "toolchains"))).toBe(false);
  });

  it("shares one project runtime shim across multiple docks", async () => {
    const home = realpathSync(tempDir());
    const project = tempDir();
    const bin = tempDir();
    writeFakeRuntime(bin, "node", "v22.12.0");

    await withEnv({ HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}` }, async () => {
      for (const dockId of ["test/first", "test/second"]) {
        await new TaskRunner().run(runtimeManifest("node", ">=22.0.0 <23.0.0"), {
          projectDir: project,
          dockId,
          phase: "install",
          platform: "macos",
          live: false,
        });
      }
    });

    const shim = readFileSync(join(project, ".opendock", "bin", "node"), "utf8");
    expect(shim).toContain("OpenDock command shim");
    expect(shim).toContain(join(home, ".opendock", "runtimes", "node", "22.12.0", "bin"));
  });

  it("does not wrap an existing OpenDock runtime wrapper as the host source", async () => {
    const home = realpathSync(tempDir());
    const project = tempDir();
    const hostBin = tempDir();
    const managedBin = join(home, ".opendock", "runtimes", "node", "22.12.0", "bin");
    mkdirSync(managedBin, { recursive: true });
    writeFakeRuntime(managedBin, "node", "v22.12.0");
    writeFakeRuntime(hostBin, "node", "v22.12.0");

    await withEnv({ HOME: home, PATH: `${managedBin}:${hostBin}:${process.env.PATH ?? ""}` }, () =>
      new TaskRunner().run(runtimeManifest("node", ">=22.0.0 <23.0.0"), {
        projectDir: project,
        dockId: "test/runtime",
        phase: "install",
        platform: "macos",
        live: false,
      }),
    );

    const wrapper = readFileSync(join(managedBin, "node"), "utf8");
    expect(wrapper).toContain(join(hostBin, "node"));
    expect(wrapper).not.toContain(`exec "${join(managedBin, "node")}"`);
  });

  it("installs declared tools before generated outputs", async () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeBun(bin, log);

    const result = await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, async () =>
      new TaskRunner().run(omaManifest(), {
        projectDir: project,
        dockId: "test/oma",
        phase: "install",
        platform: "macos",
        live: false,
      }),
    );

    expect(result.reports.map((report) => `${report.id}:${report.status}`)).toEqual([
      "require-runtime-bun:Ready",
      "require-tool-oma:Ready",
      "apply-oma:Ran",
    ]);
    expect(result.exports.map((candidate) => candidate.path)).toEqual(
      expect.arrayContaining(["AGENTS.md", "CLAUDE.md", ".codex/agents/reviewer.toml"]),
    );
    expect(readFileSync(log, "utf8")).toContain("bun:add oh-my-agent@8.52.9");
    expect(readFileSync(log, "utf8")).toContain("oma:-y install");
    expect(
      readFileSync(
        join(project, ".opendock", "workdirs", safeDockDirectoryName("test/oma"), "AGENTS.md"),
        "utf8",
      ),
    ).toContain("Generated by fake OMA");
    expect(
      readFileSync(
        join(
          project,
          ".opendock",
          "workdirs",
          safeDockDirectoryName("test/oma"),
          ".codex",
          "agents",
          "reviewer.toml",
        ),
        "utf8",
      ),
    ).toContain("reviewer");
  }, 15_000);
});

function omaManifest(): DockManifest {
  return {
    opendock: 1,
    id: "test/oma",
    summary: "",
    tags: [],
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
    files: [],
    tasks: {
      install: [
        {
          id: "apply-oma",
          run: "oma -y install",
          workdir: "dock",
          platforms: {},
          export: {
            include: ["AGENTS.md", "CLAUDE.md", ".codex/**"],
            exclude: [],
          },
        },
      ],
      update: [],
      doctor: [],
    },
  };
}

function runtimeManifest(runtime: "node", version: string): DockManifest {
  return {
    opendock: 1,
    id: "test/runtime",
    summary: "",
    tags: [],
    permission: [],
    requires: {
      runtimes: {
        [runtime]: version,
      },
    },
    tools: {},
    files: [],
    tasks: {
      install: [],
      update: [],
      doctor: [],
    },
  };
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-requires-test-"));
  tempRoots.push(dir);
  return dir;
}

function captureManifestError(path: string): Error {
  try {
    parseManifestFile(path);
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected manifest parse to fail");
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
if [ "$*" = "-y install" ]; then
  mkdir -p .codex/agents
  printf '# Generated by fake OMA\\n' > AGENTS.md
  printf '# Claude\\n' > CLAUDE.md
  printf 'name = "reviewer"\\n' > .codex/agents/reviewer.toml
  exit 0
fi
if [ "$1" = "doctor" ]; then
  exit 0
fi
exit 1
EOF
	  /bin/chmod +x node_modules/.bin/oma
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

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
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
