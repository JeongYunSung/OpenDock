import { rmSync } from "node:fs";
import { relative } from "node:path";
import { appendRunLog } from "../../logging.js";
import { detectPlatform, type OpenDockPlatform } from "../../platform.js";
import type { ResolvedDock } from "../../resolver.js";
import { resolveDock } from "../../resolver.js";
import {
  assertVersionSatisfiesSelector,
  type DockManifest,
  type DockRef,
  type TaskPhase,
} from "../domain/manifest.js";
import { type InstalledDockRecord, OpenDockStateStore } from "../domain/state-store.js";
import {
  type FileApplySummary,
  FileCandidateCollector,
  FilePlan,
} from "../files/file-candidate.js";
import { pruneEmptyDirectoryChain } from "../files/path-utils.js";
import { WorkdirSeeder } from "../files/workdir-seeder.js";
import { type StepReport, TaskRunner } from "../runtime/task-runner.js";

type DockResolver = (
  dockRef: DockRef,
  platform: OpenDockPlatform,
) => Promise<ResolvedDock> | ResolvedDock;

export interface InstallOptions {
  dockRef: DockRef;
  force?: boolean;
  projectDir: string;
  runTasks: boolean;
  operation: string;
  phase?: TaskPhase;
  platform?: OpenDockPlatform;
  resolve?: DockResolver;
}

export interface InstallReport {
  dockId: string;
  fileChanges: FileChangeDetails;
  version: string;
  filesCreated: number;
  filesDeleted: number;
  filesReviewRequired: number;
  filesUpdated: number;
  platform: OpenDockPlatform;
  steps: StepReport[];
}

export interface FileChangeDetails {
  created: string[];
  deleted: string[];
  reviewRequired: string[];
  updated: string[];
}

export interface UninstallOptions {
  dockId: string;
  force?: boolean;
  projectDir: string;
}

export interface UninstallReport {
  dockId: string;
  filesDeleted: number;
  filesUpdated: number;
}

export class DockInstaller {
  constructor(
    private readonly taskRunner = new TaskRunner(),
    private readonly collector = new FileCandidateCollector(),
    private readonly workdirSeeder = new WorkdirSeeder(),
  ) {}

  async install(options: InstallOptions): Promise<InstallReport> {
    const platform = options.platform ?? detectPlatform();
    const resolved = await (options.resolve ?? resolveDock)(options.dockRef, platform);
    assertVersionSatisfiesSelector(resolved.version, options.dockRef.requested());
    const store = new OpenDockStateStore(options.projectDir);
    const priorDock = store.findDock(resolved.manifest.id);
    const force = options.force === true;
    const filePlan = new FilePlan(
      options.projectDir,
      resolved.manifest.id,
      priorDock?.files ?? [],
      force,
    );

    try {
      if (priorDock) {
        filePlan.verifyPriorState();
      }

      const fileCandidates = this.collectManifestFiles(resolved);
      this.seedWorkdir(options.projectDir, resolved);
      const taskResult = options.runTasks
        ? this.taskRunner.run(resolved.manifest, {
            projectDir: options.projectDir,
            dockId: resolved.manifest.id,
            phase: options.phase ?? "install",
            platform,
          })
        : { reports: [], exports: [] };
      const candidates = [...fileCandidates, ...taskResult.exports];

      filePlan.preflight(candidates);
      const fileSummary = filePlan.apply(candidates);

      store.saveDock(
        this.recordFor(
          options.projectDir,
          resolved.manifest,
          resolved.version,
          options.dockRef.requested(),
          resolved.checksum,
          resolved.signature,
          platform,
          fileSummary,
        ),
      );

      const report = this.reportFor(
        resolved.manifest.id,
        resolved.version,
        platform,
        fileSummary,
        taskResult.reports,
      );
      appendRunLog(
        options.projectDir,
        options.operation,
        report.dockId,
        "Success",
        `${report.dockId}@${report.version} (${report.filesCreated} created, ${report.filesUpdated} updated, ${report.filesDeleted} deleted, ${report.filesReviewRequired} review required)`,
      );
      return report;
    } catch (error) {
      appendRunLog(
        options.projectDir,
        options.operation,
        resolved.manifest.id,
        "Failure",
        (error as Error).message,
      );
      throw error;
    }
  }

  uninstall(options: UninstallOptions): UninstallReport {
    const store = new OpenDockStateStore(options.projectDir);
    const dock = store.findDock(options.dockId);
    if (!dock) {
      throw new Error(`dock \`${options.dockId}\` is not installed in this project`);
    }
    const filePlan = new FilePlan(options.projectDir, dock.id, dock.files, options.force === true);
    filePlan.verifyPriorState();
    const summary = filePlan.apply([]);
    const workdir = this.taskRunner.dockWorkdir(options.projectDir, dock.id);
    rmSync(workdir, {
      recursive: true,
      force: true,
    });
    pruneEmptyDirectoryChain(options.projectDir, relative(options.projectDir, workdir));
    store.removeDock(dock.id);
    appendRunLog(
      options.projectDir,
      "uninstall",
      dock.id,
      "Success",
      `${dock.id}@${dock.version} uninstalled (${summary.deleted} deleted, ${summary.updated} updated)`,
    );
    return {
      dockId: dock.id,
      filesDeleted: summary.deleted,
      filesUpdated: summary.updated,
    };
  }

  private collectManifestFiles(resolved: ResolvedDock) {
    return this.collector.collectMappings(
      resolved.manifest.files.map((file) => ({
        sourceRoot: resolved.root,
        from: file.from,
        to: file.to,
        source: "files" as const,
        markerPrefix: "files",
      })),
    );
  }

  private seedWorkdir(projectDir: string, resolved: ResolvedDock): void {
    this.workdirSeeder.seed(
      this.taskRunner.dockWorkdir(projectDir, resolved.manifest.id),
      (resolved.manifest.workdir?.files ?? []).map((file) => ({
        sourceRoot: resolved.root,
        from: file.from,
        to: file.to,
      })),
    );
  }

  private recordFor(
    projectDir: string,
    manifest: DockManifest,
    version: string,
    requested: string,
    checksum: string,
    signature: string,
    platform: OpenDockPlatform,
    fileSummary: FileApplySummary,
  ): InstalledDockRecord {
    const workdir = this.taskRunner.dockWorkdir(projectDir, manifest.id);
    return {
      id: manifest.id,
      name: manifest.name ?? manifest.id,
      requested,
      version,
      checksum,
      signature,
      platform,
      workdir: relative(projectDir, workdir).replaceAll("\\", "/"),
      files: fileSummary.records,
    };
  }

  private reportFor(
    dockId: string,
    version: string,
    platform: OpenDockPlatform,
    fileSummary: FileApplySummary,
    steps: StepReport[],
  ): InstallReport {
    return {
      dockId,
      fileChanges: {
        created: fileSummary.createdPaths,
        deleted: fileSummary.deletedPaths,
        reviewRequired: fileSummary.reviewRequiredPaths,
        updated: fileSummary.updatedPaths,
      },
      version,
      filesCreated: fileSummary.created,
      filesDeleted: fileSummary.deleted,
      filesReviewRequired: fileSummary.reviewRequired,
      filesUpdated: fileSummary.updated,
      platform,
      steps,
    };
  }
}
