import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManifestFile } from "../src/core/domain/manifest.js";
import { validateManifestTaskCommands } from "../src/core/runtime/task-command-validation.js";
import type { OpenDockPlatform } from "../src/platform.js";

const examplesRoot = join(process.cwd(), "examples");
const platformManifests: Array<{ file: string; platform: OpenDockPlatform }> = [
  { file: "dock.macos.yml", platform: "macos" },
  { file: "dock.windows.yml", platform: "windows" },
];

describe("OpenDock quality contracts", () => {
  it("keeps shipped CLI docs aligned with current commands and dependency modes", () => {
    const docs = [
      join(process.cwd(), "..", "..", "README.md"),
      ...[
        "README.md",
        "README.ko.md",
        "README.ja.md",
        "README.zh.md",
        "README.es.md",
        "README.fr.md",
        "README.de.md",
        "docs/guides/guide.md",
        "docs/guides/guide.ko.md",
        "docs/guides/guide.ja.md",
        "docs/guides/guide.zh.md",
        "docs/guides/guide.es.md",
        "docs/guides/guide.fr.md",
        "docs/guides/guide.de.md",
      ].map((path) => join(process.cwd(), path)),
    ];

    for (const file of docs) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file} should not document removed bootstrap command`).not.toMatch(
        /\bopendock\s+bootstrap\b|\bbootstrap\.ts\b/i,
      );
      expect(text, `${file} should not document removed dependency modes`).not.toMatch(
        /mode:\s*(?:ci|sync)\b|supports `ci`|supports `sync`/i,
      );
      expect(text, `${file} should document current dependency modes`).toMatch(/`install`/);
      expect(text, `${file} should document current dependency modes`).toMatch(/`locked`/);
      if (file.includes("docs/guides/guide")) {
        expect(text, `${file} should include a uv tool declaration example`).toMatch(
          /manager:\s*uv/,
        );
      } else {
        expect(text, `${file} should mention uv support`).toMatch(/\buv\b/);
      }
      expect(text, `${file} should explain tools vs dependencies`).toMatch(/`tools`/);
      expect(text, `${file} should explain tools vs dependencies`).toMatch(/`dependencies`/);
    }
  });

  it("keeps every bundled example manifest executable under the command policy", () => {
    for (const example of exampleNames()) {
      for (const { file, platform } of platformManifests) {
        const manifestPath = join(examplesRoot, example, file);
        const manifest = parseManifestFile(manifestPath);

        expect(
          () => validateManifestTaskCommands(manifest, platform),
          `${example}/${file}`,
        ).not.toThrow();
      }
    }
  });

  it("keeps bundled manifests free of removed interactive and run-command patterns", () => {
    for (const example of exampleNames()) {
      for (const { file } of platformManifests) {
        const manifestPath = join(examplesRoot, example, file);
        const manifestText = readFileSync(manifestPath, "utf8");

        expect(manifestText, `${example}/${file} should not use legacy id`).not.toMatch(/^id:/m);
        expect(manifestText, `${example}/${file} should not use opendock run`).not.toMatch(
          /\bopendock\s+run\b/i,
        );
        expect(
          manifestText,
          `${example}/${file} should not automate interactive key input`,
        ).not.toMatch(/^\s*(inputs|key|repeat)\s*:/m);
      }
    }
  });

  it("keeps bundled example docs from telling agents to bypass OpenDock managed checks", () => {
    const unsafePatterns = [
      /\bopendock\s+run\b/i,
      /\bnode\s+\.opendock\/harness\b/i,
      /\bpython3?\s+\.opendock\/harness\b/i,
      /\bsh\s+\.opendock\/harness\b/i,
      /\bpowershell\b.*\.opendock[\\/]+harness/i,
    ];

    for (const file of textFiles(examplesRoot)) {
      const text = readFileSync(file, "utf8");
      for (const pattern of unsafePatterns) {
        expect(text, `${file} should not contain ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

function exampleNames(): string[] {
  return readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function textFiles(root: string): string[] {
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && isTextFile(path)) {
        result.push(path);
      }
    }
  }
  return result.sort();
}

function isTextFile(path: string): boolean {
  if (!existsSync(path) || statSync(path).size > 256_000) {
    return false;
  }
  return /\.(?:json|md|mdc|toml|txt|ya?ml)$/u.test(path);
}
