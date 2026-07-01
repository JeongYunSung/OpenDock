import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { outdatedReportsByDockId } from "./command-change-result";
import { commandLinesToStoredLogs } from "./command-log";
import { isTaskActive, type CommandTask } from "./command-task";
import type {
  AppLog,
  InstalledDockRecord,
  OpenDockCommandResult,
  OpenDockOutdatedReport,
  Project,
  ProjectStateResult,
} from "./data";
import { isTauriRuntime } from "./tauri-runtime";

interface ProjectRuntimeControllerOptions {
  activeProject: Project | undefined;
  appendLog: (level: string, color: string, message: string) => void;
  commandTaskRef: MutableRefObject<CommandTask | null>;
  dockView: string;
  setInstalledDocks: Dispatch<SetStateAction<Record<string, boolean>>>;
  setLogs: Dispatch<SetStateAction<AppLog[]>>;
}

export function useProjectRuntimeController(options: ProjectRuntimeControllerOptions) {
  const [installedRecords, setInstalledRecords] = useState<InstalledDockRecord[]>([]);
  const [outdatedReportsById, setOutdatedReportsById] = useState<Record<string, OpenDockOutdatedReport>>({});
  const [projectStateLoaded, setProjectStateLoaded] = useState(false);
  const loadedProjectPathRef = useRef<string | null>(null);

  const resetProjectRuntime = useCallback(() => {
    loadedProjectPathRef.current = null;
    setInstalledRecords((current) => (current.length === 0 ? current : []));
    setOutdatedReportsById((current) => (Object.keys(current).length === 0 ? current : {}));
    setProjectStateLoaded(false);
  }, []);

  const refreshProjectState = useCallback(
    async (project: Project | undefined, refreshOptions: { silent?: boolean } = {}) => {
      if (!project || !isTauriRuntime()) return;
      if (!refreshOptions.silent) setProjectStateLoaded(false);
      try {
        const state = await invoke<ProjectStateResult>("opendock_project_state", { projectDir: project.path });
        const records = state.docks ?? [];
        loadedProjectPathRef.current = project.path;
        setInstalledRecords(records);
        options.setInstalledDocks(Object.fromEntries(records.map((dock) => [dock.id, true])));
        if (records.length === 0) {
          setOutdatedReportsById({});
          return;
        }
        try {
          const outdated = await invoke<OpenDockCommandResult>("opendock_outdated", { projectDir: project.path });
          setOutdatedReportsById(outdatedReportsByDockId(outdated.json));
        } catch (error) {
          setOutdatedReportsById({});
          options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
        }
      } catch (error) {
        const canPreserveCurrentState = loadedProjectPathRef.current === project.path;
        if (!canPreserveCurrentState) {
          setInstalledRecords([]);
          options.setInstalledDocks({});
          setOutdatedReportsById({});
        }
        options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
      } finally {
        setProjectStateLoaded(true);
      }
    },
    [options.appendLog, options.setInstalledDocks],
  );

  const refreshProjectLogs = useCallback(
    async (project: Project | undefined) => {
      if (!project || !isTauriRuntime()) return;
      try {
        const result = await invoke<OpenDockCommandResult>("opendock_log", { projectDir: project.path });
        options.setLogs(commandLinesToStoredLogs(result.lines));
      } catch (error) {
        options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
      }
    },
    [options.appendLog, options.setLogs],
  );

  useEffect(() => {
    if (!options.activeProject || !isTauriRuntime()) {
      resetProjectRuntime();
      return;
    }
    if (loadedProjectPathRef.current !== options.activeProject.path) {
      resetProjectRuntime();
    }
    void refreshProjectState(options.activeProject);
  }, [options.activeProject?.path]);

  useEffect(() => {
    if (!options.activeProject || !isTauriRuntime() || options.dockView !== "installed") return;
    let refreshInFlight = false;
    const refreshInstalledProjectState = async () => {
      if (refreshInFlight || isTaskActive(options.commandTaskRef.current)) return;
      refreshInFlight = true;
      try {
        await refreshProjectState(options.activeProject, { silent: true });
      } finally {
        refreshInFlight = false;
      }
    };
    void refreshInstalledProjectState();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshInstalledProjectState();
    };
    const interval = window.setInterval(refreshInstalledProjectState, 5000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [options.activeProject?.path, options.dockView]);

  return {
    installedRecords,
    outdatedReportsById,
    projectStateLoaded,
    refreshProjectLogs,
    refreshProjectState,
    resetProjectRuntime,
  };
}
