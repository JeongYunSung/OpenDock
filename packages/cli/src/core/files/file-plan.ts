import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs";
import type { AppliedFileRecord } from "../domain/state-store.js";
import { fileChecksum, sha256Bytes, textChecksum } from "./checksum.js";
import type { FileCandidate } from "./file-candidate.js";
import { ManagedBlockCodec } from "./managed-block.js";
import {
  assertRegularOrMissing,
  ensureParentDirectory,
  ensureSafeParent,
  pruneEmptyParentDirectories,
  safeJoin,
} from "./path-utils.js";

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
