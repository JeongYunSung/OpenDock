import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { isCommandRunnerName } from "./core/domain/command-runners.js";
import type { DockManifest } from "./core/domain/manifest.js";
import { isShellCommandSeparator } from "./core/domain/shell-operators.js";
import {
  assertRegularOrMissing,
  assertSafeRelativePath,
  normalizeRelativePath,
  safeJoin,
} from "./core/files/path-utils.js";
import {
  assertCommandRunnerMatchesFile,
  parseRunCommandName,
  resolveCommandSource,
} from "./verified-command.js";

export function validateDeployCommands(projectDir: string, manifest: DockManifest): void {
  for (const [name, command] of Object.entries(manifest.commands)) {
    parseRunCommandName(name);
    const file = assertSafeRelativePath(command.file, `command \`${name}\` file`);
    assertCommandRunnerMatchesFile(command.runner, file);
    const source = resolveCommandSource(manifest, file);
    const sourcePath = safeJoin(projectDir, source, `command \`${name}\` source`);
    assertRegularOrMissing(sourcePath, source);
    if (!existsSync(sourcePath)) {
      throw new Error(`command \`${name}\` source does not exist: ${source}`);
    }
  }
}

export function validateDeployCommandText(
  projectDir: string,
  manifest: DockManifest,
  entries: string[],
  manifestText: string,
): void {
  const commands = Object.entries(manifest.commands);
  if (commands.length === 0) {
    return;
  }
  for (const entry of entries) {
    if (!isDeployTextPolicyFile(entry)) {
      continue;
    }
    const content =
      entry === "dock.yml"
        ? manifestText
        : readFileSync(safeJoin(projectDir, entry, "deploy text policy file"), "utf8");
    for (const [name, command] of commands) {
      const file = normalizeRelativePath(command.file);
      const directInvocation = directRuntimeInvocation(content, file);
      if (directInvocation) {
        throw new Error(
          `deploy text \`${entry}\` must use \`opendock run ${name}\` instead of \`${directInvocation}\``,
        );
      }
    }
  }
}

function isDeployTextPolicyFile(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return [".json", ".md", ".mdc", ".toml", ".txt", ".yaml", ".yml"].includes(extension);
}

function directRuntimeInvocation(content: string, file: string): string | undefined {
  const normalizedFile = normalizeRelativePath(file);
  const fileTokens = new Set([normalizedFile, `./${normalizedFile}`]);
  for (const line of content.replaceAll("\\", "/").split(/\r?\n/)) {
    const tokens = deployTextTokens(line);
    for (const [index, token] of tokens.entries()) {
      if (!isCommandRunnerName(token)) {
        continue;
      }
      for (const next of tokens.slice(index + 1)) {
        if (isShellCommandSeparator(next)) {
          break;
        }
        if (fileTokens.has(next)) {
          return `${token} ${file}`;
        }
      }
    }
  }
  return undefined;
}

function deployTextTokens(line: string): string[] {
  return line
    .split(/\s+/)
    .map((token) => token.replace(/^[`"'([{]+/, "").replace(/[.`,"')\]}:;]+$/, ""))
    .filter((token) => token !== "");
}
