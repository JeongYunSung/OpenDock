import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManifestFile } from "../src/core/domain/manifest.js";

const examplesRoot = join(process.cwd(), "examples");

describe("example dock manifests", () => {
  it("uses platform-specific manifest files for every example", () => {
    for (const example of exampleNames()) {
      const root = join(examplesRoot, example);

      expect(existsSync(join(root, "dock.yml")), `${example} should not use dock.yml`).toBe(false);
      expect(existsSync(join(root, "dock.macos.yml")), `${example} macOS manifest`).toBe(true);
      expect(existsSync(join(root, "dock.windows.yml")), `${example} Windows manifest`).toBe(true);
    }
  });

  it("keeps all example manifests internally complete", () => {
    for (const example of exampleNames()) {
      for (const file of ["dock.macos.yml", "dock.windows.yml"]) {
        const root = join(examplesRoot, example);
        const manifest = parseManifestFile(join(root, file));

        expect(manifest.id, `${example}/${file} id`).toBe(`opendock/${example}`);
        if (manifest.readme) {
          expect(existsSync(join(root, manifest.readme)), `${example}/${file} readme`).toBe(true);
        }
        if (manifest.logo) {
          expect(existsSync(join(root, manifest.logo)), `${example}/${file} logo`).toBe(true);
        }
        for (const mapping of manifest.files) {
          expect(existsSync(join(root, mapping.from)), `${example}/${file} ${mapping.from}`).toBe(
            true,
          );
        }
        for (const mapping of manifest.workdir?.files ?? []) {
          expect(existsSync(join(root, mapping.from)), `${example}/${file} ${mapping.from}`).toBe(
            true,
          );
        }
      }
    }
  });

  it("does not put Unix file-test commands in Windows manifests", () => {
    for (const example of exampleNames()) {
      const manifest = parseManifestFile(join(examplesRoot, example, "dock.windows.yml"));
      const commands = [
        ...commandsFor(manifest.tasks.install),
        ...commandsFor(manifest.tasks.update),
        ...commandsFor(manifest.tasks.doctor),
      ];

      expect(
        commands.some((command) => command.startsWith("test ")),
        example,
      ).toBe(false);
    }
  });

  it("keeps production-ready workspace examples provisionable for common agents", () => {
    for (const example of workspaceExampleNames()) {
      const root = join(examplesRoot, example);
      const skillName = `opendock-${example}`;
      const requiredSources = [
        "files/AGENTS.md",
        "files/CLAUDE.md",
        "files/GEMINI.md",
        `files/.agents/skills/${skillName}/SKILL.md`,
        `files/.codex/skills/${skillName}/SKILL.md`,
        `files/.claude/skills/${skillName}/SKILL.md`,
        `files/.cursor/rules/${skillName}.mdc`,
        "files/README.md",
      ];

      for (const source of requiredSources) {
        expect(existsSync(join(root, source)), `${example} ${source}`).toBe(true);
      }

      const readme = readFileSync(join(root, "files", "README.md"), "utf8");
      for (const heading of [
        "## Installed Agent Context",
        "## Start Here",
        "## Common Workflows",
        "## Quality Checks",
        "## Useful Prompts",
      ]) {
        expect(readme, `${example} README ${heading}`).toContain(heading);
      }

      for (const file of ["dock.macos.yml", "dock.windows.yml"]) {
        const manifest = parseManifestFile(join(root, file));
        for (const source of requiredSources) {
          expect(
            manifest.files.some((mapping) => mapping.from === source),
            `${example}/${file} ${source}`,
          ).toBe(true);
        }
      }
    }
  });

  it("links every simple workspace example to its pro addon", () => {
    for (const example of simpleWorkspaceExampleNames()) {
      const root = join(examplesRoot, example);
      const proExample = `${example}-pro`;
      const proUrl = `https://hub.opendock.app/docks/opendock/${proExample}`;

      expect(readFileSync(join(root, "DOCK.md"), "utf8"), `${example} DOCK pro link`).toContain(
        proUrl,
      );
      expect(
        readFileSync(join(root, "files", "README.md"), "utf8"),
        `${example} README pro link`,
      ).toContain(proUrl);
    }
  });
});

function exampleNames(): string[] {
  return readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function workspaceExampleNames(): string[] {
  const toolOnly = new Set(["claude-code", "codex", "oma"]);
  return exampleNames().filter((example) => !toolOnly.has(example));
}

function simpleWorkspaceExampleNames(): string[] {
  return workspaceExampleNames().filter((example) => !example.endsWith("-pro"));
}

function commandsFor(
  steps: Array<{ check?: string | undefined; run?: string | undefined }>,
): string[] {
  return steps.flatMap((step) =>
    [step.check, step.run].filter((value): value is string => !!value),
  );
}
