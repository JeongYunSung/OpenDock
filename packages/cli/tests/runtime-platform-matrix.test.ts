import { spawnSync } from "node:child_process";
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
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import type { DockManifest } from "../src/core/domain/manifest.js";
import { CommandRunner } from "../src/core/runtime/command-runner.js";
import { RequirementRunner } from "../src/core/runtime/requirement-runner.js";
import {
  OpenDockRuntimeInstaller,
  type RuntimeInstaller,
  selectBunRelease,
  selectUvRelease,
} from "../src/core/runtime/runtime-installer.js";
import type { OpenDockPlatform } from "../src/platform.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runtime platform matrix", () => {
  it("keeps managed Node 22 and Node 24 in separate shared runtime directories", async () => {
    const home = realpathSync(tempDir());
    const project = tempDir();
    const dist = tempDir();
    const pathBin = tempDir();
    const releases = [
      await writeNodeDist(dist, "v22.12.0", "10.9.0"),
      await writeNodeDist(dist, "v24.4.0", "11.2.0"),
    ];
    writeNodeIndex(dist, releases);

    const installer = new OpenDockRuntimeInstaller();
    const [node22, node24] = await withEnv(
      {
        HOME: home,
        OPENDOCK_NODE_DIST_BASE_URL: `file://${dist}`,
        OPENDOCK_NODE_DIST_INDEX_URL: `file://${join(dist, "index.json")}`,
        PATH: `${pathBin}:/usr/bin:/bin`,
      },
      () => [
        installer.install({
          platform: "macos",
          projectDir: project,
          requested: ">=22.0.0 <23.0.0",
          runtime: "node",
        }),
        installer.install({
          platform: "macos",
          projectDir: project,
          requested: ">=24.0.0 <25.0.0",
          runtime: "node",
        }),
      ],
    );

    const node22Bin = join(home, ".opendock", "runtimes", "node", "22.12.0", "bin", "node");
    const node24Bin = join(home, ".opendock", "runtimes", "node", "24.4.0", "bin", "node");
    expect(node22).toMatchObject({
      path: join(home, ".opendock", "runtimes", "node", "22.12.0", "bin"),
    });
    expect(node24).toMatchObject({
      path: join(home, ".opendock", "runtimes", "node", "24.4.0", "bin"),
    });
    expect(existsSync(node22Bin)).toBe(true);
    expect(existsSync(node24Bin)).toBe(true);
    expect(spawnSync(node22Bin, ["--version"], { encoding: "utf8" }).stdout.trim()).toBe(
      "v22.12.0",
    );
    expect(spawnSync(node24Bin, ["--version"], { encoding: "utf8" }).stdout.trim()).toBe("v24.4.0");
  });

  it("adds the managed Node runtime bin to PATH for npm wrappers", async () => {
    const home = realpathSync(tempDir());
    const project = tempDir();
    const dist = tempDir();
    const pathBin = tempDir();
    const npmNodeLog = join(project, "npm-node.log");
    writeNodeIndex(dist, [await writeNodeDist(dist, "v24.5.0", "11.1.0", { npmNodeLog })]);

    const result = await withEnv(
      {
        HOME: home,
        OPENDOCK_NODE_DIST_BASE_URL: `file://${dist}`,
        OPENDOCK_NODE_DIST_INDEX_URL: `file://${join(dist, "index.json")}`,
        PATH: `${pathBin}:/usr/bin:/bin`,
      },
      () =>
        new OpenDockRuntimeInstaller().install({
          platform: "macos",
          projectDir: project,
          requested: ">=11.0.0 <12.0.0",
          runtime: "npm",
        }),
    );

    const npmRun = spawnSync(result?.targets.npm ?? "", ["--version"], {
      encoding: "utf8",
      env: { HOME: home, PATH: "/usr/bin:/bin" },
    });

    expect(npmRun.status).toBe(0);
    expect(npmRun.stdout.trim()).toBe("11.1.0");
    expect(readFileSync(npmNodeLog, "utf8")).toBe("v24.5.0\n");
  });

  it("selects Bun release artifacts for macOS, Windows, and Linux", async () => {
    const matrix: Array<{
      archive: string;
      platform: OpenDockPlatform;
      version: string;
      withArch?: string;
    }> = [
      {
        archive: `bun-darwin-${process.arch === "arm64" ? "aarch64" : "x64"}.zip`,
        platform: "macos",
        version: "9.1.0",
      },
      {
        archive: "bun-windows-x64.zip",
        platform: "windows",
        version: "9.2.0",
        withArch: "x64",
      },
      {
        archive: `bun-linux-${process.arch === "arm64" ? "aarch64" : "x64"}.zip`,
        platform: "linux",
        version: "9.3.0",
      },
    ];
    const releases = matrix.map(({ archive, version }) => ({
      assets: [{ name: archive }],
      tag_name: `bun-v${version}`,
    }));

    for (const { archive, version } of matrix) {
      expect(selectBunRelease(releases, `=${version}`, { archiveName: archive })?.tag_name).toBe(
        `bun-v${version}`,
      );
      expect(
        selectBunRelease(releases, `=${version}`, { archiveName: "wrong-platform.zip" }),
      ).toBeUndefined();
    }

    const curlBin = tempDir();
    const dist = tempDir();
    const downloadLog = join(dist, "downloads.log");
    writeFakeCurl(curlBin, downloadLog);
    writeFakePowershell(curlBin);
    writeFileSync(join(dist, "releases.json"), JSON.stringify(releases));
    for (const { archive, version } of matrix) {
      const tag = `bun-v${version}`;
      mkdirSync(join(dist, tag), { recursive: true });
      writeFileSync(join(dist, tag, archive), "");
    }

    for (const { archive, platform, version, withArch } of matrix) {
      const home = realpathSync(tempDir());
      await withEnv(
        {
          HOME: home,
          OPENDOCK_BUN_DIST_BASE_URL: `file://${dist}`,
          OPENDOCK_BUN_RELEASES_URL: `file://${join(dist, "releases.json")}`,
          PATH: curlBin,
        },
        () =>
          withProcessProperty("arch", withArch ?? process.arch, () => {
            const result = new OpenDockRuntimeInstaller().install({
              platform,
              projectDir: tempDir(),
              requested: `=${version}`,
              runtime: "bun",
            });
            expect(result).toMatchObject({
              commands: ["bun"],
              source: "managed",
              version,
            });
          }),
      );
      expect(readFileSync(downloadLog, "utf8")).toContain(`/bun-v${version}/${archive}`);
    }
  });

  it("installs managed uv for Python and uses the OpenDock home uv environment", async () => {
    const home = realpathSync(tempDir());
    const dist = tempDir();
    const curlBin = tempDir();
    const fakeBin = tempDir();
    const fakePython = join(fakeBin, "python-managed");
    const uvLog = join(home, "uv.log");
    writeFakePython(fakePython);
    const uvRelease = await writeUvDist(dist, "0.11.26", fakePython, uvLog);
    writeFileSync(join(dist, "releases.json"), JSON.stringify([uvRelease]));
    writeFakeCurl(curlBin, join(dist, "downloads.log"));

    const [python, pip] = await withEnv(
      {
        HOME: home,
        OPENDOCK_UV_DIST_BASE_URL: `file://${dist}`,
        OPENDOCK_UV_RELEASES_URL: `file://${join(dist, "releases.json")}`,
        PATH: `${curlBin}:/usr/bin:/bin`,
      },
      () => {
        const installer = new OpenDockRuntimeInstaller();
        return [
          installer.install({
            platform: "macos",
            projectDir: tempDir(),
            requested: ">=3.12.0 <3.13.0",
            runtime: "python",
          }),
          installer.install({
            platform: "macos",
            projectDir: tempDir(),
            requested: ">=24.0.0 <25.0.0",
            runtime: "pip",
          }),
        ];
      },
    );

    expect(python).toMatchObject({
      commands: ["python"],
      path: join(home, ".opendock", "runtimes", "python", "3.12.9", "bin"),
      source: "managed",
      version: "3.12.9",
    });
    expect(pip).toMatchObject({
      commands: ["pip"],
      path: join(home, ".opendock", "runtimes", "pip", "24.2.0", "bin"),
      source: "managed",
      version: "24.2.0",
    });

    const expectedUvInstallDir = join(
      home,
      ".opendock",
      "runtimes",
      "python",
      "_uv",
      "installations",
    );
    expect(readFileSync(uvLog, "utf8")).toContain(`UV_PYTHON_INSTALL_DIR=${expectedUvInstallDir}`);
  });

  it("selects uv release artifacts for macOS, Windows, and Linux", () => {
    const releases = [
      {
        assets: [
          { name: "uv-aarch64-apple-darwin.tar.gz" },
          { name: "uv-x86_64-pc-windows-msvc.zip" },
          { name: "uv-x86_64-unknown-linux-gnu.tar.gz" },
        ],
        tag_name: "0.11.26",
      },
    ];

    expect(
      selectUvRelease(releases, ">=0.11.0", {
        archiveName: "uv-aarch64-apple-darwin.tar.gz",
        compression: "tar-gz",
      })?.tag_name,
    ).toBe("0.11.26");
    expect(
      selectUvRelease(releases, ">=0.12.0", {
        archiveName: "uv-aarch64-apple-darwin.tar.gz",
        compression: "tar-gz",
      }),
    ).toBeUndefined();
    expect(
      selectUvRelease(releases, ">=0.11.0", {
        archiveName: "uv-aarch64-unknown-linux-musl.tar.gz",
        compression: "tar-gz",
      }),
    ).toBeUndefined();
  });

  it("keeps project shims separate while reusing the shared managed runtime store", async () => {
    const home = realpathSync(tempDir());
    const projectA = tempDir();
    const projectB = tempDir();
    const dist = tempDir();
    const hostBin = tempDir();
    const version = "v22.12.0";
    const release = await writeNodeDist(dist, version, "10.9.0");
    writeNodeIndex(dist, [release]);
    writeFakeRuntime(hostBin, "node", "v21.9.0");

    const env = {
      HOME: home,
      OPENDOCK_NODE_DIST_BASE_URL: `file://${dist}`,
      OPENDOCK_NODE_DIST_INDEX_URL: `file://${join(dist, "index.json")}`,
      PATH: `${hostBin}:/usr/bin:/bin`,
    };

    await withEnv(env, () =>
      new RequirementRunner(new CommandRunner(), new OpenDockRuntimeInstaller()).run(
        runtimeManifest("node", ">=22.0.0 <23.0.0"),
        { phase: "install", platform: "macos", projectDir: projectA },
      ),
    );
    rmSync(release.archivePath, { force: true });
    await withEnv(env, () =>
      new RequirementRunner(new CommandRunner(), new OpenDockRuntimeInstaller()).run(
        runtimeManifest("node", ">=22.0.0 <23.0.0"),
        { phase: "install", platform: "macos", projectDir: projectB },
      ),
    );

    const sharedNode = join(home, ".opendock", "runtimes", "node", "22.12.0", "bin", "node");
    const shimA = join(projectA, ".opendock", "bin", "node");
    const shimB = join(projectB, ".opendock", "bin", "node");
    expect(existsSync(sharedNode)).toBe(true);
    expect(existsSync(shimA)).toBe(true);
    expect(existsSync(shimB)).toBe(true);
    expect(shimA).not.toBe(shimB);
    expect(readFileSync(shimA, "utf8")).toContain(sharedNode);
    expect(readFileSync(shimB, "utf8")).toContain(sharedNode);
  });

  it("uses managed install when an existing host runtime is below the required range", async () => {
    const project = tempDir();
    const hostBin = tempDir();
    const managedBin = tempDir();
    const managedTarget = join(managedBin, "node");
    writeFakeRuntime(hostBin, "node", "v21.9.0");
    writeFakeRuntime(managedBin, "node", "v22.12.0");

    const installRequests: Array<{ requested: string; runtime: string }> = [];
    const installer: RuntimeInstaller = {
      install(request) {
        installRequests.push({ requested: request.requested, runtime: request.runtime });
        return {
          commands: ["node"],
          path: managedBin,
          requested: request.requested,
          source: "managed",
          targets: { node: managedTarget },
          version: "22.12.0",
        };
      },
    };

    const result = await withEnv({ PATH: `${hostBin}:/usr/bin:/bin` }, () =>
      new RequirementRunner(new CommandRunner(), installer).run(
        runtimeManifest("node", ">=22.0.0 <23.0.0"),
        { phase: "install", platform: "macos", projectDir: project },
      ),
    );

    expect(installRequests).toEqual([{ requested: ">=22.0.0 <23.0.0", runtime: "node" }]);
    expect(result.runtimes[0]).toMatchObject({
      commands: ["node"],
      source: "managed",
      version: "22.12.0",
    });
    expect(readFileSync(join(project, ".opendock", "bin", "node"), "utf8")).toContain(
      managedTarget,
    );
  });
});

function runtimeManifest(runtime: "node", version: string): DockManifest {
  return {
    opendock: 1,
    id: "test/runtime-platform-matrix",
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
  const dir = mkdtempSync(join(tmpdir(), "opendock-runtime-platform-"));
  tempRoots.push(dir);
  return dir;
}

async function writeNodeDist(
  dist: string,
  version: string,
  npmVersion: string,
  options: { npmNodeLog?: string } = {},
): Promise<{ archivePath: string; files: string[]; npm: string; version: string }> {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const releaseDir = join(dist, version);
  const archiveRoot = `node-${version}-darwin-${arch}`;
  const archiveParent = tempDir();
  const archiveRootPath = join(archiveParent, archiveRoot);
  mkdirSync(join(archiveRootPath, "bin"), { recursive: true });
  mkdirSync(releaseDir, { recursive: true });
  writeExecutable(
    join(archiveRootPath, "bin", "node"),
    `#!/bin/sh
if [ "\${1:-}" = "--version" ] || [ "\${1:-}" = "-v" ] || [ "\${1:-}" = "-V" ]; then
  printf '${version}\\n'
  exit 0
fi
printf '${version}\\n'
`,
  );
  writeExecutable(
    join(archiveRootPath, "bin", "npm"),
    `#!/bin/sh
set -eu
${options.npmNodeLog ? `node --version > "${options.npmNodeLog}"` : "node --version >/dev/null"}
if [ "\${1:-}" = "--version" ] || [ "\${1:-}" = "-v" ] || [ "\${1:-}" = "-V" ]; then
  printf '${npmVersion}\\n'
  exit 0
fi
printf '${npmVersion}\\n'
`,
  );
  const archivePath = join(releaseDir, `${archiveRoot}.tar.gz`);
  await createTar({ cwd: archiveParent, file: archivePath, gzip: true }, [archiveRoot]);
  return {
    archivePath,
    files: [`osx-${arch}-tar`],
    npm: npmVersion,
    version,
  };
}

async function writeUvDist(
  dist: string,
  version: string,
  pythonPath: string,
  log: string,
): Promise<{ assets: Array<{ name: string }>; tag_name: string }> {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const archiveRoot = `uv-${arch}-apple-darwin`;
  const archiveParent = tempDir();
  const archiveRootPath = join(archiveParent, archiveRoot);
  mkdirSync(archiveRootPath, { recursive: true });
  mkdirSync(join(dist, version), { recursive: true });
  writeFakeUv(archiveRootPath, pythonPath, log);
  const archiveName = `${archiveRoot}.tar.gz`;
  await createTar({ cwd: archiveParent, file: join(dist, version, archiveName), gzip: true }, [
    archiveRoot,
  ]);
  return {
    assets: [{ name: archiveName }],
    tag_name: version,
  };
}

function writeNodeIndex(
  dist: string,
  releases: Array<{ files: string[]; npm: string; version: string }>,
): void {
  writeFileSync(
    join(dist, "index.json"),
    JSON.stringify(releases.map(({ files, npm, version }) => ({ files, npm, version }))),
  );
}

function writeFakeCurl(bin: string, log: string): void {
  writeExecutable(
    join(bin, "curl"),
    `#!/bin/sh
set -eu
url=""
out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      shift
      out="$1"
      ;;
    -*)
      ;;
    *)
      url="$1"
      ;;
  esac
  shift
done
printf '%s\\n' "$url" >> "${log}"
case "$url" in
  file://*)
    path="\${url#file://}"
    if [ -n "$out" ]; then
      /bin/cp "$path" "$out"
    else
      /bin/cat "$path"
    fi
    ;;
  *)
    printf 'network URL blocked in test: %s\\n' "$url" >&2
    exit 1
    ;;
esac
`,
  );
}

function writeFakePowershell(bin: string): void {
  writeExecutable(
    join(bin, "powershell"),
    `#!/bin/sh
set -eu
command=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-Command" ]; then
    shift
    command="$1"
    break
  fi
  shift
done
archive=$(printf '%s' "$command" | /usr/bin/sed -n 's/.*-LiteralPath "\\([^"]*\\)".*/\\1/p')
destination=$(printf '%s' "$command" | /usr/bin/sed -n 's/.*-DestinationPath "\\([^"]*\\)".*/\\1/p')
name="\${archive##*/}"
name="\${name%.zip}"
/bin/mkdir -p "$destination/$name"
/bin/cat > "$destination/$name/bun" <<'EOF'
#!/bin/sh
printf 'bun fake\\n'
EOF
/bin/chmod +x "$destination/$name/bun"
`,
  );
}

function writeFakeUv(bin: string, pythonPath: string, log: string): void {
  writeExecutable(
    join(bin, "uv"),
    `#!/bin/sh
set -eu
printf 'args:%s\\n' "$*" >> "${log}"
printf 'UV_PYTHON_INSTALL_DIR=%s\\n' "$UV_PYTHON_INSTALL_DIR" >> "${log}"
if [ "$1" = "python" ] && [ "$2" = "install" ]; then
  exit 0
fi
if [ "$1" = "python" ] && [ "$2" = "find" ]; then
  printf '${pythonPath}\\n'
  exit 0
fi
exit 1
`,
  );
}

function writeFakePython(path: string): void {
  writeExecutable(
    path,
    `#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ]; then
  printf 'Python 3.12.9\\n'
  exit 0
fi
if [ "\${1:-}" = "-m" ] && [ "\${2:-}" = "ensurepip" ]; then
  exit 0
fi
if [ "\${1:-}" = "-m" ] && [ "\${2:-}" = "pip" ] && [ "\${3:-}" = "--version" ]; then
  printf 'pip 24.2.0 from fake (python 3.12)\\n'
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

async function withProcessProperty<T>(
  property: "arch" | "platform",
  value: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, property);
  Object.defineProperty(process, property, { configurable: true, value });
  try {
    return await fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(process, property, descriptor);
    }
  }
}
