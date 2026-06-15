import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { type DockManifest, parseManifestFile } from "../src/core/domain/manifest.js";
import { safeDockDirectoryName } from "../src/core/files/path-utils.js";
import { TaskRunner } from "../src/core/runtime/task-runner.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("requires regression coverage", () => {
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

  it("rejects unknown requires fields", () => {
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

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow("Unrecognized key");
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

  it("rejects legacy lifecycle field from dock.yml", () => {
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

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow("Unrecognized key");
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

  it("runs package manager installs as ordinary task steps before generated outputs", async () => {
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
      "install-oma:Ran",
      "apply-oma:Ran",
    ]);
    expect(result.exports.map((candidate) => candidate.path)).toEqual(
      expect.arrayContaining(["AGENTS.md", "CLAUDE.md", ".codex/agents/reviewer.toml"]),
    );
    expect(readFileSync(log, "utf8")).toContain("bun:install --global oh-my-agent@latest");
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
    requires: {
      runtimes: {
        bun: ">=1.3.0",
      },
    },
    files: [],
    tasks: {
      install: [
        {
          id: "install-oma",
          run: "bun install --global oh-my-agent@latest",
          platforms: {},
        },
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

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-requires-test-"));
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
if [ "$1" = "install" ]; then
  /bin/cat > "${bin}/oma" <<'EOF'
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
  /bin/chmod +x "${bin}/oma"
  exit 0
fi
exit 1
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
