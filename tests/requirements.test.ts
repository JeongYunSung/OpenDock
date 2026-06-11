import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { type DockManifest, parseManifestFile } from "../src/core/domain/manifest.js";
import { LifecycleRunner } from "../src/core/runtime/lifecycle-runner.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("requires regression coverage", () => {
  it("parses runtime and package requirements from dock.yml", () => {
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
          packages: {
            oma: {
              manager: "bun",
              name: "oh-my-agent",
              version: ">=8.43.0",
            },
          },
        },
      }),
    );

    const manifest = parseManifestFile(join(root, "dock.yml"));

    expect(manifest.requires.runtimes).toEqual({
      bun: ">=1.3.0",
      node: ">=22.0.0 <25.0.0",
    });
    expect(manifest.requires.packages.oma).toEqual({
      manager: "bun",
      name: "oh-my-agent",
      version: ">=8.43.0",
    });
  });

  it("parses top-level command phases from dock.yml", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/commands",
        install: [{ id: "install-step", run: "mkdir -p .opendock" }],
        update: [{ id: "update-step", run: "mkdir -p .opendock" }],
        doctor: [{ id: "doctor-step", check: "test -f AGENTS.md" }],
      }),
    );

    const manifest = parseManifestFile(join(root, "dock.yml"));

    expect(manifest.lifecycle.install.map((step) => step.id)).toEqual(["install-step"]);
    expect(manifest.lifecycle.update.map((step) => step.id)).toEqual(["update-step"]);
    expect(manifest.lifecycle.doctor.map((step) => step.id)).toEqual(["doctor-step"]);
  });

  it("rejects mixed top-level command phases and legacy lifecycle", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/commands",
        install: [{ id: "install-step", run: "mkdir -p .opendock" }],
        lifecycle: {
          install: [{ id: "legacy-step", run: "mkdir -p .opendock" }],
        },
      }),
    );

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow(
      "use top-level `install`, `update`, and `doctor`",
    );
  });

  it("rejects unsafe package requirement names", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/requires",
        requires: {
          packages: {
            bad: {
              manager: "bun",
              name: "oh-my-agent;rm",
              version: ">=1.0.0",
            },
          },
        },
      }),
    );

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow(
      "package name must be a safe package identifier",
    );
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

  it("installs missing required packages before lifecycle steps run", async () => {
    const project = tempDir();
    const bin = tempDir();
    const home = tempDir();
    const log = join(project, "commands.log");
    writeFakeBun(bin, home, log);
    const manifest = omaManifest({
      install: [
        {
          id: "apply-oma",
          run: "oma -y install",
          workdir: "dock",
          platforms: {},
          export: {
            include: ["AGENTS.md"],
            exclude: [],
          },
        },
      ],
    });

    const result = await withEnv(
      { BUN_INSTALL: join(home, ".bun"), HOME: home, PATH: bin },
      async () =>
        new LifecycleRunner().run(manifest, {
          projectDir: project,
          dockId: "test/oma",
          phase: "install",
          platform: "macos",
          live: false,
        }),
    );

    expect(result.reports.map((report) => `${report.id}:${report.status}`)).toEqual([
      "require-runtime-bun:Ready",
      "require-package-oma:Ran",
      "apply-oma:Ran",
    ]);
    expect(result.exports.map((candidate) => candidate.path)).toEqual(["AGENTS.md"]);
    expect(readFileSync(log, "utf8")).toContain("bun:install --global oh-my-agent@latest");
    expect(
      readFileSync(join(project, ".opendock", "workdirs", "test__oma", "AGENTS.md"), "utf8"),
    ).toContain("Generated by fake OMA");
  });

  it("reruns required package installers on update even when the package already exists", async () => {
    const project = tempDir();
    const bin = tempDir();
    const home = tempDir();
    const log = join(project, "commands.log");
    writeBunPackage(home, "oh-my-agent", "8.43.0");
    writeFakeBun(bin, home, log);
    writeFakeOma(bin, log);

    const result = await withEnv(
      { BUN_INSTALL: join(home, ".bun"), HOME: home, PATH: bin },
      async () =>
        new LifecycleRunner().run(omaManifest(), {
          projectDir: project,
          dockId: "test/oma",
          phase: "update",
          platform: "macos",
          live: false,
        }),
    );

    expect(result.reports.map((report) => `${report.id}:${report.status}`)).toEqual([
      "require-runtime-bun:Ready",
      "require-package-oma:Ran",
    ]);
    expect(readFileSync(log, "utf8")).toContain("bun:install --global oh-my-agent@latest");
  });

  it("checks requirements during doctor without installing missing packages", () => {
    const project = tempDir();
    const bin = tempDir();
    const home = tempDir();
    const log = join(project, "commands.log");
    writeFakeBun(bin, home, log);

    const result = withEnvSync({ BUN_INSTALL: join(home, ".bun"), HOME: home, PATH: bin }, () =>
      new LifecycleRunner().run(omaManifest(), {
        projectDir: project,
        dockId: "test/oma",
        phase: "doctor",
        platform: "macos",
        live: false,
      }),
    );

    expect(result.reports).toMatchObject([
      { id: "require-runtime-bun", status: "Ready" },
      { id: "require-package-oma", status: "Failed" },
    ]);
    expect(readFileSync(log, "utf8")).not.toContain("install --global");
  });

  it("uses package manager metadata when the package key differs from package name", async () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeNpm(bin, log);

    const result = await withEnv({ PATH: bin }, async () =>
      new LifecycleRunner().run(customPackageKeyManifest(), {
        projectDir: project,
        dockId: "test/custom-package-key",
        phase: "install",
        platform: "macos",
        live: false,
      }),
    );

    expect(result.reports.map((report) => `${report.id}:${report.status}`)).toEqual([
      "require-package-workspace:Ran",
    ]);
    expect(readFileSync(log, "utf8")).toContain(
      "npm:install --global @acme/workspace-tools@latest",
    );
    expect(readFileSync(log, "utf8")).toContain(
      "npm:list --global --json --depth=0 @acme/workspace-tools",
    );
    expect(readFileSync(log, "utf8")).not.toContain("acme:--version");
  });

  it("rejects unsupported package requirement fields", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "dock.yml"),
      YAML.stringify({
        opendock: 1,
        id: "test/requires",
        requires: {
          packages: {
            oma: {
              manager: "bun",
              name: "oh-my-agent",
              version: ">=8.43.0",
              command: "oma",
            },
          },
        },
      }),
    );

    expect(() => parseManifestFile(join(root, "dock.yml"))).toThrow("Unrecognized key");
  });
});

function omaManifest(lifecycle: Partial<DockManifest["lifecycle"]> = {}): DockManifest {
  return {
    opendock: 1,
    id: "test/oma",
    summary: "",
    requires: {
      runtimes: {
        bun: ">=1.3.0",
      },
      packages: {
        oma: {
          manager: "bun",
          name: "oh-my-agent",
          version: ">=8.43.0",
        },
      },
    },
    files: [],
    lifecycle: {
      install: lifecycle.install ?? [],
      update: lifecycle.update ?? [],
      doctor: lifecycle.doctor ?? [],
    },
  };
}

function customPackageKeyManifest(): DockManifest {
  return {
    opendock: 1,
    id: "test/custom-package-key",
    summary: "",
    requires: {
      runtimes: {},
      packages: {
        workspace: {
          manager: "npm",
          name: "@acme/workspace-tools",
          version: ">=1.2.0",
        },
      },
    },
    files: [],
    lifecycle: {
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

function writeFakeBun(bin: string, home: string, log: string): void {
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
  /bin/mkdir -p "${home}/.bun/install/global/node_modules/oh-my-agent"
  /bin/cat > "${home}/.bun/install/global/node_modules/oh-my-agent/package.json" <<'EOF'
{"name":"oh-my-agent","version":"8.43.0"}
EOF
  /bin/cat > "${bin}/oma" <<'EOF'
#!/bin/sh
set -eu
printf 'oma:%s\\n' "$*" >> "${log}"
if [ "$1" = "--version" ]; then
  printf '8.43.0\\n'
  exit 0
fi
if [ "$*" = "-y install" ]; then
  printf '# Generated by fake OMA\\n' > AGENTS.md
  exit 0
fi
if [ "$*" = "-y update" ] || [ "$1" = "doctor" ]; then
  exit 0
fi
EOF
  /bin/chmod +x "${bin}/oma"
  exit 0
fi
exit 1
`,
  );
}

function writeFakeNpm(bin: string, log: string): void {
  writeExecutable(
    join(bin, "npm"),
    `#!/bin/sh
set -eu
printf 'npm:%s\\n' "$*" >> "${log}"
if [ "$1" = "--version" ]; then
  printf '10.9.0\\n'
  exit 0
fi
if [ "$1" = "list" ]; then
  if [ -f "${bin}/workspace-tools-installed" ]; then
    printf '{"dependencies":{"@acme/workspace-tools":{"version":"1.2.3"}}}\\n'
    exit 0
  fi
  exit 1
fi
if [ "$1" = "install" ]; then
  /usr/bin/touch "${bin}/workspace-tools-installed"
  exit 0
fi
exit 1
`,
  );
}

function writeBunPackage(home: string, name: string, version: string): void {
  const packagePath = join(home, ".bun", "install", "global", "node_modules", name);
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(join(packagePath, "package.json"), JSON.stringify({ name, version }));
}

function writeFakeOma(bin: string, log: string): void {
  writeExecutable(
    join(bin, "oma"),
    `#!/bin/sh
set -eu
printf 'oma:%s\\n' "$*" >> "${log}"
if [ "$1" = "--version" ]; then
  printf '8.43.0\\n'
  exit 0
fi
if [ "$1" = "doctor" ]; then
  exit 0
fi
`,
  );
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const restore = applyEnv(env);
  try {
    return await fn();
  } finally {
    restore();
  }
}

function withEnvSync<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  const restore = applyEnv(env);
  try {
    return fn();
  } finally {
    restore();
  }
}

function applyEnv(env: NodeJS.ProcessEnv): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
