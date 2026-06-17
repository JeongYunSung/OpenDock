import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, relative } from "node:path";
import type { AppliedFileRecord, ManagedMode } from "../domain/state-store.js";
import { fileChecksum, sha256Bytes, textChecksum } from "./checksum.js";
import { ManagedBlockCodec } from "./managed-block.js";
import {
  assertRegularOrMissing,
  assertSafeRelativePath,
  ensureParentDirectory,
  ensureSafeParent,
  listRegularFiles,
  normalizeRelativePath,
  pruneEmptyParentDirectories,
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

export interface FileApplySummary {
  created: number;
  createdPaths: string[];
  deleted: number;
  deletedPaths: string[];
  directoriesPruned: number;
  updated: number;
  updatedPaths: string[];
  reviewRequired: number;
  reviewRequiredPaths: string[];
  records: AppliedFileRecord[];
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
    const to = assertSafeRelativePath(mapping.to, "file target");
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
    const path = assertSafeRelativePath(targetPath, "file target");
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

export class FilePlan {
  constructor(
    private readonly projectDir: string,
    private readonly dockId: string,
    private readonly priorRecords: AppliedFileRecord[],
    private readonly force: boolean,
  ) {}

  verifyPriorState(): void {
    for (const record of this.priorRecords) {
      this.verifyRecord(record);
    }
  }

  preflight(candidates: FileCandidate[]): void {
    this.assertUniqueCandidates(candidates);
    for (const candidate of candidates) {
      this.preflightCandidate(candidate);
    }
  }

  apply(candidates: FileCandidate[]): FileApplySummary {
    const summary: FileApplySummary = {
      created: 0,
      createdPaths: [],
      deleted: 0,
      deletedPaths: [],
      directoriesPruned: 0,
      updated: 0,
      updatedPaths: [],
      reviewRequired: 0,
      reviewRequiredPaths: [],
      records: [],
    };
    const candidateKeys = new Set(candidates.map(candidateKey));
    for (const record of this.priorRecords) {
      if (!candidateKeys.has(recordKey(record))) {
        const result = this.removeRecord(record);
        if (result === "deleted") {
          summary.deleted += 1;
          summary.deletedPaths.push(record.path);
        }
        if (result === "updated") {
          summary.updated += 1;
          summary.updatedPaths.push(record.path);
        }
      }
    }

    for (const candidate of candidates) {
      const existed = existsSync(this.target(candidate.path));
      this.applyCandidate(candidate);
      if (existed) {
        summary.updated += 1;
        summary.updatedPaths.push(candidate.path);
      } else {
        summary.created += 1;
        summary.createdPaths.push(candidate.path);
      }
      summary.records.push(recordFromCandidate(candidate));
    }

    for (const path of summary.deletedPaths) {
      summary.directoriesPruned += pruneEmptyParentDirectories(this.projectDir, path);
    }

    return summary;
  }

  private verifyRecord(record: AppliedFileRecord): void {
    const target = this.target(record.path);
    if (record.mode === "managed_block") {
      if (!record.markerId) {
        throw new Error(`managed block record is missing marker id: ${record.path}`);
      }
      if (!existsSync(target)) {
        if (this.force) return;
        throw new Error(`managed block file missing: ${record.path}`);
      }
      const codec = new ManagedBlockCodec(this.dockId, record.markerId, record.path);
      const currentChecksum = codec.currentChecksum(target);
      if (currentChecksum === undefined) {
        if (this.force) return;
        throw new Error(`managed block missing: ${record.path}`);
      }
      if (currentChecksum !== record.checksum && !this.force) {
        throw new Error(`checksum mismatch for managed block ${record.path}`);
      }
      return;
    }

    if (!existsSync(target)) {
      if (this.force) return;
      throw new Error(`managed file missing: ${record.path}`);
    }
    if (fileChecksum(target) !== record.checksum && !this.force) {
      throw new Error(`checksum mismatch for managed file ${record.path}`);
    }
  }

  private preflightCandidate(candidate: FileCandidate): void {
    const target = this.target(candidate.path);
    ensureSafeParent(this.projectDir, candidate.path);
    assertRegularOrMissing(target, candidate.path);
    const prior = this.priorFor(candidate);
    if (candidate.mode === "managed_block") {
      if (prior !== undefined) {
        this.verifyRecord(prior);
      }
      return;
    }

    if (!existsSync(target)) {
      return;
    }
    if (prior !== undefined) {
      const currentChecksum = fileChecksum(target);
      if (currentChecksum !== prior.checksum && !this.force) {
        throw new Error(`checksum mismatch for managed file ${candidate.path}`);
      }
      return;
    }
    if (!this.force) {
      throw new Error(`target already exists and is not OpenDock-owned: ${candidate.path}`);
    }
  }

  private applyCandidate(candidate: FileCandidate): void {
    const target = this.target(candidate.path);
    ensureParentDirectory(this.projectDir, candidate.path);
    if (candidate.mode === "managed_block") {
      const markerId = requireMarkerId(candidate);
      new ManagedBlockCodec(this.dockId, markerId, candidate.path).upsert(
        target,
        candidate.content.toString("utf8"),
      );
      return;
    }
    writeFileSync(target, candidate.content);
    chmodSync(target, candidate.executable ? 0o755 : 0o644);
  }

  private removeRecord(record: AppliedFileRecord): "deleted" | "missing" | "updated" {
    const target = this.target(record.path);
    if (record.mode === "managed_block") {
      if (!record.markerId) {
        return "missing";
      }
      return new ManagedBlockCodec(this.dockId, record.markerId, record.path).remove(target);
    }
    if (existsSync(target)) {
      rmSync(target);
      return "deleted";
    }
    return "missing";
  }

  private priorFor(candidate: FileCandidate): AppliedFileRecord | undefined {
    return this.priorRecords.find((record) => recordKey(record) === candidateKey(candidate));
  }

  private assertUniqueCandidates(candidates: FileCandidate[]): void {
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const key = candidateKey(candidate);
      if (seen.has(key)) {
        throw new Error(`duplicate managed output: ${candidate.path}`);
      }
      seen.add(key);
    }
  }

  private target(path: string): string {
    return safeJoin(this.projectDir, path, "target");
  }
}

function recordFromCandidate(candidate: FileCandidate): AppliedFileRecord {
  return {
    path: candidate.path,
    mode: candidate.mode,
    checksum:
      candidate.mode === "managed_block"
        ? textChecksum(candidate.content.toString("utf8").trimEnd())
        : sha256Bytes(candidate.content),
    ...(candidate.markerId === undefined ? {} : { markerId: candidate.markerId }),
    source: candidate.source,
    ...(candidate.executable ? { executable: true } : {}),
  };
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

function candidateKey(candidate: FileCandidate): string {
  return candidate.mode === "managed_block"
    ? `${candidate.mode}:${candidate.markerId}:${candidate.path}`
    : `${candidate.mode}:${candidate.path}`;
}

function recordKey(record: AppliedFileRecord): string {
  return record.mode === "managed_block"
    ? `${record.mode}:${record.markerId}:${record.path}`
    : `${record.mode}:${record.path}`;
}

function requireMarkerId(candidate: FileCandidate): string {
  if (!candidate.markerId) {
    throw new Error(`managed block candidate missing marker id: ${candidate.path}`);
  }
  return candidate.markerId;
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
