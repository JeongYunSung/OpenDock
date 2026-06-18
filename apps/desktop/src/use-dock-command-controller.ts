import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  isTaskActive,
  markCommandTaskCancelling,
  markCommandTaskForceRetrying,
  type CommandTask,
} from "./command-task";
import { waitForCommandPopupPaint } from "./command-log";
import { previewChangeResult } from "./preview-change-result";
import { dockFullId, type Dock, type DockView, type Lang, type OpenDockCommandResult, type Project, type TEXT } from "./data";
import { findDockByKey } from "./display";
import type { InstalledDockRow } from "./dock-workspace-model";
import { isTauriRuntime } from "./tauri-runtime";

interface DockCommandControllerOptions {
  activeProject: Project | undefined;
  allKnownDocks: Dock[];
  appendCommandResultLog: (commandId: string, result: ReturnType<typeof previewChangeResult>) => void;
  appendLog: (level: string, color: string, message: string) => void;
  beginCommandTask: (kind: CommandTask["kind"], target: string, projectPath?: string) => string;
  commandTaskRef: MutableRefObject<CommandTask | null>;
  finishCommandResult: (commandId: string, result: OpenDockCommandResult, successStep: string) => boolean;
  finishCommandTask: (
    commandId: string,
    status: "success" | "error" | "cancelled",
    step: string,
    options?: { forceRetry?: CommandTask["forceRetry"] },
  ) => void;
  installedRows: InstalledDockRow[];
  projects: Project[];
  refreshDockDetail: (dock: Dock) => Promise<Dock>;
  refreshProjectState: (project: Project | undefined, options?: { silent?: boolean }) => Promise<void>;
  setDockView: Dispatch<SetStateAction<DockView>>;
  setInstalledDocks: Dispatch<SetStateAction<Record<string, boolean>>>;
  setCommandTask: (next: CommandTask | null | ((current: CommandTask | null) => CommandTask | null)) => void;
  t: (typeof TEXT)[Lang];
}

export function useDockCommandController(options: DockCommandControllerOptions) {
  async function cancelCommandTask() {
    const task = options.commandTaskRef.current;
    if (!task || !isTaskActive(task)) return;
    options.setCommandTask((current) => markCommandTaskCancelling(current, task.id, options.t.taskCancelling));
    options.appendLog("WARN", "var(--warning)", `cancel ${task.target}`);
    if (!isTauriRuntime()) {
      options.finishCommandTask(task.id, "cancelled", options.t.taskCancelled);
      return;
    }
    try {
      await invoke("opendock_cancel_command", { commandId: task.id });
    } catch (error) {
      options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    }
  }

  async function forceRetryCommand() {
    const task = options.commandTaskRef.current;
    const retry = task?.forceRetry;
    if (!task || !retry || isTaskActive(task)) return;
    options.setCommandTask((current) => markCommandTaskForceRetrying(current, task.id, options.t.forceRetryLog));
    options.appendLog(
      "WARN",
      "var(--warning)",
      `${retry.kind === "update" ? "force update" : "force uninstall"} ${retry.dockId ?? retry.projectPath}`,
    );
    await waitForCommandPopupPaint();

    if (!isTauriRuntime()) {
      const dock = retry.dockId ? findDockByKey(options.allKnownDocks, retry.dockId) ?? undefined : undefined;
      options.appendCommandResultLog(
        task.id,
        previewChangeResult(
          retry.kind === "update" ? "update" : "uninstall",
          retry.dockId ?? retry.projectPath,
          options.installedRows,
          dock,
        ),
      );
      options.finishCommandTask(task.id, "success", options.t.taskCompleted, { forceRetry: null });
      return;
    }

    try {
      if (retry.kind === "update") {
        const result = await invoke<OpenDockCommandResult>("opendock_update", {
          projectDir: retry.projectPath,
          commandId: task.id,
          force: true,
        });
        if (!options.finishCommandResult(task.id, result, options.t.taskCompleted)) return;
        await options.refreshProjectState(
          options.projects.find((project) => project.path === retry.projectPath) ?? options.activeProject,
        );
        return;
      }
      if (!retry.dockId) {
        throw new Error("missing dock id for force uninstall");
      }
      const result = await invoke<OpenDockCommandResult>("opendock_uninstall", {
        projectDir: retry.projectPath,
        dockId: retry.dockId,
        commandId: task.id,
        force: true,
      });
      if (!options.finishCommandResult(task.id, result, options.t.taskCompleted)) return;
      await options.refreshProjectState(
        options.projects.find((project) => project.path === retry.projectPath) ?? options.activeProject,
      );
      options.setInstalledDocks((current) => {
        const next = { ...current };
        delete next[retry.dockId!];
        return next;
      });
    } catch (error) {
      options.appendLog("ERR", "var(--danger)", error instanceof Error ? error.message : String(error));
      options.finishCommandTask(task.id, "error", options.t.taskFailed, { forceRetry: null });
    }
  }

  async function runDoctor(project: Project | undefined) {
    options.setDockView("logs");
    if (!project) return;
    const commandId = options.beginCommandTask("doctor", project.path, project.path);
    if (isTauriRuntime()) {
      try {
        options.appendLog("RUN", "var(--info)", `doctor ${project.path}`);
        const result = await invoke<OpenDockCommandResult>("opendock_doctor", {
          projectDir: project.path,
          commandId,
        });
        options.finishCommandResult(commandId, result, options.t.taskCompleted);
      } catch (error) {
        options.appendLog("ERR", "var(--danger)", error instanceof Error ? error.message : String(error));
        options.finishCommandTask(commandId, "error", options.t.taskFailed);
      }
      return;
    }
    options.appendLog("INFO", "var(--text-2)", `doctor ${project.path}`);
    options.appendLog("OK", "var(--success)", "doctor · 6 checks passed");
    options.finishCommandTask(commandId, "success", options.t.taskCompleted);
  }

  async function updateDocks(project: Project | undefined, commandOptions: { showLogs?: boolean } = { showLogs: true }) {
    if (commandOptions.showLogs !== false) options.setDockView("logs");
    if (!project) return;
    const commandId = options.beginCommandTask("update", project.path, project.path);
    await waitForCommandPopupPaint();
    if (isTauriRuntime()) {
      try {
        await options.refreshProjectState(project, { silent: true });
        options.appendLog("RUN", "var(--info)", `update ${project.path}`);
        const result = await invoke<OpenDockCommandResult>("opendock_update", {
          projectDir: project.path,
          commandId,
        });
        if (!options.finishCommandResult(commandId, result, options.t.taskCompleted)) return;
        await options.refreshProjectState(project, { silent: true });
      } catch (error) {
        options.appendLog("ERR", "var(--danger)", error instanceof Error ? error.message : String(error));
        options.finishCommandTask(commandId, "error", options.t.taskFailed);
      }
      return;
    }
    options.appendLog("INFO", "var(--text-2)", `update ${project.path}`);
    options.appendLog("OK", "var(--success)", "update check completed");
    options.appendCommandResultLog(commandId, previewChangeResult("update", project.path, options.installedRows));
    options.finishCommandTask(commandId, "success", options.t.taskCompleted);
  }

  async function installDock(dock: Dock) {
    if (!options.activeProject) {
      options.appendLog("WARN", "var(--warning)", "select a project before installing a dock");
      return;
    }
    const dockId = dockFullId(dock);
    const commandId = options.beginCommandTask("install", dockId, options.activeProject.path);
    await waitForCommandPopupPaint();
    if (isTauriRuntime()) {
      try {
        const freshDock = await options.refreshDockDetail(dock);
        const dockRef = `${dockFullId(freshDock)}@${freshDock.version}`;
        options.appendLog("RUN", "var(--info)", `install ${dockRef}`);
        const result = await invoke<OpenDockCommandResult>("opendock_install", {
          projectDir: options.activeProject.path,
          dockRef,
          commandId,
        });
        if (!options.finishCommandResult(commandId, result, options.t.taskCompleted)) return;
        await options.refreshProjectState(options.activeProject, { silent: true });
      } catch (error) {
        options.appendLog("ERR", "var(--danger)", error instanceof Error ? error.message : String(error));
        options.finishCommandTask(commandId, "error", options.t.taskFailed);
        return;
      }
    } else {
      const dockRef = `${dockId}@${dock.version}`;
      options.appendLog("INFO", "var(--text-2)", `install ${dockRef}`);
      options.appendLog("OK", "var(--success)", "resolved release · registry.opendock.app");
      options.appendLog("OK", "var(--success)", "files → AGENTS.md (managed block)");
      options.appendLog("OK", "var(--success)", "doctor · 6 checks passed");
      options.appendCommandResultLog(commandId, previewChangeResult("install", dockFullId(dock), options.installedRows, dock));
      options.finishCommandTask(commandId, "success", options.t.taskCompleted);
    }
    options.setInstalledDocks((current) => ({ ...current, [dockFullId(dock)]: true }));
  }

  async function deleteDock(dock: Dock) {
    if (!options.activeProject) {
      options.appendLog("WARN", "var(--warning)", "select a project before deleting a dock");
      return;
    }
    const dockId = dockFullId(dock);
    const commandId = options.beginCommandTask("delete", dockId, options.activeProject.path);
    await waitForCommandPopupPaint();
    if (isTauriRuntime()) {
      try {
        options.appendLog("RUN", "var(--info)", `uninstall ${dockId}`);
        const result = await invoke<OpenDockCommandResult>("opendock_uninstall", {
          projectDir: options.activeProject.path,
          dockId,
          commandId,
        });
        if (!options.finishCommandResult(commandId, result, options.t.taskCompleted)) return;
        await options.refreshProjectState(options.activeProject);
      } catch (error) {
        options.appendLog("ERR", "var(--danger)", error instanceof Error ? error.message : String(error));
        options.finishCommandTask(commandId, "error", options.t.taskFailed);
        return;
      }
    } else {
      options.appendLog("INFO", "var(--text-2)", `uninstall ${dockId}`);
      options.appendLog("OK", "var(--success)", "dock removed from project");
      options.appendCommandResultLog(commandId, previewChangeResult("uninstall", dockId, options.installedRows, dock));
      options.finishCommandTask(commandId, "success", options.t.taskCompleted);
    }
    options.setInstalledDocks((current) => {
      const next = { ...current };
      delete next[dockFullId(dock)];
      delete next[dock.id];
      return next;
    });
  }

  return {
    cancelCommandTask,
    deleteDock,
    forceRetryCommand,
    installDock,
    runDoctor,
    updateDocks,
  };
}
