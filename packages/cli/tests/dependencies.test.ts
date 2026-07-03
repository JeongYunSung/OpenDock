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
import YAML from "yaml";
import { DockInstaller } from "../src/core/app/dock-installer.js";
import { DockRef, manifestForRef, parseManifestFile } from "../src/core/domain/manifest.js";
import { OpenDockStateStore } from "../src/core/domain/state-store.js";
import { DependencyRunner } from "../src/core/runtime/dependency-runner.js";
import type { ResolvedDock } from "../src/resolver.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("dock dependencies", () => {
  it("installs dependencies after managed files and removes generated dependency folders", async () => {
    const docks = tempDir();
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/sharp/package.json");
    writeDock(docks, "test", "image2html", "1.0.0", {
      dependencies: {
        image2html: {
          manager: "npm",
          path: ".codex/skills/image2html",
          mode: "ci",
        },
      },
      files: [
        { path: ".codex/skills/image2html/SKILL.md", content: "# Image2HTML\n" },
        { path: ".codex/skills/image2html/package.json", content: '{"name":"image2html"}\n' },
        { path: ".codex/skills/image2html/package-lock.json", content: '{"lockfileVersion":3}\n' },
      ],
    });

    await withEnvAsync({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DockInstaller().install({
        dockRef: DockRef.parse("test/image2html@1.0.0"),
        projectDir: project,
        phase: "install",
        platform: "macos",
        live: false,
        runTasks: true,
        resolve: localResolver(docks),
      }),
    );

    const dependencyPath = join(realpathSync(project), ".codex", "skills", "image2html");
    expect(readFileSync(log, "utf8")).toContain(`npm:${dependencyPath}:ci --no-audit --no-fund`);
    expect(existsSync(join(dependencyPath, "node_modules", "sharp", "package.json"))).toBe(true);
    expect(new OpenDockStateStore(project).readLock().docks[0]?.dependencies).toEqual([
      {
        manager: "npm",
        mode: "ci",
        name: "image2html",
        path: ".codex/skills/image2html",
      },
    ]);

    new DockInstaller().uninstall({
      dockId: "test/image2html",
      projectDir: project,
      force: false,
    });

    expect(existsSync(dependencyPath)).toBe(false);
  });

  it("runs supported dependency managers with manager-specific modes", () => {
    const project = tempDir();
    const bin = tempDir();
    const log = join(project, "commands.log");
    writeFakeDependencyManager(bin, "npm", log, "node_modules/npm.txt");
    writeFakeDependencyManager(bin, "pnpm", log, "node_modules/pnpm.txt");
    writeFakeDependencyManager(bin, "bun", log, "node_modules/bun.txt");
    writeFakeDependencyManager(bin, "uv", log, ".venv/uv.txt");
    writeFakePip(bin, "pip", log);
    writeFakePip(bin, "pip3", log);
    for (const name of ["npm-deps", "pnpm-deps", "bun-deps", "uv-deps", "pip-deps", "pip3-deps"]) {
      mkdirSync(join(project, "deps", name), { recursive: true });
      writeFileSync(join(project, "deps", name, "package.json"), "{}\n");
      writeFileSync(join(project, "deps", name, "requirements.txt"), "demo==1.0.0\n");
      writeFileSync(join(project, "deps", name, "pyproject.toml"), "[project]\nname='demo'\n");
    }
    const manifest = manifestForRef(
      parseManifestText({
        opendock: 1,
        dependencies: {
          npm: { manager: "npm", path: "deps/npm-deps", mode: "install" },
          pnpm: { manager: "pnpm", path: "deps/pnpm-deps" },
          bun: { manager: "bun", path: "deps/bun-deps" },
          uv: { manager: "uv", path: "deps/uv-deps" },
          pip: { manager: "pip", path: "deps/pip-deps" },
          pip3: { manager: "pip3", path: "deps/pip3-deps" },
        },
      }),
      DockRef.parse("test/deps@1.0.0"),
    );

    const result = withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      new DependencyRunner().run(manifest, {
        projectDir: project,
        dockId: "test/deps",
        phase: "install",
        platform: "macos",
        live: false,
      }),
    );

    expect(result.reports.every((report) => report.status === "Ready")).toBe(true);
    expect(result.dependencies.map((dependency) => dependency.name).sort()).toEqual([
      "bun",
      "npm",
      "pip",
      "pip3",
      "pnpm",
      "uv",
    ]);
    expect(readFileSync(log, "utf8")).toContain("npm:");
    expect(readFileSync(log, "utf8")).toContain("pnpm:");
    expect(readFileSync(log, "utf8")).toContain("bun:");
    expect(readFileSync(log, "utf8")).toContain("uv:");
    expect(readFileSync(log, "utf8")).toContain("pip:");
    expect(readFileSync(log, "utf8")).toContain("pip3:");
    expect(existsSync(join(project, "deps", "uv-deps", ".venv", "uv.txt"))).toBe(true);
    expect(existsSync(join(project, "deps", "pip-deps", ".opendock", "python", "pip.txt"))).toBe(
      true,
    );
    expect(existsSync(join(project, "deps", "pip3-deps", ".opendock", "python", "pip3.txt"))).toBe(
      true,
    );
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-dependencies-test-"));
  tempRoots.push(dir);
  return dir;
}

function parseManifestText(manifest: Record<string, unknown>) {
  const root = tempDir();
  writeFileSync(join(root, "dock.yml"), YAML.stringify(manifest));
  return parseManifestFile(join(root, "dock.yml"));
}

function writeDock(
  root: string,
  owner: string,
  name: string,
  version: string,
  options: {
    dependencies?: Record<string, unknown>;
    files: Array<{ content: string; path: string }>;
  },
): void {
  const dockRoot = join(root, `${owner}-${name}-${version}`);
  mkdirSync(join(dockRoot, "files"), { recursive: true });
  for (const file of options.files) {
    const filePath = join(dockRoot, "files", file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content);
  }
  writeFileSync(
    join(dockRoot, "dock.yml"),
    YAML.stringify({
      opendock: 1,
      summary: "",
      dependencies: options.dependencies ?? {},
      files: options.files.map((file) => ({
        from: `files/${file.path}`,
        to: file.path,
      })),
    }),
  );
}

function localResolver(root: string) {
  return (dockRef: DockRef): ResolvedDock => {
    const dockRoot = join(root, `${dockRef.owner}-${dockRef.name}-${dockRef.requested()}`);
    return {
      manifest: manifestForRef(parseManifestFile(join(dockRoot, "dock.yml")), dockRef),
      version: dockRef.requested(),
      platform: "macos",
      root: dockRoot,
      checksum: `${dockRef.id()}-${dockRef.requested()}-checksum`,
      signature: "test-signature",
    };
  };
}

function writeFakeDependencyManager(
  bin: string,
  command: "bun" | "npm" | "pnpm" | "uv",
  log: string,
  output: string,
): void {
  writeExecutable(
    join(bin, command),
    `#!/bin/sh
set -eu
printf '${command}:%s:%s\\n' "$PWD" "$*" >> "${log}"
if [ "$1" = "--version" ]; then
  printf '1.0.0\\n'
  exit 0
fi
mkdir -p "$(dirname "${output}")"
printf '${command}\\n' > "${output}"
`,
  );
}

function writeFakePip(bin: string, command: "pip" | "pip3", log: string): void {
  writeExecutable(
    join(bin, command),
    `#!/bin/sh
set -eu
printf '${command}:%s:%s\\n' "$PWD" "$*" >> "${log}"
target=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--target" ]; then
    shift
    target="$1"
  fi
  shift || true
done
if [ -z "$target" ]; then
  exit 2
fi
mkdir -p "$target"
printf '${command}\\n' > "$target/${command}.txt"
`,
  );
}

function writeExecutable(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function withEnv<T>(env: Record<string, string | undefined>, callback: () => T): T {
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
    return callback();
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

async function withEnvAsync<T>(
  env: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
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
