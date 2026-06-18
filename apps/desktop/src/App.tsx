import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BASE_LOGS,
  dockFullId,
  type AuthSession,
  type AppLog,
  type Dock,
  type DockView,
  type InstalledDockRecord,
  type Lang,
  type OpenDockCommandLine,
  type OpenDockCommandProgress,
  type OpenDockCommandResult,
  type OpenDockOutdatedReport,
  type Project,
  type ProjectStateResult,
  type SortMode,
  TEXT,
  type Theme
} from "./data";
import { isTaskActive, markCommandTaskCancelling, markCommandTaskForceRetrying } from "./command-task";
import {
  appendStoredLog,
  commandLinesToStoredLogs,
  commandFailureMessage,
  isAuthStatusLine,
  logColor,
  normalizeStoredLogs,
  waitForCommandPopupPaint,
} from "./command-log";
import { outdatedReportsByDockId } from "./command-change-result";
import { findDockByKey } from "./display";
import { CommandPaletteDialog, CommandProgressDialog, ProjectSwitcherDialog } from "./app-dialogs";
import { ProjectEmpty, ProjectLoading, SignInScreen } from "./workspace-shell";
import {
  shortcutCommandForEvent,
  type ShortcutBinding,
  type ShortcutCommandId,
} from "./shortcuts";
import { useResponsivePageSizes } from "./responsive-page-size";
import { isTauriRuntime } from "./tauri-runtime";
import { useStoredState } from "./use-stored-state";
import { shouldIgnoreGlobalShortcut } from "./keyboard-events";
import { useAccountDocksController } from "./use-account-docks-controller";
import { useCatalogController, useDockDetailController } from "./use-catalog-controller";
import { useCommandTaskController } from "./use-command-task-controller";
import { useDesktopStateSync } from "./use-desktop-state-sync";
import { useProjectController } from "./use-project-controller";
import { useShortcutController } from "./use-shortcut-controller";
import { ProjectAddModal, ProjectDeleteModal, ProjectRenameModal } from "./project-modals";
import { Titlebar, type OpenMenu } from "./titlebar";
import { ACCOUNT_PAGE_LIMIT, Workspace } from "./workspace-view";
import { previewChangeResult } from "./preview-change-result";
import {
  buildInstalledFallbackDocks,
  installedDockRows,
  installedDockStateMap,
  matchesInstalledSearch,
  sortCatalogDocks,
  type InstalledDockRow,
} from "./dock-workspace-model";

export function App() {
  const [theme, setTheme] = useStoredState<Theme>("opendock.theme", "light");
  const [lang, setLang] = useStoredState<Lang>("opendock.lang", "ko");
  const t = TEXT[lang];
  const [loggedIn, setLoggedIn] = useStoredState("opendock.loggedIn", false);
  const [authProvider, setAuthProvider] = useStoredState("opendock.authProvider", "");
  const [openMenu, setOpenMenu] = useState<OpenMenu>("");
  const [authWorking, setAuthWorking] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [sortMode, setSortMode] = useStoredState<SortMode>("opendock.sortMode", "downloads");
  const [searchQuery, setSearchQuery] = useStoredState("opendock.searchQuery", "");
  const [installedSearchQuery, setInstalledSearchQuery] = useStoredState("opendock.installedSearchQuery", "");
  const [dockView, setDockView] = useStoredState<DockView>("opendock.dockView", "list");
  const [detailId, setDetailId] = useStoredState("opendock.detailId", "");
  const [detailTab, setDetailTab] = useStoredState<"readme" | "versions">("opendock.detailTab", "readme");
  const [detailVersion, setDetailVersion] = useStoredState("opendock.detailVersion", "");
  const [catalogPage, setCatalogPage] = useState(1);
  const [versionPage, setVersionPage] = useState(1);
  const [installedDocks, setInstalledDocks] = useStoredState<Record<string, boolean>>("opendock.installedDocks", {});
  const [installedRecords, setInstalledRecords] = useState<InstalledDockRecord[]>([]);
  const [outdatedReportsById, setOutdatedReportsById] = useState<Record<string, OpenDockOutdatedReport>>({});
  const [projectStateLoaded, setProjectStateLoaded] = useState(false);
  const [logs, setLogs] = useStoredState<AppLog[]>("opendock.logs", BASE_LOGS, {
    defer: true,
    normalize: (value) => normalizeStoredLogs(value, BASE_LOGS),
  });
  const {
    applyCommandLineToTask,
    applyCommandProgressToTask,
    appendCommandResultLog,
    beginCommandTask,
    closeCommandProgress,
    commandTask,
    commandTaskRef,
    finishCommandResult,
    finishCommandTask,
    setCommandTask,
  } = useCommandTaskController(t);
  const handleNativeMenuRef = useRef<(id: string) => Promise<void> | void>(() => undefined);
  const shortcutBindingsRef = useRef<ShortcutBinding[]>([]);
  const shortcutSuspendedRef = useRef(false);
  const runShortcutCommandRef = useRef<(commandId: ShortcutCommandId) => Promise<void> | void>(() => undefined);
  const [nickname, setNickname] = useStoredState("opendock.nickname", "opendock");
  const [accountEmail, setAccountEmail] = useStoredState("opendock.accountEmail", "kjyscom@gmail.com");
  const [appStateLoaded, setAppStateLoaded] = useState(!isTauriRuntime());
  const responsivePageSizes = useResponsivePageSizes();
  const catalogPageSize = responsivePageSizes.catalog;
  const versionPageSize = responsivePageSizes.versions;
  const {
    catalogDocks,
    catalogTotal,
    refreshCatalogFromRegistry,
    setCatalogDocks,
  } = useCatalogController({
    appendLog,
    catalogPage,
    catalogPageSize,
    searchQuery,
    sortMode,
  });
  const {
    exportShortcuts,
    importShortcuts,
    resetAllShortcuts,
    resetShortcut,
    shortcutBindings,
    shortcutPlatform,
    shortcutStatus,
    updateShortcut,
    windowControlPlatform,
  } = useShortcutController(lang, t);

  const {
    activeProjectId,
    addExistingProjectFromFolder,
    closeProjectDelete,
    closeProjectRename,
    confirmProjectDelete,
    createBlankProject,
    deleteProjectName,
    openDeleteProject,
    openRenameProject,
    projectAddOpen,
    projectDeleteOpen,
    projectRenameOpen,
    projects,
    projectSidebarCollapsed,
    renameProjectName,
    resetProjectDialogs,
    saveProjectRename,
    setActiveProjectId,
    setProjectAddOpen,
    setProjectDeleteOpen,
    setProjectRenameOpen,
    setProjects,
    setProjectSidebarCollapsed,
    setRenameProjectName,
  } = useProjectController({
    appendLog,
    resetDockWorkspaceView,
    setOpenMenu,
  });

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId]
  );
  const projectPathLabel = activeProject ? activeProject.path : t.noProjectPath;
  const registryDocks = catalogDocks;
  const visibleDocks = registryDocks;
  const installedFallbackDocks = useMemo(
    () => buildInstalledFallbackDocks(installedRecords),
    [installedRecords]
  );
  const allKnownDocks = useMemo(
    () => [
      ...registryDocks,
      ...installedFallbackDocks.filter((dock) => !findDockByKey(registryDocks, dockFullId(dock)))
    ],
    [registryDocks, installedFallbackDocks]
  );
  const baseDetail = useMemo(
    () => findDockByKey(allKnownDocks, detailId) ?? allKnownDocks[0] ?? null,
    [allKnownDocks, detailId]
  );
  const detailKey = baseDetail ? dockFullId(baseDetail) : "";
  const {
    dockDetails,
    refreshDockDetail,
    setDockDetails,
    setVersionTotal,
    versionTotal,
  } = useDockDetailController({
    appendLog,
    baseDetail,
    catalogDocks,
    detailKey,
    dockView,
    setCatalogDocks,
    versionPage,
    versionPageSize,
  });
  const detail = baseDetail ? dockDetails[detailKey] ?? baseDetail : null;
  const selectedDetailVersion = useMemo(
    () => detail?.versions?.find((version) => version.version === detailVersion) ?? detail?.versions?.[0] ?? null,
    [detail, detailVersion]
  );
  const activeInstalledDocks = useMemo(
    () => installedDockStateMap(projectStateLoaded, installedRecords, installedDocks),
    [projectStateLoaded, installedRecords, installedDocks]
  );
  const sortedDocks = useMemo(
    () => sortCatalogDocks(visibleDocks, sortMode),
    [visibleDocks, sortMode]
  );
  const installedRows: InstalledDockRow[] = useMemo(
    () =>
      installedDockRows({
        activeInstalledDocks,
        allKnownDocks,
        installedRecords,
        lang,
        outdatedReportsById,
        projectStateLoaded,
        registryDocks,
      }),
    [projectStateLoaded, installedRecords, allKnownDocks, registryDocks, lang, outdatedReportsById, activeInstalledDocks]
  );
  const updateAvailableCount = useMemo(
    () => installedRows.filter((row) => row.updateAvailable).length,
    [installedRows]
  );
  const filteredInstalledRows = useMemo(
    () => installedRows.filter((row) => matchesInstalledSearch(row, installedSearchQuery)),
    [installedRows, installedSearchQuery]
  );
  const catalogPageCount = Math.max(1, Math.ceil(Math.max(catalogTotal, sortedDocks.length) / catalogPageSize));
  const versionPageCount = Math.max(1, Math.ceil(Math.max(versionTotal, detail?.versions?.length ?? 0) / versionPageSize));
  const overlayOpen = openMenu !== "";
  const accountMenuName = authProvider === "github" ? t.githubAccount : accountEmail;
  const showAppLoading = isTauriRuntime() && !appStateLoaded;
  const {
    myDocks,
    myDocksCounts,
    myDocksPage,
    myDocksTotal,
    myStarredDocks,
    resetAccountDocks,
    setMyDocksPage,
    starredDockIds,
    starUpdatingId,
    toggleDockStar,
  } = useAccountDocksController({
    appendLog,
    catalogDocks,
    detailKey,
    loggedIn,
    pageSize: ACCOUNT_PAGE_LIMIT,
    setCatalogDocks,
    setDockDetails,
    signInToStar: t.signInToStar,
  });
  const myDocksPageCount = Math.max(1, Math.ceil(myDocksTotal / ACCOUNT_PAGE_LIMIT));

  function resetDockWorkspaceView() {
    setDockView("list");
    setDetailTab("readme");
    setDetailVersion("");
    setSearchQuery("");
    setInstalledSearchQuery("");
    setCatalogPage(1);
    setVersionPage(1);
    setOpenMenu("");
  }

  async function runAppMenuCommand(id: string) {
    setOpenMenu("");
    await handleNativeMenu(id);
  }

  useDesktopStateSync({
    activeProjectId,
    appendLog,
    appStateLoaded,
    projects,
    setAccountEmail,
    setActiveProjectId,
    setAppStateLoaded,
    setAuthProvider,
    setLoggedIn,
    setProjects,
  });

  useEffect(() => {
    setCatalogPage(1);
  }, [searchQuery, sortMode, catalogPageSize]);

  useEffect(() => {
    setVersionPage(1);
    setVersionTotal(0);
  }, [detailKey, versionPageSize]);

  useEffect(() => {
    if (catalogPage > catalogPageCount) setCatalogPage(catalogPageCount);
  }, [catalogPage, catalogPageCount]);

  useEffect(() => {
    if (versionPage > versionPageCount) setVersionPage(versionPageCount);
  }, [versionPage, versionPageCount]);

  useEffect(() => {
    if (myDocksPage > myDocksPageCount) setMyDocksPage(myDocksPageCount);
  }, [myDocksPage, myDocksPageCount]);

  useEffect(() => {
    if (!activeProject || !isTauriRuntime()) {
      setProjectStateLoaded(false);
      setInstalledRecords([]);
      setOutdatedReportsById({});
      return;
    }
    void refreshProjectState(activeProject);
  }, [activeProject?.path]);

  useEffect(() => {
    if (!activeProject || !isTauriRuntime() || dockView !== "installed") return;
    let refreshInFlight = false;
    const refreshInstalledProjectState = async () => {
      if (refreshInFlight || isTaskActive(commandTaskRef.current)) return;
      refreshInFlight = true;
      try {
        await refreshProjectState(activeProject, { silent: true });
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
  }, [dockView, activeProject?.path]);

  useEffect(() => {
    setDetailVersion("");
  }, [detailKey]);

  useLayoutEffect(() => {
    handleNativeMenuRef.current = handleNativeMenu;
    shortcutBindingsRef.current = shortcutBindings;
    shortcutSuspendedRef.current =
      projectAddOpen ||
      projectRenameOpen ||
      projectDeleteOpen ||
      commandPaletteOpen ||
      projectSwitcherOpen ||
      Boolean(commandTask && isTaskActive(commandTask));
    runShortcutCommandRef.current = runShortcutCommand;
  });

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>("opendock-menu", (event) => {
      void handleNativeMenuRef.current(String(event.payload));
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalShortcut(event)) return;
      const commandId = shortcutCommandForEvent(event, shortcutBindingsRef.current);
      if (!commandId) return;
      if (shortcutSuspendedRef.current && commandId !== "command.palette") return;
      event.preventDefault();
      event.stopPropagation();
      void runShortcutCommandRef.current(commandId);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void listen<OpenDockCommandLine>("opendock-command-line", (event) => {
      const line = event.payload;
      if (isAuthStatusLine(line.message)) setAuthMessage(line.message);
      appendLog(line.level, logColor(line.level), line.message);
      applyCommandLineToTask(line);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisteners.push(dispose);
    });
    void listen<OpenDockCommandProgress>("opendock-command-progress", (event) => {
      const progress = event.payload;
      if (progress.commandId && commandTaskRef.current?.id !== progress.commandId) return;
      const level = progress.level.toUpperCase();
      appendLog(level, logColor(level), progress.message);
      applyCommandProgressToTask(progress);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisteners.push(dispose);
    });
    return () => {
      disposed = true;
      for (const dispose of unlisteners) {
        dispose();
      }
    };
  }, []);

  async function login(provider: "gmail" | "github") {
    setAuthWorking(true);
    setAuthMessage(t.signInWaiting);
    if (isTauriRuntime()) {
      try {
        const result = await invoke<OpenDockCommandResult>("opendock_auth_login", { provider });
        if (!result.success) {
          setAuthMessage(commandFailureMessage(result, t.signInFailed));
          return;
        }
        const session = await invoke<AuthSession>("opendock_auth_session");
        if (session.email) setAccountEmail(session.email);
      } catch (error) {
        setAuthMessage(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        setAuthWorking(false);
      }
    }
    setAuthWorking(false);
    setAuthMessage("");
    setLoggedIn(true);
    setAuthProvider(provider);
    resetDockWorkspaceView();
  }

  async function logout() {
    if (isTauriRuntime()) {
      try {
        await invoke<OpenDockCommandResult>("opendock_auth_logout");
      } catch {
        // Local UI state still clears when the registry session is already gone.
      }
    }
    setLoggedIn(false);
    setAuthProvider("");
    setAccountEmail("kjyscom@gmail.com");
    resetProjectDialogs();
    setProjectSidebarCollapsed(false);
    setInstalledDocks({});
    setInstalledRecords([]);
    resetAccountDocks();
    setProjectStateLoaded(false);
    resetDockWorkspaceView();
  }

  function openDockDetail(dockId: string) {
    setDetailId(dockId);
    setDetailTab("readme");
    setDockView("detail");
    setOpenMenu("");
  }

  function setMainView(view: DockView) {
    setDockView(view);
    setDetailTab("readme");
    setOpenMenu("");
    setCommandPaletteOpen(false);
    setProjectSwitcherOpen(false);
    if (view === "logs") void refreshProjectLogs(activeProject);
  }

  function selectProject(projectId: string) {
    setActiveProjectId(projectId);
    setProjectSwitcherOpen(false);
    setCommandPaletteOpen(false);
    resetDockWorkspaceView();
  }

  async function runShortcutCommand(commandId: ShortcutCommandId) {
    switch (commandId) {
      case "command.palette":
        setCommandPaletteOpen((current) => !current);
        setProjectSwitcherOpen(false);
        break;
      case "project.new":
        await createBlankProject();
        break;
      case "project.open":
        await addExistingProjectFromFolder();
        break;
      case "project.switch":
        if (projects.length > 0) {
          setProjectSwitcherOpen(true);
          setCommandPaletteOpen(false);
        }
        break;
      case "nav.explore":
        if (activeProject) setMainView("list");
        break;
      case "nav.installed":
        if (activeProject) setMainView("installed");
        break;
      case "nav.logs":
        if (activeProject) setMainView("logs");
        break;
      case "project.updateAll":
        await updateDocks(activeProject, { showLogs: false });
        break;
      case "dock.refresh":
        await refreshCatalogFromRegistry();
        break;
      case "dock.install":
        if (detail && dockView === "detail") await installDock(detail);
        break;
      default:
        break;
    }
  }

  function saveNickname(nextNickname: string) {
    const normalized = nextNickname.trim();
    if (!normalized) return;
    setNickname(normalized);
  }

  async function handleNativeMenu(id: string) {
    switch (id) {
      case "file:new-project":
        await createBlankProject();
        break;
      case "file:add-existing-project":
        await addExistingProjectFromFolder();
        break;
      case "edit:rename-project":
        if (activeProject) openRenameProject(activeProject);
        break;
      case "edit:copy-project-path":
        await copyProjectPath(activeProject);
        break;
      case "edit:import-shortcuts":
        await importShortcuts();
        break;
      case "edit:export-shortcuts":
        await exportShortcuts();
        break;
      case "view:explore":
        setMainView("list");
        break;
      case "view:installed":
        setMainView("installed");
        break;
      case "view:logs":
        setMainView("logs");
        break;
      case "view:toggle-sidebar":
        setProjectSidebarCollapsed((current) => !current);
        break;
      case "project:run-doctor":
        await runDoctor(activeProject);
        break;
      case "project:update-docks":
        await updateDocks(activeProject);
        break;
      case "project:open-folder":
      case "project:reveal-folder":
        await openProjectFolder(activeProject);
        break;
      case "project:remove-from-opendock":
        if (activeProject) openDeleteProject(activeProject);
        break;
      case "dock:install":
        if (detail) await installDock(detail);
        break;
      case "dock:delete":
        if (detail) await deleteDock(detail);
        break;
      case "dock:refresh-registry":
        await refreshCatalogFromRegistry();
        break;
      case "dock:open-detail":
        if (detailKey) openDockDetail(detailKey);
        break;
      case "window:reload":
        window.location.reload();
        break;
      case "help:docs":
        await openOpenDockUrl("https://opendock.app/docs");
        break;
      case "help:cli-commands":
        await openOpenDockUrl("https://opendock.app/docs");
        break;
      case "help:troubleshooting":
        await openOpenDockUrl("https://opendock.app/install");
        break;
      default:
        break;
    }
  }

  function appendLog(level: string, color: string, message: string) {
    setLogs((current) => appendStoredLog(current, level, color, message));
  }

  async function cancelCommandTask() {
    const task = commandTaskRef.current;
    if (!task || !isTaskActive(task)) return;
    setCommandTask((current) => markCommandTaskCancelling(current, task.id, t.taskCancelling));
    appendLog("WARN", "var(--warning)", `cancel ${task.target}`);
    if (!isTauriRuntime()) {
      finishCommandTask(task.id, "cancelled", t.taskCancelled);
      return;
    }
    try {
      await invoke("opendock_cancel_command", { commandId: task.id });
    } catch (error) {
      appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    }
  }

  async function forceRetryCommand() {
    const task = commandTaskRef.current;
    const retry = task?.forceRetry;
    if (!task || !retry || isTaskActive(task)) return;
    setCommandTask((current) => markCommandTaskForceRetrying(current, task.id, t.forceRetryLog));
    appendLog("WARN", "var(--warning)", `${retry.kind === "update" ? "force update" : "force uninstall"} ${retry.dockId ?? retry.projectPath}`);
    await waitForCommandPopupPaint();

    if (!isTauriRuntime()) {
      const dock = retry.dockId ? findDockByKey(allKnownDocks, retry.dockId) ?? undefined : undefined;
      appendCommandResultLog(
        task.id,
        previewChangeResult(
          retry.kind === "update" ? "update" : "uninstall",
          retry.dockId ?? retry.projectPath,
          installedRows,
          dock,
        ),
      );
      finishCommandTask(task.id, "success", t.taskCompleted, { forceRetry: null });
      return;
    }

    try {
      if (retry.kind === "update") {
        const result = await invoke<OpenDockCommandResult>("opendock_update", {
          projectDir: retry.projectPath,
          commandId: task.id,
          force: true
        });
        if (!finishCommandResult(task.id, result, t.taskCompleted)) return;
        await refreshProjectState(projects.find((project) => project.path === retry.projectPath) ?? activeProject);
        return;
      }
      if (!retry.dockId) {
        throw new Error("missing dock id for force uninstall");
      }
      const result = await invoke<OpenDockCommandResult>("opendock_uninstall", {
        projectDir: retry.projectPath,
        dockId: retry.dockId,
        commandId: task.id,
        force: true
      });
      if (!finishCommandResult(task.id, result, t.taskCompleted)) return;
      await refreshProjectState(projects.find((project) => project.path === retry.projectPath) ?? activeProject);
      setInstalledDocks((current) => {
        const next = { ...current };
        delete next[retry.dockId!];
        return next;
      });
    } catch (error) {
      appendLog("ERR", "var(--danger)", error instanceof Error ? error.message : String(error));
      finishCommandTask(task.id, "error", t.taskFailed, { forceRetry: null });
    }
  }

  async function refreshProjectState(project: Project | undefined, options: { silent?: boolean } = {}) {
    if (!project || !isTauriRuntime()) return;
    if (!options.silent) setProjectStateLoaded(false);
    try {
      const state = await invoke<ProjectStateResult>("opendock_project_state", { projectDir: project.path });
      setInstalledRecords(state.docks ?? []);
      setInstalledDocks(Object.fromEntries((state.docks ?? []).map((dock) => [dock.id, true])));
      if ((state.docks ?? []).length === 0) {
        setOutdatedReportsById({});
        return;
      }
      try {
        const outdated = await invoke<OpenDockCommandResult>("opendock_outdated", { projectDir: project.path });
        setOutdatedReportsById(outdatedReportsByDockId(outdated.json));
      } catch (error) {
        setOutdatedReportsById({});
        appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      setInstalledRecords([]);
      setInstalledDocks({});
      setOutdatedReportsById({});
      appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    } finally {
      setProjectStateLoaded(true);
    }
  }

  async function refreshProjectLogs(project: Project | undefined) {
    if (!project || !isTauriRuntime()) return;
    try {
      const result = await invoke<OpenDockCommandResult>("opendock_log", { projectDir: project.path });
      setLogs(commandLinesToStoredLogs(result.lines));
    } catch (error) {
      appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    }
  }

  async function runDoctor(project: Project | undefined) {
    setDockView("logs");
    if (!project) return;
    const commandId = beginCommandTask("doctor", project.path, project.path);
    if (isTauriRuntime()) {
      try {
        appendLog("RUN", "var(--info)", `doctor ${project.path}`);
        const result = await invoke<OpenDockCommandResult>("opendock_doctor", {
          projectDir: project.path,
          commandId
        });
        finishCommandResult(commandId, result, t.taskCompleted);
      } catch (error) {
        appendLog("ERR", "var(--danger)", error instanceof Error ? error.message : String(error));
        finishCommandTask(commandId, "error", t.taskFailed);
      }
      return;
    }
    appendLog("INFO", "var(--text-2)", `doctor ${project.path}`);
    appendLog("OK", "var(--success)", "doctor · 6 checks passed");
    finishCommandTask(commandId, "success", t.taskCompleted);
  }

  async function updateDocks(project: Project | undefined, options: { showLogs?: boolean } = { showLogs: true }) {
    if (options.showLogs !== false) setDockView("logs");
    if (!project) return;
    const commandId = beginCommandTask("update", project.path, project.path);
    await waitForCommandPopupPaint();
    if (isTauriRuntime()) {
      try {
        await refreshProjectState(project, { silent: true });
        appendLog("RUN", "var(--info)", `update ${project.path}`);
        const result = await invoke<OpenDockCommandResult>("opendock_update", {
          projectDir: project.path,
          commandId
        });
        if (!finishCommandResult(commandId, result, t.taskCompleted)) return;
        await refreshProjectState(project, { silent: true });
      } catch (error) {
        appendLog("ERR", "var(--danger)", error instanceof Error ? error.message : String(error));
        finishCommandTask(commandId, "error", t.taskFailed);
      }
      return;
    }
    appendLog("INFO", "var(--text-2)", `update ${project.path}`);
    appendLog("OK", "var(--success)", "update check completed");
    appendCommandResultLog(commandId, previewChangeResult("update", project.path, installedRows));
    finishCommandTask(commandId, "success", t.taskCompleted);
  }

  async function openProjectFolder(project: Project | undefined) {
    if (!project) return;
    if (!isTauriRuntime()) {
      appendLog("INFO", "var(--text-2)", `open folder ${project.path}`);
      return;
    }
    try {
      await invoke("open_project_folder", { projectDir: project.path });
    } catch (error) {
      appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    }
  }

  async function openOpenDockUrl(url: string) {
    if (!isTauriRuntime()) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      await invoke("open_external_url", { url });
    } catch (error) {
      appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    }
  }

  async function copyProjectPath(project: Project | undefined) {
    if (!project) return;
    try {
      await navigator.clipboard.writeText(project.path);
      appendLog("OK", "var(--success)", `copied project path · ${project.folderName}`);
    } catch {
      appendLog("WARN", "var(--warning)", "project path copy failed");
    }
  }

  async function installDock(dock: Dock) {
    if (!activeProject) {
      appendLog("WARN", "var(--warning)", "select a project before installing a dock");
      return;
    }
    const dockId = dockFullId(dock);
    const commandId = beginCommandTask("install", dockId, activeProject.path);
    await waitForCommandPopupPaint();
    if (isTauriRuntime()) {
      try {
        const freshDock = await refreshDockDetail(dock);
        const dockRef = `${dockFullId(freshDock)}@${freshDock.version}`;
        appendLog("RUN", "var(--info)", `install ${dockRef}`);
        const result = await invoke<OpenDockCommandResult>("opendock_install", {
          projectDir: activeProject.path,
          dockRef,
          commandId
        });
        if (!finishCommandResult(commandId, result, t.taskCompleted)) return;
        await refreshProjectState(activeProject, { silent: true });
      } catch (error) {
        appendLog("ERR", "var(--danger)", error instanceof Error ? error.message : String(error));
        finishCommandTask(commandId, "error", t.taskFailed);
        return;
      }
    } else {
      const dockRef = `${dockId}@${dock.version}`;
      appendLog("INFO", "var(--text-2)", `install ${dockRef}`);
      appendLog("OK", "var(--success)", "resolved release · registry.opendock.app");
      appendLog("OK", "var(--success)", "files → AGENTS.md (managed block)");
      appendLog("OK", "var(--success)", "doctor · 6 checks passed");
      appendCommandResultLog(commandId, previewChangeResult("install", dockFullId(dock), installedRows, dock));
      finishCommandTask(commandId, "success", t.taskCompleted);
    }
    setInstalledDocks((current) => ({ ...current, [dockFullId(dock)]: true }));
  }

  async function deleteDock(dock: Dock) {
    if (!activeProject) {
      appendLog("WARN", "var(--warning)", "select a project before deleting a dock");
      return;
    }
    const dockId = dockFullId(dock);
    const commandId = beginCommandTask("delete", dockId, activeProject.path);
    await waitForCommandPopupPaint();
    if (isTauriRuntime()) {
      try {
        appendLog("RUN", "var(--info)", `uninstall ${dockId}`);
        const result = await invoke<OpenDockCommandResult>("opendock_uninstall", {
          projectDir: activeProject.path,
          dockId,
          commandId
        });
        if (!finishCommandResult(commandId, result, t.taskCompleted)) return;
        await refreshProjectState(activeProject);
      } catch (error) {
        appendLog("ERR", "var(--danger)", error instanceof Error ? error.message : String(error));
        finishCommandTask(commandId, "error", t.taskFailed);
        return;
      }
    } else {
      appendLog("INFO", "var(--text-2)", `uninstall ${dockId}`);
      appendLog("OK", "var(--success)", "dock removed from project");
      appendCommandResultLog(commandId, previewChangeResult("uninstall", dockId, installedRows, dock));
      finishCommandTask(commandId, "success", t.taskCompleted);
    }
    setInstalledDocks((current) => {
      const next = { ...current };
      delete next[dockFullId(dock)];
      delete next[dock.id];
      return next;
    });
  }

  async function handleWindow(action: "minimize" | "maximize" | "close") {
    try {
      const appWindow = getCurrentWindow();
      if (action === "minimize") await appWindow.minimize();
      if (action === "maximize") await appWindow.toggleMaximize();
      if (action === "close") await appWindow.close();
    } catch (error) {
      console.warn(`OpenDock window control failed: ${action}`, error);
    }
  }

  return (
    <div className="app-root" data-lang={lang} data-theme={theme}>
      <Titlebar
        accountName={accountMenuName}
        lang={lang}
        loggedIn={loggedIn}
        onAccount={() => setOpenMenu((current) => (current === "account" ? "" : "account"))}
        onAppMenu={() => setOpenMenu((current) => (current === "app" ? "" : "app"))}
        onAppMenuCommand={(id) => void runAppMenuCommand(id)}
        onClose={() => void handleWindow("close")}
        onLang={() => setOpenMenu((current) => (current === "lang" ? "" : "lang"))}
        onLogout={logout}
        onMaximize={() => void handleWindow("maximize")}
        onMinimize={() => void handleWindow("minimize")}
        onOpenProfile={() => setMainView("account")}
        onSetEnglish={() => {
          setLang("en");
          setOpenMenu("");
        }}
        onSetKorean={() => {
          setLang("ko");
          setOpenMenu("");
        }}
        onTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        openMenu={openMenu}
        projectPathLabel={projectPathLabel}
        t={t}
        windowControlPlatform={windowControlPlatform}
      />

      {overlayOpen ? <button aria-label={t.close} className="menu-overlay" onClick={() => setOpenMenu("")} type="button" /> : null}

      <main className="desktop-frame">
        {showAppLoading ? (
          <ProjectLoading t={t} />
        ) : !loggedIn ? (
          <SignInScreen
            authMessage={authMessage}
            authWorking={authWorking}
            onGmail={() => login("gmail")}
            onGitHub={() => login("github")}
            t={t}
          />
        ) : !activeProject ? (
          <ProjectEmpty onAddExisting={() => void addExistingProjectFromFolder()} onCreate={createBlankProject} t={t} />
        ) : (
          <Workspace
            activeProject={activeProject}
            catalogPage={catalogPage}
            catalogPageCount={catalogPageCount}
            detail={detail}
            detailTab={detailTab}
            detailVersion={selectedDetailVersion}
            dockView={dockView}
            installedDocks={activeInstalledDocks}
            installedRows={filteredInstalledRows}
            installedSearchQuery={installedSearchQuery}
            installedTotalCount={installedRows.length}
            lang={lang}
            logs={logs}
            myDocks={myDocks}
            myDocksCounts={myDocksCounts}
            myDocksPage={myDocksPage}
            myDocksPageCount={myDocksPageCount}
            myDocksTotal={myDocksTotal}
            myStarredDocks={myStarredDocks}
            nickname={nickname}
            accountEmail={accountEmail}
            commandTask={commandTask}
            onAddExisting={() => void addExistingProjectFromFolder()}
            onBack={() => setMainView("list")}
            onCancelCommand={() => void cancelCommandTask()}
            onCreate={createBlankProject}
            onDeleteDock={deleteDock}
            onInstallDock={installDock}
            onOpenAdd={() => {
              setProjectAddOpen(true);
              setProjectRenameOpen(false);
              setProjectDeleteOpen(false);
              setOpenMenu("");
            }}
            onOpenDetail={openDockDetail}
            onOpenProfile={() => setMainView("account")}
            onRemove={openDeleteProject}
            onRename={openRenameProject}
            onSaveNickname={saveNickname}
            onSelectProject={selectProject}
            onSetCatalogPage={setCatalogPage}
            onSetDetailTab={setDetailTab}
            onSetDetailVersion={(version) => setDetailVersion(version.version)}
            onSetInstalledSearchQuery={setInstalledSearchQuery}
            onSetMyDocksPage={setMyDocksPage}
            onSetSearchQuery={setSearchQuery}
            onSetSortMode={(mode) => {
              setSortMode(mode);
              setOpenMenu("");
            }}
            onSetVersionPage={setVersionPage}
            onSetView={setMainView}
            onToggleDockStar={toggleDockStar}
            onToggleSidebar={() => setProjectSidebarCollapsed((current) => !current)}
            onUpdateDocks={() => void updateDocks(activeProject, { showLogs: false })}
            openMenu={openMenu}
            projects={projects}
            projectSidebarCollapsed={projectSidebarCollapsed}
            searchQuery={searchQuery}
            setOpenMenu={setOpenMenu}
            shortcutBindings={shortcutBindings}
            shortcutPlatform={shortcutPlatform}
            shortcutStatus={shortcutStatus}
            sortMode={sortMode}
            sortedDocks={sortedDocks}
            starredDockIds={starredDockIds}
            starUpdatingId={starUpdatingId}
            t={t}
            updateAvailableCount={updateAvailableCount}
            versionPage={versionPage}
            versionPageCount={versionPageCount}
            onExportShortcuts={() => void exportShortcuts()}
            onImportShortcuts={() => void importShortcuts()}
            onResetAllShortcuts={resetAllShortcuts}
            onResetShortcut={resetShortcut}
            onSetShortcut={updateShortcut}
          />
        )}
      </main>

      {projectAddOpen ? (
        <ProjectAddModal
          onAddExisting={() => void addExistingProjectFromFolder()}
          onClose={() => setProjectAddOpen(false)}
          onCreate={createBlankProject}
          t={t}
        />
      ) : null}

      {projectRenameOpen ? (
        <ProjectRenameModal
          name={renameProjectName}
          onChange={setRenameProjectName}
          onClose={closeProjectRename}
          onSubmit={saveProjectRename}
          t={t}
        />
      ) : null}

      {projectDeleteOpen ? (
        <ProjectDeleteModal
          name={deleteProjectName}
          onCancel={closeProjectDelete}
          onConfirm={confirmProjectDelete}
          t={t}
        />
      ) : null}

      {commandTask ? (
        <CommandProgressDialog
          commandTask={commandTask}
          onClose={closeCommandProgress}
          onForceRetryCommand={() => void forceRetryCommand()}
          t={t}
        />
      ) : null}

      {commandPaletteOpen ? (
        <CommandPaletteDialog
          bindings={shortcutBindings}
          lang={lang}
          onClose={() => setCommandPaletteOpen(false)}
          onRun={(commandId) => {
            setCommandPaletteOpen(false);
            void runShortcutCommand(commandId);
          }}
          platform={shortcutPlatform}
          t={t}
        />
      ) : null}

      {projectSwitcherOpen ? (
        <ProjectSwitcherDialog
          activeProjectId={activeProjectId}
          onClose={() => setProjectSwitcherOpen(false)}
          onSelect={selectProject}
          projects={projects}
          t={t}
        />
      ) : null}
    </div>
  );
}
