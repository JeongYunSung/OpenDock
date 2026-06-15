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
import { afterEach, describe, expect, it } from "vitest";
import { DockInstaller } from "../src/core/app/dock-installer.js";
import { DockRef, parseManifestFile } from "../src/core/domain/manifest.js";
import { OpenDockStateStore } from "../src/core/domain/state-store.js";
import { safeDockDirectoryName } from "../src/core/files/path-utils.js";
import type { OpenDockPlatform } from "../src/platform.js";
import type { ResolvedDock } from "../src/resolver.js";

interface ExampleDock {
  id: string;
  manifestFile: string;
  platform: "macos" | "windows";
  root: string;
}

const testVersion = "1.0.0";
const stressTestTimeoutMs = 20_000;
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("example dock cleanup behavior", () => {
  it("installs and uninstalls every platform example without leaving managed folders behind", async () => {
    for (const example of discoverExampleDocks()) {
      const project = tempDir();
      await installExample(example, project);
      const records = installedRecords(project, example.id);
      expect(
        installedDocks(project).map((dock) => dock.id),
        exampleLabel(example),
      ).toContain(example.id);

      uninstallExample(example, project);

      for (const record of records) {
        expect(
          existsSync(join(project, record.path)),
          `${exampleLabel(example)}:${record.path}`,
        ).toBe(false);
      }
      expect(nonStateEntries(project), exampleLabel(example)).toEqual([]);
      expect(installedDocks(project), exampleLabel(example)).toEqual([]);
    }
  });

  it(
    "installs and uninstalls all examples repeatedly per platform",
    async () => {
      for (const platform of ["macos", "windows"] as const) {
        const examples = discoverExampleDocks().filter((example) => example.platform === platform);
        const project = tempDir();

        for (let cycle = 1; cycle <= 3; cycle += 1) {
          for (const example of examples) {
            await installExample(example, project);
          }
          expect(
            installedDocks(project)
              .map((dock) => dock.id)
              .sort(),
          ).toEqual(examples.map((example) => example.id).sort());

          for (const example of examples.toReversed()) {
            uninstallExample(example, project);
          }

          expect(nonStateEntries(project), `${platform} cycle ${cycle}`).toEqual([]);
          expect(installedDocks(project), `${platform} cycle ${cycle}`).toEqual([]);
        }
      }
    },
    stressTestTimeoutMs,
  );

  it("preserves user files in directories that also contain managed example files", async () => {
    const example = requireExample("opendock/agent-ready", "macos");
    const project = tempDir();
    mkdirSync(join(project, ".github", "instructions"), { recursive: true });
    mkdirSync(join(project, ".cursor", "rules"), { recursive: true });
    writeFileSync(join(project, "AGENTS.md"), "# Existing project agent note\n");
    writeFileSync(join(project, ".github", "keep.md"), "# User GitHub note\n");
    writeFileSync(join(project, ".cursor", "rules", "user.mdc"), "# User Cursor rule\n");

    await installExample(example, project);
    uninstallExample(example, project);

    expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toBe(
      "# Existing project agent note\n",
    );
    expect(existsSync(join(project, ".github", "instructions"))).toBe(false);
    expect(readFileSync(join(project, ".github", "keep.md"), "utf8")).toBe("# User GitHub note\n");
    expect(existsSync(join(project, ".cursor", "rules"))).toBe(true);
    expect(readFileSync(join(project, ".cursor", "rules", "user.mdc"), "utf8")).toBe(
      "# User Cursor rule\n",
    );
    expect(installedDocks(project)).toEqual([]);
  });

  it("cleans exported task outputs from the oma example", async () => {
    const example = requireExample("opendock/oma", "macos");
    const project = tempDir();
    const bin = tempDir();
    writeFakeBun(bin);
    writeFakeOma(bin);

    await withEnv(
      {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      },
      () => installExample(example, project, { runTasks: true }),
    );

    expect(existsSync(join(project, ".agents", "skills", "oma-brainstorm", "SKILL.md"))).toBe(true);
    expect(existsSync(join(project, ".codex", "agents", "reviewer.toml"))).toBe(true);
    expect(existsSync(join(project, ".codex", "skills", "oma-brainstorm", "SKILL.md"))).toBe(true);
    expect(
      readFileSync(join(project, ".codex", "skills", "oma-brainstorm", "SKILL.md"), "utf8"),
    ).toSatisfy((content: string) => content.startsWith("---\nname: oma-brainstorm"));
    expect(readFileSync(join(project, ".codex", "hooks.json"), "utf8")).toContain("oma-hook.sh");
    expect(readFileSync(join(project, ".claude", "settings.json"), "utf8")).toContain(
      "oma-hook.sh",
    );
    expect(readFileSync(join(project, ".claude", "agents", "reviewer.md"), "utf8")).toContain(
      "Claude Agent",
    );
    expect(existsSync(join(project, ".claude", "hooks", "oma-hook.sh"))).toBe(true);
    expect(isExecutable(join(project, ".codex", "hooks", "oma-hook.sh"))).toBe(true);
    expect(isExecutable(join(project, ".claude", "hooks", "oma-hook.sh"))).toBe(true);
    expect(existsSync(join(project, ".github", "instructions", "oma.instructions.md"))).toBe(true);
    expect(existsSync(join(project, ".agents", "cache", "ignored.log"))).toBe(false);
    expect(
      existsSync(join(project, ".opendock", "workdirs", safeDockDirectoryName("opendock/oma"))),
    ).toBe(true);

    uninstallExample(example, project);

    expect(
      existsSync(join(project, ".opendock", "workdirs", safeDockDirectoryName("opendock/oma"))),
    ).toBe(false);
    expect(nonStateEntries(project)).toEqual([]);
    expect(installedDocks(project)).toEqual([]);
  });

  it("rejects unmanaged file conflicts before writing any example files", async () => {
    const example = requireExample("opendock/agent-safety", "macos");
    const project = tempDir();
    writeFileSync(join(project, ".gitleaks.toml"), "# user-owned gitleaks config\n");
    writeFileSync(join(project, "KEEP.txt"), "do not touch\n");

    await expect(installExample(example, project)).rejects.toThrow(
      "target already exists and is not OpenDock-owned",
    );

    expect(readFileSync(join(project, ".gitleaks.toml"), "utf8")).toBe(
      "# user-owned gitleaks config\n",
    );
    expect(readFileSync(join(project, "KEEP.txt"), "utf8")).toBe("do not touch\n");
    expect(existsSync(join(project, ".github"))).toBe(false);
    expect(installedDocks(project)).toEqual([]);
  });
});

async function installExample(
  example: ExampleDock,
  projectDir: string,
  options: { runTasks?: boolean } = {},
): Promise<void> {
  await new DockInstaller().install({
    dockRef: DockRef.parse(`${example.id}@${testVersion}`),
    projectDir,
    operation: "install",
    phase: "install",
    platform: example.platform,
    runTasks: options.runTasks ?? false,
    resolve: localExampleResolver(example),
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
      manifest: parseManifestFile(example.manifestFile),
      version: testVersion,
      platform,
      root: example.root,
      checksum: `${example.id}-${example.platform}-${testVersion}-checksum`,
      signature: "test-signature",
    };
  };
}

function discoverExampleDocks(): ExampleDock[] {
  const examplesRoot = join(process.cwd(), "examples");
  return readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const root = join(examplesRoot, entry.name);
      return (["macos", "windows"] as const)
        .map((platform) => ({
          manifestFile: join(root, `dock.${platform}.yml`),
          platform,
          root,
        }))
        .filter((candidate) => existsSync(candidate.manifestFile))
        .map((candidate) => ({
          ...candidate,
          id: parseManifestFile(candidate.manifestFile).id,
        }));
    })
    .sort((a, b) => exampleLabel(a).localeCompare(exampleLabel(b)));
}

function requireExample(id: string, platform: "macos" | "windows"): ExampleDock {
  const example = discoverExampleDocks().find(
    (candidate) => candidate.id === id && candidate.platform === platform,
  );
  if (!example) {
    throw new Error(`missing example ${id} for ${platform}`);
  }
  return example;
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

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-examples-test-"));
  tempRoots.push(dir);
  return dir;
}

function exampleLabel(example: ExampleDock): string {
  return `${example.id} [${example.platform}]`;
}

function writeFakeOma(bin: string): void {
  const omaPath = join(bin, "oma");
  writeFileSync(
    omaPath,
    `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *install*)
    test -f .agents/oma-config.yaml
    grep -q 'model_preset: codex' .agents/oma-config.yaml
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
  writeFileSync(
    bunPath,
    `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  --version)
    printf '1.3.11\\n'
    ;;
  install\\ --global\\ oh-my-agent@latest)
    exit 0
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
