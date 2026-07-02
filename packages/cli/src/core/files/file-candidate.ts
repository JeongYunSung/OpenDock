import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { basename, extname, relative } from "node:path";
import type { ManagedMode } from "../domain/state-store.js";
import {
  assertSafeManagedFileTargetPath,
  assertSafeRelativePath,
  listRegularFiles,
  normalizeRelativePath,
  safeJoin,
  toPosixPath,
} from "./path-utils.js";

export interface FileCandidate {
  path: string;
  mode: ManagedMode;
  markerId?: string;
  source: "files" | "export";
  content: Buffer;
  executable: boolean;
}

interface FileMapping {
  sourceRoot: string;
  from: string;
  to: string;
  source: "files" | "export";
  markerPrefix: string;
}

const blockableExtensions = new Set([".md", ".mdc", ".txt"]);
const blockableNames = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);

export class FileCandidateCollector {
  collectMappings(mappings: FileMapping[]): FileCandidate[] {
    return mappings.flatMap((mapping) => this.collectMapping(mapping));
  }

  collectExport(
    workdir: string,
    include: string[],
    exclude: string[],
    markerPrefix: string,
  ): FileCandidate[] {
    return listRegularFiles(workdir, "", { symlinks: "follow-internal" })
      .filter((path) => matchesAny(path, include))
      .filter((path) => !matchesAny(path, exclude))
      .map((path) => this.candidateFromFile(workdir, path, path, "export", markerPrefix));
  }

  private collectMapping(mapping: FileMapping): FileCandidate[] {
    const from = assertSafeRelativePath(mapping.from, "file source");
    const to = assertSafeManagedFileTargetPath(mapping.to, "file target");
    const sourcePath = safeJoin(mapping.sourceRoot, from, "file source");
    if (!existsSync(sourcePath)) {
      throw new Error(`file mapping source does not exist: ${from}`);
    }
    const stat = lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`file mapping source cannot be a symlink: ${from}`);
    }
    if (stat.isFile()) {
      return [
        this.candidateFromFile(mapping.sourceRoot, from, to, mapping.source, mapping.markerPrefix),
      ];
    }
    if (!stat.isDirectory()) {
      throw new Error(`file mapping source must be a regular file or directory: ${from}`);
    }

    const targetRoot = normalizeRelativePath(to);
    return listRegularFiles(sourcePath, from).map((sourceRel) => {
      const childRel = toPosixPath(relative(sourcePath, safeJoin(mapping.sourceRoot, sourceRel)));
      return this.candidateFromFile(
        mapping.sourceRoot,
        sourceRel,
        normalizeRelativePath(`${targetRoot}/${childRel}`),
        mapping.source,
        mapping.markerPrefix,
      );
    });
  }

  private candidateFromFile(
    root: string,
    sourcePath: string,
    targetPath: string,
    source: "files" | "export",
    markerPrefix: string,
  ): FileCandidate {
    const path = assertSafeManagedFileTargetPath(targetPath, "file target");
    const content = readFileSync(safeJoin(root, sourcePath, "file source"));
    const candidate: FileCandidate = {
      path,
      mode: isBlockablePath(path) ? "managed_block" : "managed_file",
      source,
      content,
      executable: isExecutable(safeJoin(root, sourcePath, "file source")),
    };
    if (candidate.mode === "managed_block") {
      candidate.markerId = `${markerPrefix}:${path}`;
    }
    return candidate;
  }
}

function isBlockablePath(path: string): boolean {
  if (isAgentRuntimePath(path)) {
    return false;
  }
  return blockableExtensions.has(extname(path)) || blockableNames.has(basename(path));
}

function isAgentRuntimePath(path: string): boolean {
  return (
    path.startsWith(".agents/") ||
    path.startsWith(".claude/") ||
    path.startsWith(".codex/") ||
    path.startsWith(".cursor/") ||
    path.startsWith(".gemini/") ||
    path === ".github/copilot-instructions.md" ||
    path.startsWith(".github/instructions/") ||
    path.startsWith(".kiro/") ||
    path.startsWith(".qwen/")
  );
}

function isExecutable(path: string): boolean {
  return (statSync(path).mode & 0o111) !== 0;
}

function matchesAny(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => globMatches(path, pattern));
}

function globMatches(path: string, pattern: string): boolean {
  const normalizedPath = normalizeRelativePath(path);
  const normalizedPattern = normalizeRelativePath(pattern);
  if (normalizedPattern === "**" || normalizedPattern === "*") {
    return true;
  }
  if (normalizedPattern === normalizedPath) {
    return true;
  }
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  if (!normalizedPattern.includes("*")) {
    return false;
  }
  return new RegExp(`^${globToRegex(normalizedPattern)}$`).test(normalizedPath);
}

function globToRegex(pattern: string): string {
  let output = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      output += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      output += "[^/]*";
      continue;
    }
    output += escapeRegex(char ?? "");
  }
  return output;
}

function escapeRegex(char: string): string {
  return /[.+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}
