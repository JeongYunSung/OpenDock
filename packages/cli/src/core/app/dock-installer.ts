import { existsSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { detectPlatform, type OpenDockPlatform } from "../../platform.js";
import type { ResolvedDock } from "../../resolver.js";
import { resolveDock } from "../../resolver.js";
import {
  assertVersionSatisfiesSelector,
  type DockRef,
  type TaskPhase,
} from "../domain/manifest.js";
import {
  type InstalledDockRecord,
  type InstalledRuntimeRecord,
  OpenDockStateStore,
} from "../domain/state-store.js";
import { FileCandidateCollector } from "../files/file-candidate.js";
import { FilePlan } from "../files/file-plan.js";
import { pruneEmptyDirectoryChain, safeJoin } from "../files/path-utils.js";
import { WorkdirSeeder } from "../files/workdir-seeder.js";
import { createProjectCommandShim, removeProjectCommandShim } from "../runtime/command-shim.js";
import {
  DependencyRunner,
  removeInstalledDependencyOutputs,
} from "../runtime/dependency-runner.js";
import {
  type ProgressReporter,
  type RuntimeProgressEvent,
  reportProgress,
} from "../runtime/progress.js";
import { sharedRuntimeRoot } from "../runtime/project-layout.js";
import { TaskRunner } from "../runtime/task-runner.js";
import {
  type InstallReport,
  installedDockRecordFor,
  installReportFor,
  type UninstallReport,
  uninstallReportFor,
} from "./dock-install-report.js";

type DockResolver = (
  dockRef: DockRef,
  platform: OpenDockPlatform,
) => Promise<ResolvedDock> | ResolvedDock;

function replacementRuntime(
  docks: InstalledDockRecord[],
  runtimeName: string,
): { dock: InstalledDockRecord; runtime: InstalledRuntimeRecord } | undefined {
  for (const dock of [...docks].reverse()) {
    const runtime = dock.runtimes.find((candidate) => candidate.name === runtimeName);
    if (runtime) {
      return { dock, runtime };
    }
  }
  return undefined;
}

function runtimeCommandTarget(
  projectDir: string,
  runtime: InstalledRuntimeRecord,
  command: string,
  platform: OpenDockPlatform,
): string {
  const binDir = installedRuntimeBinDir(projectDir, runtime.path);
  const target = join(binDir, command);
  return platform === "windows" ? `${target}.cmd` : target;
}

function installedRuntimeBinDir(projectDir: string, runtimePath: string): string {
  if (!isAbsolute(runtimePath)) {
    return safeJoin(projectDir, runtimePath, "installed runtime path");
  }
  const root = sharedRuntimeRoot();
  const rel = relative(root, runtimePath);
  if (rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))) {
    return runtimePath;
  }
  throw new Error(`unsafe installed runtime path: ${runtimePath}`);
}

export interface InstallOptions {
  dockRef: DockRef;
  force?: boolean;
  live?: boolean;
  projectDir: string;
  runTasks: boolean;
  phase?: TaskPhase;
  platform?: OpenDockPlatform;
  progress?: ProgressReporter;
  resolve?: DockResolver;
}

export interface UninstallOptions {
  dockId: string;
  force?: boolean;
  progress?: ProgressReporter;
  projectDir: string;
}

export class DockInstaller {
  constructor(
    private readonly taskRunner = new TaskRunner(),
    private readonly collector = new FileCandidateCollector(),
    private readonly workdirSeeder = new WorkdirSeeder(),
    private readonly dependencyRunner = new DependencyRunner(),
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
      : { reports: [], exports: [], runtimes: [], tools: [] };
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

    if (priorDock) {
      this.progress(options.progress, {
        dockId: resolved.manifest.id,
        message: `Cleaning previous ${resolved.manifest.id} dependencies`,
        percent: 91,
        phase: "dependency-clean",
        version: resolved.version,
      });
      removeInstalledDependencyOutputs(options.projectDir, priorDock.dependencies);
    }

    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      message: `Preparing ${resolved.manifest.id} dependencies`,
      percent: 92,
      phase: "dependencies-start",
      version: resolved.version,
    });
    const dependencyResult = options.runTasks
      ? this.dependencyRunner.run(resolved.manifest, {
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
                  92,
                  96,
                ),
              }),
        })
      : { dependencies: [], reports: [] };
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      level: "OK",
      message: `Prepared ${dependencyResult.dependencies.length} dependency set(s)`,
      percent: 96,
      phase: "dependencies-complete",
      total: dependencyResult.dependencies.length,
      version: resolved.version,
    });

    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      message: `Recording ${resolved.manifest.id}@${resolved.version}`,
      percent: 97,
      phase: "lock-save",
      version: resolved.version,
    });
    store.saveDock(
      installedDockRecordFor({
        checksum: resolved.checksum,
        fileSummary,
        manifest: resolved.manifest,
        platform,
        projectDir: options.projectDir,
        requested: options.dockRef.requested(),
        dependencies: dependencyResult.dependencies,
        runtimes: taskResult.runtimes,
        signature: resolved.signature,
        tools: taskResult.tools,
        version: resolved.version,
        workdir: this.taskRunner.dockWorkdir(options.projectDir, resolved.manifest.id),
      }),
    );
    this.progress(options.progress, {
      dockId: resolved.manifest.id,
      level: "OK",
      message: `Recorded ${resolved.manifest.id}@${resolved.version}`,
      percent: 98,
      phase: "lock-saved",
      version: resolved.version,
    });

    return installReportFor({
      dockId: resolved.manifest.id,
      fileSummary,
      platform,
      steps: [...taskResult.reports, ...dependencyResult.reports],
      version: resolved.version,
    });
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
    removeInstalledDependencyOutputs(options.projectDir, dock.dependencies);
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
    this.removeDockTools(options.projectDir, dock);
    this.removeUnusedRuntimeShims(options.projectDir, dock, store);
    pruneEmptyDirectoryChain(options.projectDir, ".opendock/bin");
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
    return uninstallReportFor({
      dockId: dock.id,
      fileSummary: summary,
      platform: dock.platform,
      version: dock.version,
    });
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

  private removeDockTools(
    projectDir: string,
    dock: {
      id: string;
      platform: OpenDockPlatform;
      tools: Array<{ commands: string[]; name: string; path: string }>;
    },
  ): void {
    for (const tool of dock.tools) {
      for (const command of tool.commands) {
        removeProjectCommandShim({
          command,
          owner: { dockId: dock.id, kind: "tool", name: tool.name },
          platform: dock.platform,
          projectDir,
        });
      }
      const path = safeJoin(projectDir, tool.path, "installed tool path");
      rmSync(path, { recursive: true, force: true });
      pruneEmptyDirectoryChain(projectDir, relative(projectDir, path));
    }
  }

  private removeUnusedRuntimeShims(
    projectDir: string,
    dock: {
      id: string;
      platform: OpenDockPlatform;
      runtimes: Array<{ commands: string[]; name: string; path: string }>;
    },
    store: OpenDockStateStore,
  ): void {
    const otherDocks = store.readLock().docks.filter((candidate) => candidate.id !== dock.id);
    for (const runtime of dock.runtimes) {
      const replacement = replacementRuntime(otherDocks, runtime.name);
      if (replacement) {
        for (const command of replacement.runtime.commands) {
          createProjectCommandShim({
            command,
            owner: { dockId: "project", kind: "runtime", name: replacement.runtime.name },
            platform: replacement.dock.platform,
            projectDir,
            target: runtimeCommandTarget(
              projectDir,
              replacement.runtime,
              command,
              replacement.dock.platform,
            ),
          });
        }
        continue;
      }
      for (const command of runtime.commands) {
        removeProjectCommandShim({
          command,
          owner: { dockId: "project", kind: "runtime", name: runtime.name },
          platform: dock.platform,
          projectDir,
        });
      }
      if (isAbsolute(runtime.path)) {
        continue;
      }
      const path = safeJoin(projectDir, runtime.path, "installed runtime path");
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
        pruneEmptyDirectoryChain(projectDir, relative(projectDir, path));
      }
    }
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
}
