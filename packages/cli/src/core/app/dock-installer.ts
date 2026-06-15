import { rmSync } from "node:fs";
import { relative } from "node:path";
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
import {
  type ProgressReporter,
  type RuntimeProgressEvent,
  reportProgress,
} from "../runtime/progress.js";
import { type StepReport, TaskRunner } from "../runtime/task-runner.js";

type DockResolver = (
  dockRef: DockRef,
  platform: OpenDockPlatform,
) => Promise<ResolvedDock> | ResolvedDock;

export interface InstallOptions {
  dockRef: DockRef;
  force?: boolean;
  live?: boolean;
  projectDir: string;
  runTasks: boolean;
  operation: string;
  phase?: TaskPhase;
  platform?: OpenDockPlatform;
  progress?: ProgressReporter;
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
  progress?: ProgressReporter;
  projectDir: string;
}

export interface UninstallReport {
  fileChanges: FileChangeDetails;
  dockId: string;
  filesDeleted: number;
  filesReviewRequired: number;
  filesUpdated: number;
  platform?: OpenDockPlatform;
  version: string;
}

export class DockInstaller {
  constructor(
    private readonly taskRunner = new TaskRunner(),
    private readonly collector = new FileCandidateCollector(),
    private readonly workdirSeeder = new WorkdirSeeder(),
  ) {}

  async install(options: InstallOptions): Promise<InstallReport> {
    const platform = options.platform ?? detectPlatform();
    const requestedDockId = options.dockRef.id();
    const requestedVersion = options.dockRef.requested();
    this.progress(options.progress, {
      dockId: requestedDockId,
      message: `Resolving ${requestedDockId}@${requestedVersion}`,
      percent: 14,
      phase: "resolve-start",
      version: requestedVersion,
    });
    const resolved = await (options.resolve ?? resolveDock)(options.dockRef, platform);
    assertVersionSatisfiesSelector(resolved.version, options.dockRef.requested());
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      level: "OK",
      message: `Resolved ${resolved.manifest.id}@${resolved.version}`,
      percent: 28,
      phase: "resolve-complete",
      version: resolved.version,
    });
    const store = new OpenDockStateStore(options.projectDir);
    const priorDock = store.findDock(resolved.manifest.id);
    const force = options.force === true;
    const filePlan = new FilePlan(
      options.projectDir,
      resolved.manifest.id,
      priorDock?.files ?? [],
      force,
    );

    if (priorDock) {
      this.progress(options.progress, {
        dockId: resolved.manifest.id,
        message: `Verifying previous ${resolved.manifest.id} files`,
        percent: 34,
        phase: "state-verify",
        version: resolved.version,
      });
      filePlan.verifyPriorState();
    } else {
      this.progress(options.progress, {
        dockId: resolved.manifest.id,
        message: `Preparing ${resolved.manifest.id}`,
        percent: 34,
        phase: "state-prepare",
        version: resolved.version,
      });
    }

    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      message: `Collecting files for ${resolved.manifest.id}`,
      percent: 40,
      phase: "file-collect",
      version: resolved.version,
    });
    const fileCandidates = this.collectManifestFiles(resolved);
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      level: "OK",
      message: `Collected ${fileCandidates.length} manifest file(s)`,
      percent: 46,
      phase: "file-collected",
      total: fileCandidates.length,
      version: resolved.version,
    });
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      message: `Preparing ${resolved.manifest.id} workdir`,
      percent: 50,
      phase: "workdir-seed",
      version: resolved.version,
    });
    this.seedWorkdir(options.projectDir, resolved);
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      level: "OK",
      message: `Prepared ${resolved.manifest.id} workdir`,
      percent: 54,
      phase: "workdir-ready",
      version: resolved.version,
    });
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      message: `Running ${options.phase ?? "install"} tasks for ${resolved.manifest.id}`,
      percent: 58,
      phase: "tasks-start",
      version: resolved.version,
    });
    const taskResult = options.runTasks
      ? this.taskRunner.run(resolved.manifest, {
          projectDir: options.projectDir,
          dockId: resolved.manifest.id,
          phase: options.phase ?? "install",
          platform,
          ...(options.live === undefined ? {} : { live: options.live }),
          ...(options.progress === undefined
            ? {}
            : {
                progress: this.nestedProgress(
                  options.progress,
                  resolved.manifest.id,
                  resolved.version,
                  58,
                  74,
                ),
              }),
        })
      : { reports: [], exports: [] };
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      level: "OK",
      message: `Completed ${taskResult.reports.length} task report(s)`,
      percent: 74,
      phase: "tasks-complete",
      total: taskResult.reports.length,
      version: resolved.version,
    });
    const candidates = [...fileCandidates, ...taskResult.exports];

    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      message: `Preflighting ${candidates.length} managed output(s)`,
      percent: 78,
      phase: "file-preflight",
      total: candidates.length,
      version: resolved.version,
    });
    filePlan.preflight(candidates);
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      level: "OK",
      message: `Preflight passed for ${candidates.length} managed output(s)`,
      percent: 82,
      phase: "file-preflight-complete",
      total: candidates.length,
      version: resolved.version,
    });
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      message: `Applying ${candidates.length} managed output(s)`,
      percent: 86,
      phase: "file-apply",
      total: candidates.length,
      version: resolved.version,
    });
    const fileSummary = filePlan.apply(candidates);
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      level: "OK",
      message: `${resolved.manifest.id}: ${fileSummary.created} created, ${fileSummary.updated} updated, ${fileSummary.deleted} deleted`,
      percent: 90,
      phase: "file-applied",
      total: candidates.length,
      version: resolved.version,
    });

    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      message: `Recording ${resolved.manifest.id}@${resolved.version}`,
      percent: 92,
      phase: "lock-save",
      version: resolved.version,
    });
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
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      level: "OK",
      message: `Recorded ${resolved.manifest.id}@${resolved.version}`,
      percent: 94,
      phase: "lock-saved",
      version: resolved.version,
    });

    return this.reportFor(
      resolved.manifest.id,
      resolved.version,
      platform,
      fileSummary,
      taskResult.reports,
    );
  }

  uninstall(options: UninstallOptions): UninstallReport {
    const store = new OpenDockStateStore(options.projectDir);
    this.progress(options.progress, {
      dockId: options.dockId,
      message: `Checking ${options.dockId}`,
      percent: 16,
      phase: "state-check",
    });
    const dock = store.findDock(options.dockId);
    if (!dock) {
      throw new Error(`dock \`${options.dockId}\` is not installed in this project`);
    }
    const filePlan = new FilePlan(options.projectDir, dock.id, dock.files, options.force === true);
    this.progress(options.progress, {
      dockId: dock.id,
      message: `Verifying ${dock.id} managed files`,
      percent: 32,
      phase: "state-verify",
      version: dock.version,
    });
    filePlan.verifyPriorState();
    this.progress(options.progress, {
      dockId: dock.id,
      message: `Removing ${dock.files.length} managed file record(s)`,
      percent: 58,
      phase: "file-apply",
      total: dock.files.length,
      version: dock.version,
    });
    const summary = filePlan.apply([]);
    this.progress(options.progress, {
      dockId: dock.id,
      level: "OK",
      message: `${dock.id}: ${summary.deleted} deleted, ${summary.updated} updated`,
      percent: 78,
      phase: "file-applied",
      version: dock.version,
    });
    const workdir = this.taskRunner.dockWorkdir(options.projectDir, dock.id);
    this.progress(options.progress, {
      dockId: dock.id,
      message: `Removing ${dock.id} workdir`,
      percent: 86,
      phase: "workdir-remove",
      version: dock.version,
    });
    rmSync(workdir, {
      recursive: true,
      force: true,
    });
    pruneEmptyDirectoryChain(options.projectDir, relative(options.projectDir, workdir));
    this.progress(options.progress, {
      dockId: dock.id,
      message: `Removing ${dock.id} from lockfile`,
      percent: 92,
      phase: "lock-save",
      version: dock.version,
    });
    store.removeDock(dock.id);
    this.progress(options.progress, {
      dockId: dock.id,
      level: "OK",
      message: `Removed ${dock.id}@${dock.version}`,
      percent: 94,
      phase: "lock-saved",
      version: dock.version,
    });
    return {
      dockId: dock.id,
      fileChanges: {
        created: [],
        deleted: summary.deletedPaths,
        reviewRequired: summary.reviewRequiredPaths,
        updated: summary.updatedPaths,
      },
      filesDeleted: summary.deleted,
      filesReviewRequired: summary.reviewRequired,
      filesUpdated: summary.updated,
      platform: dock.platform,
      version: dock.version,
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

  private progress(reporter: ProgressReporter | undefined, event: RuntimeProgressEvent): void {
    reportProgress(reporter, {
      level: "RUN",
      ...event,
    });
  }

  private nestedProgress(
    reporter: ProgressReporter,
    dockId: string,
    version: string,
    startPercent: number,
    endPercent: number,
  ): ProgressReporter {
    return (event) => {
      const rawPercent = event.percent ?? 50;
      const span = endPercent - startPercent;
      this.progress(reporter, {
        ...event,
        dockId: event.dockId ?? dockId,
        percent: Math.round(startPercent + (span * rawPercent) / 100),
        version: event.version ?? version,
      });
    };
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
