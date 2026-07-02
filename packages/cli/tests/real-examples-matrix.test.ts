import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { run as runCli } from "../src/cli.js";
import { DockInstaller } from "../src/core/app/dock-installer.js";
import { DockRef, manifestForRef, parseManifestFile } from "../src/core/domain/manifest.js";
import { OpenDockStateStore } from "../src/core/domain/state-store.js";
import { safeDockDirectoryName } from "../src/core/files/path-utils.js";
import { validateManifestTaskCommands } from "../src/core/runtime/task-command-validation.js";
import type { OpenDockPlatform } from "../src/platform.js";
import type { ResolvedDock } from "../src/resolver.js";

vi.mock("../src/resolver.js", async () => {
  const path = await import("node:path");
  const url = await import("node:url");
  const manifest = await import("../src/core/domain/manifest.js");
  const examplesRoot = path.resolve(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "..",
    "examples",
  );
  return {
    resolveDock: vi.fn((dockRef: DockRef, platform: OpenDockPlatform): ResolvedDock => {
      const root = path.join(examplesRoot, dockRef.name);
      const manifestFile = path.join(root, `dock.${platform}.yml`);
      return {
        checksum: `${dockRef.id()}-${platform}-${dockRef.requested()}-checksum`,
        manifest: manifest.manifestForRef(manifest.parseManifestFile(manifestFile), dockRef),
        platform,
        root,
        signature: "test-signature",
        version: dockRef.requested(),
      };
    }),
  };
});

interface ExampleDock {
  id: string;
  manifestFile: string;
  name: string;
  platform: OpenDockPlatform;
  root: string;
}

const examplesRoot = join(process.cwd(), "examples");
const testVersion = "1.0.0";
const supportedPlatforms = ["macos", "windows"] as const;
const staticSmokeExamples = ["agent-ready", "frontend-ai", "qa-engineer"] as const;
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("real example dock registry matrix", () => {
  it("parses every platform manifest and rejects legacy manifest fields", () => {
    for (const example of exampleNames()) {
      const root = join(examplesRoot, example);
      expect(existsSync(join(root, "dock.yml")), `${example} legacy dock.yml`).toBe(false);

      for (const platform of supportedPlatforms) {
        const manifestFile = join(root, `dock.${platform}.yml`);
        const rawManifest = parseYamlObject(manifestFile);
        const unsupportedFields = Object.keys(rawManifest).filter(
          (field) => !currentTopLevelManifestFields.has(field),
        );

        expect(unsupportedFields, `${example}/${platform} unsupported fields`).toEqual([]);
        for (const field of legacyTopLevelManifestFields) {
          expect(rawManifest, `${example}/${platform} ${field}`).not.toHaveProperty(field);
        }

        const manifest = manifestForRef(
          parseManifestFile(manifestFile),
          DockRef.parse(`opendock/${example}@${testVersion}`),
        );
        validateManifestTaskCommands(manifest, platform);

        expect(manifest.id, `${example}/${platform} id`).toBe(`opendock/${example}`);
        expect(manifest.tags.length, `${example}/${platform} tags`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps platform metadata, docs, and payload mappings complete", () => {
    for (const example of exampleNames()) {
      const root = join(examplesRoot, example);
      const platformManifests = supportedPlatforms.map((platform) => ({
        manifest: parseManifestFile(join(root, `dock.${platform}.yml`)),
        platform,
      }));
      const [baseline] = platformManifests;
      expect(baseline, `${example} baseline manifest`).toBeDefined();

      for (const { manifest, platform } of platformManifests) {
        expect(manifest.readme, `${example}/${platform} readme`).toBe("DOCK.md");
        expect(manifest.logo, `${example}/${platform} logo`).toBe("logo.png");
        expect(manifest.tags, `${example}/${platform} tags`).toEqual(baseline?.manifest.tags);
        expect(existsSync(join(root, manifest.readme ?? "")), `${example}/${platform} readme`).toBe(
          true,
        );
        expect(existsSync(join(root, manifest.logo ?? "")), `${example}/${platform} logo`).toBe(
          true,
        );

        const dockReadme = readFileSync(join(root, "DOCK.md"), "utf8");
        expect(dockReadme, `${example}/${platform} install ref`).toContain(
          `opendock/${example}@${testVersion}`,
        );
        if (existsSync(join(root, "files", "README.md"))) {
          expect(dockReadme, `${example}/${platform} README handoff`).toContain("README.md");
        }

        const mappedSources = new Set([
          ...manifest.files.map((mapping) => mapping.from),
          ...(manifest.workdir?.files ?? []).map((mapping) => mapping.from),
        ]);
        for (const source of mappedSources) {
          expect(existsSync(join(root, source)), `${example}/${platform} ${source}`).toBe(true);
        }
        expect(
          unmappedPayloadFiles(root, "files", mappedSources),
          `${example}/${platform} files`,
        ).toEqual([]);
        expect(
          unmappedPayloadFiles(root, "workdir", mappedSources),
          `${example}/${platform} workdir`,
        ).toEqual([]);
      }
    }
  });

  it("installs expected static AI payload files and cleans them on uninstall", async () => {
    for (const example of discoverExampleDocks()) {
      const project = tempDir();
      const manifest = bindManifest(example);
      const expectedAiPaths = expectedAiPayloadTargets(manifest.files.map((mapping) => mapping.to));

      await installExample(example, project, { runTasks: false });

      const records = installedRecords(project, example.id);
      expect(records.map((record) => record.path).sort(), exampleLabel(example)).toEqual(
        manifest.files.map((mapping) => mapping.to).sort(),
      );

      for (const target of expectedAiPaths) {
        expect(existsSync(join(project, target)), `${exampleLabel(example)} ${target}`).toBe(true);
      }
      for (const mapping of manifest.files) {
        expectInstalledPayload(project, example.root, mapping);
      }

      uninstallExample(example, project);

      for (const record of records) {
        expect(
          existsSync(join(project, record.path)),
          `${exampleLabel(example)} ${record.path}`,
        ).toBe(false);
      }
      expect(nonStateEntries(project), exampleLabel(example)).toEqual([]);
      expect(installedDocks(project), exampleLabel(example)).toEqual([]);
    }
  });

  it("generates and removes dynamic OMA AI exports in the host-executable smoke path", async () => {
    const project = tempDir();
    const bin = tempDir();
    const example = requireExample("oma", "macos");
    writeFakeBun(bin);
    writeFakeOma(bin);

    await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () =>
      installExample(example, project, { runTasks: true }),
    );

    for (const target of [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      ".agents/skills/oma-brainstorm/SKILL.md",
      ".codex/agents/reviewer.toml",
      ".codex/skills/oma-brainstorm/SKILL.md",
      ".claude/agents/reviewer.md",
      ".github/instructions/oma.instructions.md",
    ]) {
      expect(existsSync(join(project, target)), `${exampleLabel(example)} ${target}`).toBe(true);
    }
    expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toContain("Generated by fake OMA");
    expect(existsSync(join(project, ".agents", "cache", "ignored.log"))).toBe(false);
    expect(isExecutable(join(project, ".codex", "hooks", "oma-hook.sh"))).toBe(true);
    expect(
      existsSync(join(project, ".opendock", "workdirs", safeDockDirectoryName(example.id))),
    ).toBe(true);

    await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, async () => {
      const logs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "doctor", example.id])),
      );
      expect(logs, `${exampleLabel(example)} doctor`).toContain(
        `✓ ${example.id}@${testVersion} [macos]`,
      );
      expect(logs.some((line) => line.includes("doctor checks unavailable"))).toBe(false);
      expect(logs.some((line) => line.startsWith("!"))).toBe(false);
    });

    uninstallExample(example, project);
    expect(nonStateEntries(project), exampleLabel(example)).toEqual([]);
    expect(installedDocks(project), exampleLabel(example)).toEqual([]);
  });

  it("keeps list, doctor, and uninstall stable after mixed example installs", async () => {
    for (const platform of supportedPlatforms) {
      const project = tempDir();
      const bin = tempDir();
      writeFakePowershell(bin);
      const examples = staticSmokeExamples.map((name) => requireExample(name, platform));

      for (const example of examples) {
        await installExample(example, project, { runTasks: false });
      }

      const listLogs = await withCwd(project, () =>
        captureConsole(() => runCli(["bun", "opendock", "list", "--json", "--summary"])),
      );
      const listJson = JSON.parse(listLogs[0] ?? "{}") as {
        summary?: { installed?: string[] };
      };
      expect(listJson.summary?.installed, `list ${platform}`).toEqual(
        examples.map((example) => example.id).sort(),
      );

      await withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, async () => {
        const doctorLogs = await withCwd(project, () =>
          captureConsole(() => runCli(["bun", "opendock", "doctor"])),
        );
        for (const example of examples) {
          expect(doctorLogs, `${exampleLabel(example)} doctor`).toContain(
            `✓ ${example.id}@${testVersion} [${platform}]`,
          );
        }
        expect(doctorLogs.some((line) => line.includes("doctor checks unavailable"))).toBe(false);
        expect(doctorLogs.some((line) => line.startsWith("!"))).toBe(false);
      });

      for (const example of examples.toReversed()) {
        const logs = await withCwd(project, () =>
          captureConsole(() =>
            runCli(["bun", "opendock", "uninstall", example.id, "--json", "--summary"]),
          ),
        );
        const output = JSON.parse(logs[0] ?? "{}") as {
          reports?: Array<{ dockId?: string; status?: string }>;
          success?: boolean;
        };
        expect(output.success, `${exampleLabel(example)} uninstall`).toBe(true);
        expect(output.reports?.[0]).toMatchObject({
          dockId: example.id,
          status: "uninstalled",
        });
      }

      expect(nonStateEntries(project), `mixed ${platform}`).toEqual([]);
      expect(installedDocks(project), `mixed ${platform}`).toEqual([]);
    }
  });

  it("does not carry legacy run commands or interactive prompts in examples", () => {
    for (const file of listExampleTextFiles()) {
      const content = readFileSync(file, "utf8");
      for (const { name, pattern } of legacyTextPatterns) {
        expect(content.match(pattern), `${file} ${name}`).toBeNull();
      }
    }

    for (const example of discoverExampleDocks()) {
      const manifest = bindManifest(example);
      for (const command of manifestTaskCommands(manifest)) {
        for (const { name, pattern } of legacyCommandPatterns) {
          expect(command.match(pattern), `${exampleLabel(example)} ${name}: ${command}`).toBeNull();
        }
      }
    }
  });
});

const currentTopLevelManifestFields = new Set([
  "doctor",
  "files",
  "install",
  "logo",
  "opendock",
  "permissions",
  "readme",
  "requires",
  "summary",
  "tags",
  "tools",
  "update",
  "workdir",
]);

const legacyTopLevelManifestFields = [
  "commands",
  "id",
  "kind",
  "lifecycle",
  "needs",
  "permission",
  "run",
  "schema",
  "supports",
  "version",
] as const;

const legacyTextPatterns = [
  { name: "opendock run", pattern: /\bopendock\s+run\b/i },
  { name: "interactive shell read", pattern: /\bread\s+-(?:p|r)\b/i },
  { name: "interactive key prompt", pattern: /\bpress\s+(?:any\s+)?(?:key|enter)\b/i },
  { name: "windows pause prompt", pattern: /\b(?:pause|choice\s+\/)\b/i },
] as const;

const legacyCommandPatterns = [
  { name: "opendock run", pattern: /\bopendock\s+run\b/i },
  { name: "interactive shell read", pattern: /\bread\s+-(?:p|r)\b/i },
  { name: "interactive prompt", pattern: /\b(?:pause|choice\s+\/)\b/i },
] as const;

function exampleNames(): string[] {
  return readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function discoverExampleDocks(): ExampleDock[] {
  return exampleNames().flatMap((name) => {
    const root = join(examplesRoot, name);
    return supportedPlatforms.map((platform) => ({
      id: `opendock/${name}`,
      manifestFile: join(root, `dock.${platform}.yml`),
      name,
      platform,
      root,
    }));
  });
}

function requireExample(name: string, platform: OpenDockPlatform): ExampleDock {
  const example = discoverExampleDocks().find(
    (candidate) => candidate.name === name && candidate.platform === platform,
  );
  if (!example) {
    throw new Error(`missing example ${name} for ${platform}`);
  }
  return example;
}

function bindManifest(example: ExampleDock) {
  return manifestForRef(
    parseManifestFile(example.manifestFile),
    DockRef.parse(`${example.id}@${testVersion}`),
  );
}

async function installExample(
  example: ExampleDock,
  projectDir: string,
  options: { runTasks: boolean },
): Promise<void> {
  await new DockInstaller().install({
    dockRef: DockRef.parse(`${example.id}@${testVersion}`),
    phase: "install",
    platform: example.platform,
    projectDir,
    resolve: localExampleResolver(example),
    runTasks: options.runTasks,
  });
}

function uninstallExample(example: ExampleDock, projectDir: string): void {
  new DockInstaller().uninstall({
    dockId: example.id,
    projectDir,
  });
}

function localExampleResolver(example: ExampleDock) {
  return (dockRef: DockRef, platform: OpenDockPlatform): ResolvedDock => {
    expect(dockRef.id()).toBe(example.id);
    expect(platform).toBe(example.platform);
    return {
      checksum: `${example.id}-${example.platform}-${testVersion}-checksum`,
      manifest: manifestForRef(parseManifestFile(example.manifestFile), dockRef),
      platform,
      root: example.root,
      signature: "test-signature",
      version: testVersion,
    };
  };
}

function installedDocks(projectDir: string) {
  return new OpenDockStateStore(projectDir).readLock().docks;
}

function installedRecords(projectDir: string, dockId: string) {
  return installedDocks(projectDir).find((dock) => dock.id === dockId)?.files ?? [];
}

function nonStateEntries(projectDir: string): string[] {
  const allowedStateEntries = new Set([
    ".opendock/",
    ".opendock/dock.lock.yml",
    ".opendock/project.yml",
  ]);
  return listEntries(projectDir).filter((entry) => !allowedStateEntries.has(entry));
}

function listEntries(root: string): string[] {
  const entries: string[] = [];
  function visit(current: string, relativePath: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const nextRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        entries.push(`${nextRelativePath}/`);
        visit(join(current, entry.name), nextRelativePath);
      } else {
        entries.push(nextRelativePath);
      }
    }
  }
  visit(root, "");
  return entries;
}

function unmappedPayloadFiles(
  root: string,
  payloadDir: string,
  mappedSources: Set<string>,
): string[] {
  const absolute = join(root, payloadDir);
  if (!existsSync(absolute)) {
    return [];
  }
  return listRegularFiles(absolute)
    .map((path) => `${payloadDir}/${path}`)
    .filter((path) => !mappedSources.has(path));
}

function listRegularFiles(root: string): string[] {
  const files: string[] = [];
  function visit(current: string, relativePath: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const nextRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(join(current, entry.name), nextRelativePath);
      } else {
        files.push(nextRelativePath);
      }
    }
  }
  visit(root, "");
  return files;
}

function listExampleTextFiles(): string[] {
  return discoverFiles(examplesRoot).filter((file) => !file.endsWith(".png"));
}

function discoverFiles(root: string): string[] {
  const files: string[] = [];
  function visit(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else {
        files.push(path);
      }
    }
  }
  visit(root);
  return files;
}

function parseYamlObject(path: string): Record<string, unknown> {
  const parsed = YAML.parse(readFileSync(path, "utf8"));
  expect(parsed, `${path} YAML object`).toBeTypeOf("object");
  expect(Array.isArray(parsed), `${path} YAML object`).toBe(false);
  return parsed as Record<string, unknown>;
}

function expectedAiPayloadTargets(paths: string[]): string[] {
  return paths.filter(
    (path) =>
      ["AGENTS.md", "CLAUDE.md", "GEMINI.md"].includes(path) ||
      path.startsWith(".agents/skills/") ||
      path.startsWith(".codex/agents/") ||
      path.startsWith(".codex/skills/") ||
      path.startsWith(".claude/agents/") ||
      path.startsWith(".claude/skills/"),
  );
}

function expectInstalledPayload(
  projectDir: string,
  exampleRoot: string,
  mapping: { from: string; to: string },
): void {
  const installed = join(projectDir, mapping.to);
  const source = readFileSync(join(exampleRoot, mapping.from), "utf8").trim();
  const content = readFileSync(installed, "utf8");
  expect(content, mapping.to).toContain(source);
}

function manifestTaskCommands(manifest: ReturnType<typeof bindManifest>): string[] {
  return Object.values(manifest.tasks).flatMap((steps) =>
    steps.flatMap((step) => [step.check, step.run].filter((value): value is string => !!value)),
  );
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-real-examples-test-"));
  tempRoots.push(dir);
  return dir;
}

function exampleLabel(example: ExampleDock): string {
  return `${example.id} [${example.platform}]`;
}

function writeFakePowershell(bin: string): void {
  const path = join(bin, "powershell");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    path,
    `#!/usr/bin/env bash
set -euo pipefail
command="\${4:-}"
if [[ "$command" =~ Test-Path[[:space:]]+-LiteralPath[[:space:]]+([A-Za-z0-9._/@-]+) ]]; then
  test -e "\${BASH_REMATCH[1]}"
  exit $?
fi
exit 1
`,
  );
  chmodSync(path, 0o755);
}

function writeFakeOma(bin: string): void {
  const omaPath = join(bin, "oma");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    omaPath,
    `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  --version)
    printf '9.9.9\\n'
    ;;
  *install*)
    test -f .agents/oma-config.yaml
    mkdir -p .agents/skills/oma-brainstorm .agents/workflows .agents/cache .codex/agents .codex/skills/oma-brainstorm .github/instructions
    printf '# OMA Agent\\n\\nGenerated by fake OMA.\\n' > AGENTS.md
    printf '# Gemini\\n' > GEMINI.md
    printf '# Skill\\n' > .agents/skills/oma-brainstorm/SKILL.md
    printf '# Architecture Workflow\\n' > .agents/workflows/architecture.md
    printf 'name = "reviewer"\\n' > .codex/agents/reviewer.toml
    printf '%s\\n' '---' 'name: oma-brainstorm' 'description: Codex Skill' '---' '# Codex Skill' > .codex/skills/oma-brainstorm/SKILL.md
    printf '# OMA Instructions\\n' > .github/instructions/oma.instructions.md
    printf 'ignore me\\n' > .agents/cache/ignored.log
    ;;
  *link*claude*codex*)
    mkdir -p .claude/agents .claude/hooks .claude/rules .codex/hooks
    printf '# Claude\\n' > CLAUDE.md
    printf '# Claude Agent\\n' > .claude/agents/reviewer.md
    printf '{ "hooks": { "UserPromptSubmit": "oma-hook.sh" } }\\n' > .claude/settings.json
    printf '#!/usr/bin/env bash\\n' > .claude/hooks/oma-hook.sh
    chmod +x .claude/hooks/oma-hook.sh
    printf '# Claude Rule\\n' > .claude/rules/project.md
    printf '{ "UserPromptSubmit": [".codex/hooks/oma-hook.sh"] }\\n' > .codex/hooks.json
    printf '#!/usr/bin/env bash\\n' > .codex/hooks/oma-hook.sh
    chmod +x .codex/hooks/oma-hook.sh
    ;;
  *doctor*)
    test -f AGENTS.md
    ;;
esac
`,
  );
  chmodSync(omaPath, 0o755);
}

function writeFakeBun(bin: string): void {
  const bunPath = join(bin, "bun");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    bunPath,
    `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  --version)
    printf '1.3.11\\n'
    ;;
  add\\ oh-my-agent@latest)
    mkdir -p node_modules/.bin
    cp "${bin}/oma" node_modules/.bin/oma
    cp "${bin}/oma" node_modules/.bin/oh-my-agent
    chmod +x node_modules/.bin/oma node_modules/.bin/oh-my-agent
    ;;
  *)
    exit 1
    ;;
esac
`,
  );
  chmodSync(bunPath, 0o755);
}

function isExecutable(path: string): boolean {
  return (statSync(path).mode & 0o111) !== 0;
}

async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
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

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

async function captureConsole(fn: () => Promise<void>): Promise<string[]> {
  const previous = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    await fn();
    return logs;
  } finally {
    console.log = previous;
  }
}
