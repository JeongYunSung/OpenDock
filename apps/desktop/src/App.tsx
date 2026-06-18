import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Folder,
  FolderOpen,
  Github,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  BASE_LOGS,
  dockFromInstalledRecord,
  dockFullId,
  dockShortId,
  mergeRegistryDockDetail,
  normalizeRegistryDock,
  normalizeRegistryVersions,
  type AuthSession,
  type AppLog,
  type DesktopAppState,
  type Dock,
  type DockStarResponse,
  type DockVersion,
  type DockView,
  type InstalledDockRecord,
  type Lang,
  type OpenDockChangeResult,
  type OpenDockCommandLine,
  type OpenDockCommandProgress,
  type OpenDockCommandResult,
  type OpenDockOutdatedReport,
  type Project,
  type ProjectFolder,
  type ProjectStateResult,
  type MyDock,
  type MyDocksCounts,
  type SortMode,
  TEXT,
  type Theme
} from "./data";
import {
  commandFailureMessage,
  commandLineLogEntry,
  commandResultRows,
  commandRowsContainMessage,
  commandTaskId,
  commandTaskLevel,
  commandTaskTitle,
  isAuthStatusLine,
  isNoUpdateProgress,
  isTaskActive,
  isTaskForTarget,
  logColor,
  nextCommandProgress,
  nowTime,
  openDockChangeResult,
  outdatedReportsByDockId,
  statusLabel,
  successStepForChangeResult,
  waitForCommandPopupPaint,
  type CommandForceRetry,
  type CommandTask,
  type CommandTaskKind,
  type CommandTaskRow,
  type CommandTaskStatus,
} from "./command-task";
import {
  emptyMyDocksCounts,
  requestCatalog,
  requestDockDetail,
  requestDockVersions,
  requestMyDocks,
  requestMyStars,
  requestSetDockStar,
  requestStarStatus,
} from "./registry-client";
import { ReadmePanel } from "./readme-panel";
import {
  DockIcon,
  IconButton,
  KeyboardButton,
  badgeSrc,
  findDockByKey,
  formatDateLabel,
  installedAtLabel,
  logoSrc,
  platformLabel,
  versionStatusClass,
  versionStatusLabel,
} from "./display";
import { GoogleMark, Meta, Pagination, StatRow } from "./desktop-ui";
import {
  exportShortcutConfig,
  findShortcutConflict,
  formatShortcutForDisplay,
  importShortcutConfig,
  resetShortcutOverride,
  setShortcutOverride,
  shortcutBindingsForPlatform,
  shortcutCommandForEvent,
  shortcutCommandLabel,
  type ShortcutBinding,
  type ShortcutCommandId,
  type ShortcutOverrides,
  type ShortcutPlatform,
  shortcutPlatformForWindow,
} from "./shortcuts";
import { useResponsivePageSizes } from "./responsive-page-size";
import { chooseShortcutFileFromBrowser, downloadShortcutFile, type ShortcutFileResult } from "./shortcut-file";
import { isTauriRuntime } from "./tauri-runtime";
import { useStoredState } from "./use-stored-state";
import {
  detectWindowControlPlatform,
  type WindowControlPlatform,
} from "./app-menu";
import { accountStatsFor, dockFromMyDock, myDockReviewGroup, myDockStatusLabel } from "./account-model";
import { ProjectAddModal, ProjectDeleteModal, ProjectRenameModal } from "./project-modals";
import { Titlebar, type OpenMenu } from "./titlebar";

const MAX_STORED_LOGS = 400;
const ACCOUNT_PAGE_LIMIT = 6;
type InstalledDockRow = Dock & {
  installedAt: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  updatePlatform?: string;
};

function shouldIgnoreGlobalShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented) return true;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target) return false;
  const editable =
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT";
  return editable && !event.metaKey && !event.ctrlKey;
}

function matchesInstalledSearch(dock: InstalledDockRow, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    dockFullId(dock),
    dock.short,
    dock.displayName,
    dock.owner,
    dock.publisher,
    dock.desc,
    dock.version,
    dock.latestVersion,
    ...dock.tags,
    ...dock.searchTerms
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function resolveActiveProjectId(projects: Project[], activeProjectId: string) {
  if (projects.some((project) => project.id === activeProjectId)) return activeProjectId;
  return projects[0]?.id ?? "";
}

export function App() {
  const [theme, setTheme] = useStoredState<Theme>("opendock.theme", "light");
  const [lang, setLang] = useStoredState<Lang>("opendock.lang", "ko");
  const [loggedIn, setLoggedIn] = useStoredState("opendock.loggedIn", false);
  const [authProvider, setAuthProvider] = useStoredState("opendock.authProvider", "");
  const [projects, setProjects] = useStoredState<Project[]>("opendock.projects", []);
  const [activeProjectId, setActiveProjectId] = useStoredState("opendock.activeProjectId", "");
  const [emptyProjectIndex, setEmptyProjectIndex] = useStoredState("opendock.emptyProjectIndex", 1);
  const [projectAddOpen, setProjectAddOpen] = useState(false);
  const [projectRenameOpen, setProjectRenameOpen] = useState(false);
  const [projectDeleteOpen, setProjectDeleteOpen] = useState(false);
  const [projectSidebarCollapsed, setProjectSidebarCollapsed] = useStoredState("opendock.projectSidebarCollapsed", false);
  const [renameProjectId, setRenameProjectId] = useState("");
  const [renameProjectName, setRenameProjectName] = useState("");
  const [deleteProjectId, setDeleteProjectId] = useState("");
  const [deleteProjectName, setDeleteProjectName] = useState("");
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
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [versionPage, setVersionPage] = useState(1);
  const [versionTotal, setVersionTotal] = useState(0);
  const [installedDocks, setInstalledDocks] = useStoredState<Record<string, boolean>>("opendock.installedDocks", {});
  const [installedRecords, setInstalledRecords] = useState<InstalledDockRecord[]>([]);
  const [outdatedReportsById, setOutdatedReportsById] = useState<Record<string, OpenDockOutdatedReport>>({});
  const [projectStateLoaded, setProjectStateLoaded] = useState(false);
  const [catalogDocks, setCatalogDocks] = useState<Dock[]>([]);
  const [dockDetails, setDockDetails] = useState<Record<string, Dock>>({});
  const [starredDockIds, setStarredDockIds] = useState<Record<string, boolean>>({});
  const [starUpdatingId, setStarUpdatingId] = useState("");
  const [myDocks, setMyDocks] = useState<MyDock[]>([]);
  const [myDocksPage, setMyDocksPage] = useState(1);
  const [myDocksTotal, setMyDocksTotal] = useState(0);
  const [myDocksCounts, setMyDocksCounts] = useState<MyDocksCounts>(() => emptyMyDocksCounts());
  const [myStarredDocks, setMyStarredDocks] = useState<Dock[]>([]);
  const [logs, setLogs] = useStoredState<AppLog[]>("opendock.logs", BASE_LOGS, {
    defer: true,
    normalize: (value) => (Array.isArray(value) ? value.slice(-MAX_STORED_LOGS) : BASE_LOGS),
  });
  const [shortcutOverrides, setShortcutOverrides] = useStoredState<ShortcutOverrides>("opendock.shortcutOverrides", {});
  const [shortcutStatus, setShortcutStatus] = useState("");
  const [commandTask, setCommandTaskState] = useState<CommandTask | null>(null);
  const commandTaskRef = useRef<CommandTask | null>(null);
  const blankProjectCreatingRef = useRef(false);
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

  const t = TEXT[lang];
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId]
  );
  const projectPathLabel = activeProject ? activeProject.path : t.noProjectPath;
  const registryDocks = catalogDocks;
  const visibleDocks = registryDocks;
  const installedFallbackDocks = useMemo(
    () => installedRecords.map((record, index) => dockFromInstalledRecord(record, index)),
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
  const detail = baseDetail ? dockDetails[detailKey] ?? baseDetail : null;
  const selectedDetailVersion = useMemo(
    () => detail?.versions?.find((version) => version.version === detailVersion) ?? detail?.versions?.[0] ?? null,
    [detail, detailVersion]
  );
  const activeInstalledDocks = useMemo(
    () =>
      projectStateLoaded
        ? Object.fromEntries(installedRecords.map((record) => [record.id, true]))
        : installedDocks,
    [projectStateLoaded, installedRecords, installedDocks]
  );
  const sortedDocks = useMemo(
    () =>
      [...visibleDocks].sort((a, b) => {
        if (sortMode === "name") return a.short.localeCompare(b.short);
        if (sortMode === "stars") return (b.stars ?? 0) - (a.stars ?? 0) || a.short.localeCompare(b.short);
        if (sortMode === "recent") {
          const byDate = new Date(b.updatedAt ?? "").getTime() - new Date(a.updatedAt ?? "").getTime();
          return Number.isNaN(byDate) || byDate === 0 ? b.fallbackSortRank - a.fallbackSortRank : byDate;
        }
        return (b.downloads ?? Number(b.downloadLabel)) - (a.downloads ?? Number(a.downloadLabel));
      }),
    [visibleDocks, sortMode]
  );
  const installedRows: InstalledDockRow[] = useMemo(
    () =>
      projectStateLoaded
        ? installedRecords.map((record, index) => ({
            ...(findDockByKey(allKnownDocks, record.id) ?? dockFromInstalledRecord(record, index)),
            version: record.version,
            checksum: record.checksum ?? findDockByKey(registryDocks, record.id)?.checksum ?? "-",
            installedAt: installedAtLabel(lang),
            latestVersion: outdatedReportsById[record.id]?.latestVersion,
            updateAvailable: outdatedReportsById[record.id]?.status === "outdated",
            updatePlatform: outdatedReportsById[record.id]?.platform
          }))
        : registryDocks
            .filter((dock) => activeInstalledDocks[dockFullId(dock)] || activeInstalledDocks[dock.id])
            .map((dock) => ({
              ...dock,
              installedAt: installedAtLabel(lang),
              updateAvailable: false
            })),
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
  const myDocksPageCount = Math.max(1, Math.ceil(myDocksTotal / ACCOUNT_PAGE_LIMIT));
  const overlayOpen = openMenu !== "";
  const accountMenuName = authProvider === "github" ? t.githubAccount : accountEmail;
  const showAppLoading = isTauriRuntime() && !appStateLoaded;
  const windowControlPlatform = detectWindowControlPlatform();
  const shortcutPlatform = shortcutPlatformForWindow(windowControlPlatform);
  const shortcutBindings = useMemo(
    () => shortcutBindingsForPlatform(shortcutOverrides, shortcutPlatform),
    [shortcutOverrides, shortcutPlatform]
  );

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

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [state, session] = await Promise.all([
          invoke<DesktopAppState>("opendock_load_app_state"),
          invoke<AuthSession>("opendock_auth_session")
        ]);
        if (cancelled) return;
        const loadedProjects = state.projects ?? [];
        setProjects(loadedProjects);
        setActiveProjectId(resolveActiveProjectId(loadedProjects, state.activeProjectId ?? ""));
        if (session.loggedIn) {
          setLoggedIn(true);
          setAuthProvider(session.provider ?? "google");
          if (session.email) setAccountEmail(session.email);
        } else {
          setLoggedIn(false);
          setAuthProvider("");
        }
      } catch (error) {
        if (!cancelled) {
          appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setAppStateLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || !appStateLoaded) return;
    const state: DesktopAppState = { projects, activeProjectId };
    void invoke("opendock_save_app_state", { state }).catch((error) => {
      appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    });
  }, [projects, activeProjectId, appStateLoaded]);

  useEffect(() => {
    const nextActiveProjectId = resolveActiveProjectId(projects, activeProjectId);
    if (nextActiveProjectId !== activeProjectId) setActiveProjectId(nextActiveProjectId);
  }, [projects, activeProjectId]);

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
    let cancelled = false;
    void requestCatalog(sortMode, searchQuery, catalogPage, catalogPageSize)
      .then((response) => {
        if (cancelled) return;
        const nextDocks = response.items.map((item, index) => normalizeRegistryDock(item, index));
        setCatalogDocks(nextDocks);
        setCatalogTotal(response.total ?? nextDocks.length);
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setCatalogDocks([]);
          setCatalogTotal(0);
          appendLog("WARN", "var(--warning)", message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [searchQuery, sortMode, catalogPage, catalogPageSize]);

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
    if (!baseDetail || dockView !== "detail") return;
    let cancelled = false;
    const load = async () => {
      try {
        const [detailResponse, versionsResponse] = await Promise.all([
          requestDockDetail(dockFullId(baseDetail)),
          requestDockVersions(dockFullId(baseDetail), versionPage, versionPageSize)
        ]);
        if (cancelled) return;
        const versions = normalizeRegistryVersions(versionsResponse);
        setVersionTotal(versionsResponse.total ?? versions.length);
        setDockDetails((current) => ({
          ...current,
          [detailKey]: mergeRegistryDockDetail(baseDetail, detailResponse, versions)
        }));
      } catch (error) {
        if (!cancelled) {
          appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [detailKey, dockView, versionPage, versionPageSize]);

  useEffect(() => {
    setDetailVersion("");
  }, [detailKey]);

  useEffect(() => {
    if (!loggedIn) {
      setStarredDockIds({});
      setMyStarredDocks([]);
      setMyDocks([]);
      return;
    }
    let cancelled = false;
    const ids = [
      ...catalogDocks.map((dock) => dockFullId(dock)),
      ...(detailKey ? [detailKey] : [])
    ].filter((id, index, values) => id && values.indexOf(id) === index);
    void requestStarStatus(ids)
      .then((response) => {
        if (cancelled) return;
        setStarredDockIds((current) => {
          const next = { ...current };
          for (const item of response.items ?? []) next[item.id] = item.starred;
          return next;
        });
      })
      .catch((error) => {
        if (!cancelled) appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, catalogDocks, detailKey]);

  useEffect(() => {
    if (!loggedIn) {
      setMyStarredDocks([]);
      setMyDocks([]);
      setMyDocksTotal(0);
      setMyDocksCounts(emptyMyDocksCounts());
      setMyDocksPage(1);
      return;
    }
    void refreshMyStars();
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn) return;
    void refreshMyDocks(myDocksPage);
  }, [loggedIn, myDocksPage]);

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
    setProjectAddOpen(false);
    setProjectRenameOpen(false);
    setProjectDeleteOpen(false);
    setProjectSidebarCollapsed(false);
    setRenameProjectId("");
    setRenameProjectName("");
    setDeleteProjectId("");
    setDeleteProjectName("");
    setInstalledDocks({});
    setInstalledRecords([]);
    setStarredDockIds({});
    setMyDocks([]);
    setMyDocksPage(1);
    setMyDocksTotal(0);
    setMyDocksCounts(emptyMyDocksCounts());
    setMyStarredDocks([]);
    setProjectStateLoaded(false);
    resetDockWorkspaceView();
  }

  function registerProject(name: string, folderName: string, path: string) {
    const cleanFolderName = (folderName || name || "selected-project").trim();
    const cleanName = (name || cleanFolderName).trim();
    const project = {
      id: `project-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      name: cleanName,
      folderName: cleanFolderName,
      path
    };
    setProjects((current) => [...current, project]);
    setActiveProjectId(project.id);
    setProjectAddOpen(false);
    setProjectRenameOpen(false);
    setProjectDeleteOpen(false);
    resetDockWorkspaceView();
  }

  async function createBlankProject() {
    if (blankProjectCreatingRef.current) return;
    blankProjectCreatingRef.current = true;
    const next = emptyProjectIndex;
    try {
      if (isTauriRuntime()) {
        try {
          const folder = await invoke<ProjectFolder>("create_blank_project", { index: next });
          registerProject(folder.name, folder.folder_name, folder.path);
          setEmptyProjectIndex((current) => current + 1);
          return;
        } catch {
          // Fall through to the preview-mode in-memory project.
        }
      }
      const folderName = `empty-project-${next}`;
      registerProject(`Empty Project ${next}`, folderName, `~/.opendock/project/${folderName}`);
      setEmptyProjectIndex((current) => current + 1);
    } finally {
      blankProjectCreatingRef.current = false;
    }
  }

  async function addExistingProjectFromFolder() {
    if (isTauriRuntime()) {
      try {
        const folder = await invoke<ProjectFolder | null>("pick_project_folder");
        if (folder) registerProject(folder.name, folder.folder_name, folder.path);
        return;
      } catch {
        // Fall through to the browser-compatible picker for preview mode.
      }
    }

    try {
      if (window.showDirectoryPicker) {
        const handle = await window.showDirectoryPicker();
        const folderName = handle.name || "selected-project";
        registerProject(folderName, folderName, `~/work/${folderName}`);
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "true");
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] as (File & { webkitRelativePath?: string }) | undefined;
        const root = file?.webkitRelativePath?.split("/")[0] || file?.name || "selected-project";
        registerProject(root, root, `~/work/${root}`);
        input.remove();
      },
      { once: true }
    );
    input.style.display = "none";
    document.body.appendChild(input);
    input.click();
  }

  function openRenameProject(project: Project) {
    setRenameProjectId(project.id);
    setRenameProjectName(project.name);
    setProjectRenameOpen(true);
    setProjectAddOpen(false);
    setProjectDeleteOpen(false);
    setOpenMenu("");
  }

  function closeProjectRename() {
    setProjectRenameOpen(false);
    setRenameProjectId("");
    setRenameProjectName("");
  }

  function saveProjectRename(event: FormEvent) {
    event.preventDefault();
    const nextName = renameProjectName.trim();
    if (!nextName) return;
    setProjects((current) => current.map((project) => (project.id === renameProjectId ? { ...project, name: nextName } : project)));
    closeProjectRename();
  }

  function openDeleteProject(project: Project) {
    setDeleteProjectId(project.id);
    setDeleteProjectName(project.name);
    setProjectDeleteOpen(true);
    setProjectAddOpen(false);
    setProjectRenameOpen(false);
    setOpenMenu("");
  }

  function closeProjectDelete() {
    setProjectDeleteOpen(false);
    setDeleteProjectId("");
    setDeleteProjectName("");
  }

  function confirmProjectDelete() {
    const project = projects.find((item) => item.id === deleteProjectId);
    if (!project) {
      closeProjectDelete();
      return;
    }
    removeProjectFromOpenDock(project);
  }

  function removeProjectFromOpenDock(project: Project | undefined) {
    if (!project) return;
    const nextProjects = projects.filter((item) => item.id !== project.id);
    const wasActiveProject = activeProjectId === project.id;
    setProjects(nextProjects);
    if (wasActiveProject) setActiveProjectId(nextProjects[0]?.id ?? "");
    setProjectAddOpen(false);
    setProjectRenameOpen(false);
    setProjectDeleteOpen(false);
    setRenameProjectId("");
    setRenameProjectName("");
    setDeleteProjectId("");
    setDeleteProjectName("");
    if (wasActiveProject) {
      resetDockWorkspaceView();
    } else {
      setOpenMenu("");
    }
    appendLog("OK", "var(--success)", `removed project · ${project.folderName}`);
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

  function updateShortcut(commandId: ShortcutCommandId, shortcut: string | null) {
    const conflict = findShortcutConflict(shortcutBindings, commandId, shortcut);
    if (conflict) {
      setShortcutStatus(
        t.shortcutConflict.replace("{command}", shortcutCommandLabel(conflict, lang))
      );
      return false;
    }
    setShortcutOverrides((current) => setShortcutOverride(current, commandId, shortcutPlatform, shortcut));
    setShortcutStatus(shortcut ? t.shortcutSaved : t.shortcutRemoved);
    return true;
  }

  function resetShortcut(commandId: ShortcutCommandId) {
    setShortcutOverrides((current) => resetShortcutOverride(current, commandId, shortcutPlatform));
    setShortcutStatus(t.shortcutResetDone);
  }

  function resetAllShortcuts() {
    setShortcutOverrides({});
    setShortcutStatus(t.shortcutResetAllDone);
  }

  async function importShortcuts() {
    try {
      const raw = isTauriRuntime()
        ? (await invoke<ShortcutFileResult | null>("opendock_import_shortcuts"))?.contents ?? null
        : await chooseShortcutFileFromBrowser();
      if (!raw) return;
      const next = importShortcutConfig(raw);
      setShortcutOverrides(next);
      setShortcutStatus(t.shortcutImportDone);
    } catch (error) {
      setShortcutStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function exportShortcuts() {
    try {
      const contents = exportShortcutConfig(shortcutOverrides);
      if (isTauriRuntime()) {
        const path = await invoke<string | null>("opendock_export_shortcuts", { contents });
        if (!path) return;
      } else {
        downloadShortcutFile(contents);
      }
      setShortcutStatus(t.shortcutExportDone);
    } catch (error) {
      setShortcutStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function saveNickname(nextNickname: string) {
    const normalized = nextNickname.trim();
    if (!normalized) return;
    setNickname(normalized);
  }

  async function refreshMyStars() {
    try {
      const response = await requestMyStars();
      const docks = (response.items ?? []).map((item, index) => normalizeRegistryDock(item.dock, index));
      setMyStarredDocks(docks);
      setStarredDockIds((current) => ({
        ...current,
        ...Object.fromEntries(docks.map((dock) => [dockFullId(dock), true]))
      }));
    } catch (error) {
      appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshMyDocks(page: number) {
    try {
      const response = await requestMyDocks(page, ACCOUNT_PAGE_LIMIT);
      setMyDocks(response.items ?? []);
      setMyDocksTotal(response.total ?? response.items?.length ?? 0);
      setMyDocksCounts(response.counts ?? emptyMyDocksCounts());
      if (response.page && response.page !== page) setMyDocksPage(response.page);
    } catch (error) {
      appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    }
  }

  async function toggleDockStar(dock: Dock) {
    const dockId = dockFullId(dock);
    if (starUpdatingId) return;
    if (!loggedIn) {
      appendLog("WARN", "var(--warning)", t.signInToStar);
      return;
    }
    const nextStarred = !starredDockIds[dockId];
    setStarUpdatingId(dockId);
    try {
      const response = await requestSetDockStar(dockId, nextStarred);
      applyDockStarResponse(response);
      await refreshMyStars();
    } catch (error) {
      appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    } finally {
      setStarUpdatingId("");
    }
  }

  function applyDockStarResponse(response: DockStarResponse) {
    const updateDock = (dock: Dock) =>
      dockFullId(dock) === response.id ? { ...dock, stars: response.stars } : dock;
    setStarredDockIds((current) => ({ ...current, [response.id]: response.starred }));
    setCatalogDocks((current) => current.map(updateDock));
    setDockDetails((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, dock]) => [key, updateDock(dock)])
      )
    );
    setMyStarredDocks((current) => {
      if (!response.starred) return current.filter((dock) => dockFullId(dock) !== response.id);
      return current.map(updateDock);
    });
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
    setLogs((current) => [
      ...current.slice(Math.max(0, current.length - (MAX_STORED_LOGS - 1))),
      { time: nowTime(), level, color, message },
    ]);
  }

  function setCommandTask(next: CommandTask | null | ((current: CommandTask | null) => CommandTask | null)) {
    setCommandTaskState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      commandTaskRef.current = value;
      return value;
    });
  }

  function beginCommandTask(kind: CommandTaskKind, target: string, projectPath?: string) {
    const task: CommandTask = {
      forceRetry: null,
      forceRetryUsed: false,
      id: commandTaskId(kind),
      kind,
      ...(projectPath === undefined ? {} : { projectPath }),
      target,
      progress: 8,
      status: "running",
      step: t.taskWaiting,
      lines: 0,
      rows: [{ time: nowTime(), level: "RUN", color: "var(--info)", message: target }],
      startedAt: nowTime(),
      updatedAt: nowTime()
    };
    setCommandTask(task);
    return task.id;
  }

  function applyCommandLineToTask(line: OpenDockCommandLine) {
    setCommandTask((current) => {
      if (!current || current.status !== "running") return current;
      return {
        ...current,
        progress: nextCommandProgress(current, line),
        step: line.message,
        lines: current.lines + 1,
        rows: [
          { time: nowTime(), level: line.level.toUpperCase(), color: logColor(line.level.toUpperCase()), message: line.message },
          ...current.rows
        ].slice(0, 20),
        updatedAt: nowTime()
      };
    });
  }

  function applyCommandProgressToTask(progress: OpenDockCommandProgress) {
    setCommandTask((current) => {
      if (!current || current.status !== "running") return current;
      if (progress.commandId && progress.commandId !== current.id) return current;
      const level = progress.level.toUpperCase();
      const percent = Number.isFinite(progress.percent)
        ? Math.max(current.progress, Math.min(100, progress.percent))
        : current.progress;
      const row = { time: nowTime(), level, color: logColor(level), message: progress.message };
      const suppressProgressRow = isNoUpdateProgress(progress);
      const shouldAddRow =
        !suppressProgressRow &&
        (current.rows[0]?.message !== progress.message || current.rows[0]?.level !== level);
      return {
        ...current,
        progress: percent,
        step: suppressProgressRow ? current.step : progress.message,
        lines: current.lines + 1,
        rows: shouldAddRow ? [row, ...current.rows].slice(0, 20) : current.rows,
        updatedAt: nowTime()
      };
    });
  }

  function finishCommandTask(
    commandId: string,
    status: Exclude<CommandTaskStatus, "running" | "cancelling">,
    step: string,
    options: { forceRetry?: CommandForceRetry | null } = {}
  ) {
    setCommandTask((current) => {
      if (!current || current.id !== commandId) return current;
      const hasSpecificError = status === "error" && current.rows.some((row) => row.level === "ERR" && row.message !== step);
      const nextRows =
        current.step === step || hasSpecificError
          ? current.rows
          : [
              { time: nowTime(), level: commandTaskLevel(status), color: logColor(commandTaskLevel(status)), message: step },
              ...current.rows
            ].slice(0, 20);
      return {
        ...current,
        forceRetry: options.forceRetry === undefined ? current.forceRetry : options.forceRetry,
        progress: status === "success" ? 100 : current.progress,
        status,
        step,
        rows: nextRows,
        updatedAt: nowTime()
      };
    });
  }

  async function cancelCommandTask() {
    const task = commandTaskRef.current;
    if (!task || !isTaskActive(task)) return;
    setCommandTask((current) => {
      if (!current || current.id !== task.id) return current;
      return {
        ...current,
        status: "cancelling",
        step: t.taskCancelling,
        rows: [
          { time: nowTime(), level: "WARN", color: "var(--warning)", message: t.taskCancelling },
          ...current.rows
        ].slice(0, 20),
        updatedAt: nowTime()
      };
    });
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
    setCommandTask((current) => {
      if (!current || current.id !== task.id) return current;
      return {
        ...current,
        forceRetry: null,
        forceRetryUsed: true,
        progress: 12,
        status: "running",
        step: t.forceRetryLog,
        rows: [
          { time: nowTime(), level: "WARN", color: logColor("WARN"), message: t.forceRetryLog },
          ...current.rows
        ].slice(0, 20),
        updatedAt: nowTime()
      };
    });
    appendLog("WARN", "var(--warning)", `${retry.kind === "update" ? "force update" : "force uninstall"} ${retry.dockId ?? retry.projectPath}`);
    await waitForCommandPopupPaint();

    if (!isTauriRuntime()) {
      const dock = retry.dockId ? findDockByKey(allKnownDocks, retry.dockId) ?? undefined : undefined;
      appendCommandResultLog(
        task.id,
        previewChangeResult(retry.kind === "update" ? "update" : "uninstall", retry.dockId ?? retry.projectPath, dock),
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

  function finishCommandResult(commandId: string, result: OpenDockCommandResult, successStep: string) {
    const changeResult = openDockChangeResult(result.json);
    if (result.success) {
      appendCommandResultLog(commandId, changeResult);
      finishCommandTask(commandId, "success", successStepForChangeResult(changeResult, successStep, t), { forceRetry: null });
      return true;
    }
    const current = commandTaskRef.current;
    appendCommandFailureLog(commandId, changeResult);
    const forceRetry = current ? commandForceRetryFor(current, changeResult) : null;
    finishCommandTask(
      commandId,
      current?.id === commandId && current.status === "cancelling" ? "cancelled" : "error",
      current?.id === commandId && current.status === "cancelling" ? t.taskCancelled : t.taskFailed,
      { forceRetry }
    );
    return false;
  }

  function appendCommandResultLog(commandId: string, result: OpenDockChangeResult | null) {
    if (!result) return;
    const rows = commandResultRows(result, t);
    if (rows.length === 0) return;
    setCommandTask((current) => {
      if (!current || current.id !== commandId) return current;
      return {
        ...current,
        rows: [...rows, ...current.rows].slice(0, 20),
        updatedAt: nowTime()
      };
    });
  }

  function appendCommandFailureLog(commandId: string, result: OpenDockChangeResult | null) {
    if (!result || result.success) return;
    const rows: CommandTaskRow[] = [];
    const currentRows = commandTaskRef.current?.id === commandId ? commandTaskRef.current.rows : [];
    if (result.message && !commandRowsContainMessage(currentRows, result.message)) {
      rows.push({ time: nowTime(), level: "ERR", color: logColor("ERR"), message: result.message });
    }
    if (result.forceable) {
      rows.push({ time: nowTime(), level: "WARN", color: logColor("WARN"), message: t.forceRetryWarning });
    }
    if (rows.length === 0) return;
    setCommandTask((current) => {
      if (!current || current.id !== commandId) return current;
      return {
        ...current,
        rows: [...rows, ...current.rows].slice(0, 20),
        updatedAt: nowTime()
      };
    });
  }

  function commandForceRetryFor(task: CommandTask, result: OpenDockChangeResult | null): CommandForceRetry | null {
    if (!result?.forceable || task.forceRetryUsed) return null;
    if (task.kind === "update") {
      return { kind: "update", projectPath: task.projectPath ?? task.target };
    }
    if (task.kind === "delete" && task.projectPath) {
      return { dockId: task.target, kind: "delete", projectPath: task.projectPath };
    }
    return null;
  }

  function closeCommandProgress() {
    setCommandTask((current) => (isTaskActive(current) ? current : null));
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

  async function refreshDockDetail(dock: Dock) {
    const dockId = dockFullId(dock);
    const base = findDockByKey([...catalogDocks, dock], dockId) ?? dock;
    const [detailResponse, versionsResponse] = await Promise.all([
      requestDockDetail(dockId),
      requestDockVersions(dockId, 1, versionPageSize)
    ]);
    const versions = normalizeRegistryVersions(versionsResponse);
    setVersionTotal(versionsResponse.total ?? versions.length);
    const freshDock = mergeRegistryDockDetail(base, detailResponse, versions);
    setDockDetails((current) => ({
      ...current,
      [dockId]: freshDock
    }));
    setCatalogDocks((current) => current.map((item) => (dockFullId(item) === dockId ? mergeRegistryDockDetail(item, detailResponse, versions) : item)));
    return freshDock;
  }

  async function refreshProjectLogs(project: Project | undefined) {
    if (!project || !isTauriRuntime()) return;
    try {
      const result = await invoke<OpenDockCommandResult>("opendock_log", { projectDir: project.path });
      setLogs(result.lines.slice(-MAX_STORED_LOGS).map(commandLineLogEntry));
    } catch (error) {
      appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshCatalogFromRegistry() {
    try {
      const response = await requestCatalog(sortMode, searchQuery, catalogPage, catalogPageSize);
      const nextDocks = response.items.map((item, index) => normalizeRegistryDock(item, index));
      setCatalogDocks(nextDocks);
      setCatalogTotal(response.total ?? nextDocks.length);
      appendLog("OK", "var(--success)", "registry refreshed · registry.opendock.app");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCatalogDocks([]);
      setCatalogTotal(0);
      appendLog("WARN", "var(--warning)", message);
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
    appendCommandResultLog(commandId, previewChangeResult("update", project.path));
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
      appendCommandResultLog(commandId, previewChangeResult("install", dockFullId(dock), dock));
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
      appendCommandResultLog(commandId, previewChangeResult("uninstall", dockId, dock));
      finishCommandTask(commandId, "success", t.taskCompleted);
    }
    setInstalledDocks((current) => {
      const next = { ...current };
      delete next[dockFullId(dock)];
      delete next[dock.id];
      return next;
    });
  }

  function previewChangeResult(operation: "install" | "uninstall" | "update", target: string, dock?: Dock): OpenDockChangeResult {
    const version = dock?.version ?? "preview";
    const dockId = dock ? dockFullId(dock) : target;
    if (operation === "uninstall") {
      return {
        operation,
        reports: [
          {
            dockId,
            fileChanges: { created: [], deleted: ["AGENTS.md"], reviewRequired: [], updated: [".opendock/dock.lock.yml"] },
            filesCreated: 0,
            filesDeleted: 1,
            filesReviewRequired: 0,
            filesUpdated: 1,
            operation,
            status: "uninstalled",
            version
          }
        ],
        success: true,
        summary: { created: [], deleted: ["AGENTS.md"], reviewRequired: [], unchanged: [], updated: [".opendock/dock.lock.yml"] }
      };
    }
    if (operation === "update") {
      const rows = installedRows.length > 0 ? installedRows : [];
      return {
        operation,
        reports: rows.map((row) => ({
          dockId: dockFullId(row),
          fileChanges: { created: [], deleted: [], reviewRequired: [], updated: ["AGENTS.md"] },
          filesCreated: 0,
          filesDeleted: 0,
          filesReviewRequired: 0,
          filesUpdated: 1,
          fromVersion: row.version,
          operation,
          status: "updated",
          toVersion: row.version,
          version: row.version
        })),
        success: true,
        summary: { created: [], deleted: [], reviewRequired: [], unchanged: [], updated: rows.length > 0 ? ["AGENTS.md"] : [] }
      };
    }
    return {
      operation,
      reports: [
        {
          dockId,
          fileChanges: { created: ["AGENTS.md", "DESIGN.md"], deleted: [], reviewRequired: [], updated: [] },
          filesCreated: 2,
          filesDeleted: 0,
          filesReviewRequired: 0,
          filesUpdated: 0,
          operation,
          status: "installed",
          toVersion: version,
          version
        }
      ],
      success: true,
      summary: { created: ["AGENTS.md", "DESIGN.md"], deleted: [], reviewRequired: [], unchanged: [], updated: [] }
    };
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
          onCancelCommand={() => void cancelCommandTask()}
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

function SignInScreen(props: { authMessage: string; authWorking: boolean; onGmail: () => void; onGitHub: () => void; t: (typeof TEXT)[Lang] }) {
  return (
    <section className="center-stage">
      <div className="signin-card">
        <img alt="OpenDock logo" src={logoSrc} />
        <div className="kicker">{props.t.memberSignIn}</div>
        <h1>{props.t.signInTitle}</h1>
        <p>{props.t.signInSub}</p>
        {props.authMessage ? <p className="signin-status">{props.authMessage}</p> : null}
        <div className="signin-actions">
          <button disabled={props.authWorking} onClick={props.onGmail} type="button">
            <GoogleMark /> {props.t.continueGmail}
          </button>
          <button disabled={props.authWorking} onClick={props.onGitHub} type="button">
            <Github size={19} /> {props.t.continueGitHub}
          </button>
        </div>
      </div>
    </section>
  );
}

function ProjectEmpty(props: { onAddExisting: () => void; onCreate: () => void; t: (typeof TEXT)[Lang] }) {
  return (
    <section className="project-empty">
      <div>
        <div className="kicker">{props.t.noProjectKicker}</div>
        <h2>{props.t.noProjectTitle}</h2>
      </div>
      <div className="project-choice-grid">
        <button className="project-choice primary" onClick={props.onCreate} type="button">
          <span>
            <Plus size={21} />
          </span>
          <strong>{props.t.createProjectAction}</strong>
          <small>{props.t.createProjectSub}</small>
        </button>
        <button className="project-choice" onClick={props.onAddExisting} type="button">
          <span>
            <FolderOpen size={21} />
          </span>
          <strong>{props.t.continueWithoutProjectAction}</strong>
          <small>{props.t.continueWithoutProjectSub}</small>
        </button>
      </div>
    </section>
  );
}

function ProjectLoading(props: { t: (typeof TEXT)[Lang] }) {
  return (
    <section className="project-empty project-loading">
      <div>
        <div className="kicker">OpenDock</div>
        <h2>{props.t.loadingWorkspace}</h2>
      </div>
    </section>
  );
}

function Workspace(props: {
  activeProject: Project;
  accountEmail: string;
  catalogPage: number;
  catalogPageCount: number;
  commandTask: CommandTask | null;
  detail: Dock | null;
  detailTab: "readme" | "versions";
  detailVersion: DockVersion | null;
  dockView: DockView;
  installedDocks: Record<string, boolean>;
  installedRows: InstalledDockRow[];
  installedSearchQuery: string;
  installedTotalCount: number;
  lang: Lang;
  logs: AppLog[];
  myDocks: MyDock[];
  myDocksCounts: MyDocksCounts;
  myDocksPage: number;
  myDocksPageCount: number;
  myDocksTotal: number;
  myStarredDocks: Dock[];
  nickname: string;
  onAddExisting: () => void;
  onBack: () => void;
  onCancelCommand: () => void;
  onCreate: () => void;
  onDeleteDock: (dock: Dock) => void;
  onInstallDock: (dock: Dock) => void;
  onOpenAdd: () => void;
  onOpenDetail: (dockId: string) => void;
  onOpenProfile: () => void;
  onRemove: (project: Project) => void;
  onRename: (project: Project) => void;
  onSaveNickname: (nickname: string) => void;
  onSelectProject: (projectId: string) => void;
  onSetCatalogPage: (page: number) => void;
  onSetDetailTab: (tab: "readme" | "versions") => void;
  onSetDetailVersion: (version: DockVersion) => void;
  onSetInstalledSearchQuery: (query: string) => void;
  onSetMyDocksPage: (page: number) => void;
  onSetSearchQuery: (query: string) => void;
  onSetSortMode: (mode: SortMode) => void;
  onSetVersionPage: (page: number) => void;
  onSetView: (view: DockView) => void;
  onToggleDockStar: (dock: Dock) => void;
  onToggleSidebar: () => void;
  onUpdateDocks: () => void;
  openMenu: OpenMenu;
  projects: Project[];
  projectSidebarCollapsed: boolean;
  searchQuery: string;
  setOpenMenu: (menu: OpenMenu) => void;
  shortcutBindings: ShortcutBinding[];
  shortcutPlatform: ShortcutPlatform;
  shortcutStatus: string;
  sortMode: SortMode;
  sortedDocks: Dock[];
  starredDockIds: Record<string, boolean>;
  starUpdatingId: string;
  t: (typeof TEXT)[Lang];
  updateAvailableCount: number;
  versionPage: number;
  versionPageCount: number;
  onExportShortcuts: () => void;
  onImportShortcuts: () => void;
  onResetAllShortcuts: () => void;
  onResetShortcut: (commandId: ShortcutCommandId) => void;
  onSetShortcut: (commandId: ShortcutCommandId, shortcut: string | null) => boolean;
}) {
  const showTabs = props.dockView !== "account";
  return (
    <section className="workspace">
      {showTabs ? (
        <ProjectSidebar
          activeProject={props.activeProject}
          collapsed={props.projectSidebarCollapsed}
          detail={props.detail}
          detailTab={props.detailTab}
          detailVersion={props.detailVersion}
          detailView={props.dockView === "detail"}
          onOpenAdd={props.onOpenAdd}
          onRemove={props.onRemove}
          onRename={props.onRename}
          onSelect={props.onSelectProject}
          onToggle={props.onToggleSidebar}
          projects={props.projects}
          t={props.t}
        />
      ) : null}

      <div className="workspace-main">
        {showTabs ? (
          <nav className="dock-tabs">
            <button className={props.dockView === "list" || props.dockView === "detail" ? "active" : ""} onClick={() => props.onSetView("list")} type="button">
              {props.t.explore}
            </button>
            <button className={props.dockView === "installed" ? "active" : ""} onClick={() => props.onSetView("installed")} type="button">
              {props.t.installed}
            </button>
            <button className={props.dockView === "logs" ? "active" : ""} onClick={() => props.onSetView("logs")} type="button">
              {props.t.logs}
            </button>
          </nav>
        ) : null}

        {props.dockView === "list" ? <ExplorePanel {...props} /> : null}
        {props.dockView === "detail" ? (
          props.detail ? <DetailPanel {...props} detail={props.detail} /> : <CatalogEmptyState t={props.t} />
        ) : null}
        {props.dockView === "installed" ? <InstalledPanel {...props} /> : null}
        {props.dockView === "logs" ? <LogsPanel activeProject={props.activeProject} logs={props.logs} t={props.t} /> : null}
        {props.dockView === "account" ? (
          <AccountPanel
            accountEmail={props.accountEmail}
            lang={props.lang}
            myDocks={props.myDocks}
            myDocksCounts={props.myDocksCounts}
            myDocksPage={props.myDocksPage}
            myDocksPageCount={props.myDocksPageCount}
            myDocksTotal={props.myDocksTotal}
            myStarredDocks={props.myStarredDocks}
            nickname={props.nickname}
            onBack={props.onBack}
            onOpenDetail={props.onOpenDetail}
            onSaveNickname={props.onSaveNickname}
            onSetMyDocksPage={props.onSetMyDocksPage}
            t={props.t}
          />
        ) : null}
      </div>
    </section>
  );
}

function ProjectSidebar(props: {
  activeProject: Project;
  collapsed: boolean;
  detail: Dock | null;
  detailTab: "readme" | "versions";
  detailVersion: DockVersion | null;
  detailView: boolean;
  onOpenAdd: () => void;
  onRemove: (project: Project) => void;
  onRename: (project: Project) => void;
  onSelect: (projectId: string) => void;
  onToggle: () => void;
  projects: Project[];
  t: (typeof TEXT)[Lang];
}) {
  if (props.collapsed) {
    return (
      <aside className="project-sidebar collapsed">
        <IconButton label={props.t.expandProjects} onClick={props.onToggle}>
          <ChevronRight size={13} />
        </IconButton>
      </aside>
    );
  }

  return (
    <aside className="project-sidebar">
      <div className="project-sidebar-top">
        <div className="project-sidebar-head">
          <div>
            <IconButton label={props.t.collapseProjects} onClick={props.onToggle}>
              <ChevronLeft size={13} />
            </IconButton>
            <span>{props.t.projects}</span>
          </div>
          <IconButton label={props.t.addProjectTitle} onClick={props.onOpenAdd}>
            <Plus size={13} />
          </IconButton>
        </div>
        <div className="project-list">
          {props.projects.map((project) => {
            const active = project.id === props.activeProject.id;
            return (
              <div className={`project-row ${active ? "active" : ""}`} key={project.id}>
                <button onClick={() => props.onSelect(project.id)} type="button">
                  <Folder size={16} />
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.folderName}</small>
                  </span>
                </button>
                <IconButton label={props.t.renameProjectTitle} onClick={() => props.onRename(project)}>
                  <Pencil size={13} />
                </IconButton>
                <IconButton className="danger" label={props.t.deleteProjectTitle} onClick={() => props.onRemove(project)}>
                  <X size={13} />
                </IconButton>
              </div>
            );
          })}
        </div>
      </div>
      {props.detailView && props.detail ? (
        <DetailSidebar detail={props.detail} detailTab={props.detailTab} detailVersion={props.detailVersion} t={props.t} />
      ) : null}
    </aside>
  );
}

function DetailSidebar(props: { detail: Dock; detailTab: "readme" | "versions"; detailVersion: DockVersion | null; t: (typeof TEXT)[Lang] }) {
  const version = props.detailVersion;
  return (
    <div className="detail-sidebar">
      {props.detailTab === "readme" ? (
        <>
          <h4>{props.t.packageDetails}</h4>
          <Meta label={props.t.latestRelease} value={props.detail.version} />
          <Meta label={props.t.downloads} value={props.detail.downloadLabel} />
          <Meta label={props.t.stars} value={String(props.detail.stars ?? 0)} />
          <Meta label={props.t.updated} value={formatDateLabel(props.detail.updatedAt)} />
          <Meta label={props.t.publisher} value={props.detail.publisher ?? props.detail.owner ?? "opendock"} />
          <h4>{props.t.tags}</h4>
          <div className="tag-wrap">{props.detail.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <h4>{props.t.supportedPlatforms}</h4>
          <div className="tag-wrap">
            {(props.detail.platforms?.length ? props.detail.platforms : ["macos", "windows"]).map((platform) => (
              <span key={platform}>{platformLabel(platform)}</span>
            ))}
          </div>
        </>
      ) : (
        <>
          <h4>{props.t.versions}</h4>
          <Meta label={props.t.version} value={version?.version ?? props.detail.version} />
          <Meta label="Archive" value={version?.size ?? props.detail.size} />
          <Meta label="Checksum" value={version?.checksum ?? props.detail.checksum} />
          <Meta label={props.t.status} value={versionStatusLabel(version?.status)} />
          <Meta label={props.t.downloads} value={version?.downloadCount == null ? props.detail.downloadLabel : String(version.downloadCount)} />
          <Meta label={props.t.updated} value={formatDateLabel(version?.publishedAt ?? props.detail.updatedAt)} />
        </>
      )}
    </div>
  );
}

function ExplorePanel(props: {
  catalogPage: number;
  catalogPageCount: number;
  openMenu: OpenMenu;
  onOpenDetail: (dockId: string) => void;
  onSetCatalogPage: (page: number) => void;
  onSetSearchQuery: (query: string) => void;
  onSetSortMode: (mode: SortMode) => void;
  onToggleDockStar: (dock: Dock) => void;
  searchQuery: string;
  setOpenMenu: (menu: OpenMenu) => void;
  sortMode: SortMode;
  sortedDocks: Dock[];
  starredDockIds: Record<string, boolean>;
  starUpdatingId: string;
  t: (typeof TEXT)[Lang];
}) {
  const sortLabels = {
    downloads: props.t.sortDownloads,
    stars: props.t.sortStars,
    recent: props.t.sortRecent,
    name: props.t.sortName
  };

  return (
    <div className="panel explore-panel">
      <h1>{props.t.heroTitle}</h1>
      <p>{props.t.heroSub}</p>
      <div className="explore-tools">
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label={props.t.search}
            onChange={(event) => props.onSetSearchQuery(event.target.value)}
            placeholder={props.t.search}
            type="search"
            value={props.searchQuery}
          />
        </label>
        <div className="menu-anchor">
          <button className="sort-button" onClick={() => props.setOpenMenu(props.openMenu === "sort" ? "" : "sort")} type="button">
            {sortLabels[props.sortMode]} <ChevronDown size={14} />
          </button>
          {props.openMenu === "sort" ? (
            <div className="dropdown-menu compact sort-menu">
              {(["downloads", "stars", "recent", "name"] as const).map((mode) => (
                <button className={mode === props.sortMode ? "selected" : ""} key={mode} onClick={() => props.onSetSortMode(mode)} type="button">
                  {sortLabels[mode]}
                  <span />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {props.sortedDocks.length > 0 ? (
        <>
          <div className="dock-grid">
            {props.sortedDocks.map((dock) => (
              <DockCard
                dock={dock}
                key={dockFullId(dock)}
                onOpen={() => props.onOpenDetail(dockFullId(dock))}
                onToggleStar={props.onToggleDockStar}
                starred={Boolean(props.starredDockIds[dockFullId(dock)])}
                starBusy={props.starUpdatingId === dockFullId(dock)}
                t={props.t}
              />
            ))}
          </div>
          <Pagination
            label={props.t.explorePagination}
            onPageChange={props.onSetCatalogPage}
            page={props.catalogPage}
            pageCount={props.catalogPageCount}
            t={props.t}
          />
        </>
      ) : (
        <CatalogEmptyState t={props.t} />
      )}
    </div>
  );
}

function CatalogEmptyState(props: { t: (typeof TEXT)[Lang] }) {
  return (
    <div className="empty-state">
      <strong>{props.t.noDocksTitle}</strong>
      <p>{props.t.noDocksSub}</p>
    </div>
  );
}

function DockCard(props: {
  dock: Dock;
  onOpen: () => void;
  onToggleStar: (dock: Dock) => void;
  starred: boolean;
  starBusy: boolean;
  t: (typeof TEXT)[Lang];
}) {
  const platforms = props.dock.platforms?.length ? props.dock.platforms : ["macos", "windows"];
  return (
    <KeyboardButton ariaLabel={`${props.t.openDetail}: ${dockFullId(props.dock)}`} className="dock-card" onOpen={props.onOpen}>
      <div className="dock-card-head">
        <DockIcon dock={props.dock} />
        <div>
          <div className="dock-title">
            <strong>{props.dock.short}</strong>
          </div>
          <small className="dock-publisher-line">
            {props.t.by} {props.dock.publisher ?? props.dock.owner ?? "opendock"}
            {props.dock.official === false ? null : <img alt="official badge" src={badgeSrc} />}
          </small>
        </div>
      </div>
      <p>{props.dock.desc}</p>
      <div className="tag-wrap">
        <span>{props.dock.primaryTag}</span>
        <span>{props.dock.secondaryTag}</span>
        <span>+{props.dock.extraTagCount}</span>
      </div>
      <div className="card-foot">
        <div>
          {platforms.map((platform) => (
            <span key={platform}>{platformLabel(platform)}</span>
          ))}
        </div>
        <div className="dock-metrics">
          <DockMetric count={props.dock.downloadLabel} icon={<Download size={13} />} label={props.t.downloads} />
          <StarButton
            busy={props.starBusy}
            count={props.dock.stars ?? 0}
            dock={props.dock}
            onToggle={props.onToggleStar}
            starred={props.starred}
            t={props.t}
          />
        </div>
      </div>
    </KeyboardButton>
  );
}

function DockMetric(props: { count: string | number; icon: ReactNode; label: string }) {
  return (
    <span aria-label={`${props.count} ${props.label}`} className="dock-metric" title={`${props.count} ${props.label}`}>
      {props.icon}
      <span>{props.count}</span>
    </span>
  );
}

function StarButton(props: {
  busy?: boolean;
  count: number;
  dock: Dock;
  onToggle: (dock: Dock) => void;
  starred: boolean;
  t: (typeof TEXT)[Lang];
}) {
  const label = `${props.starred ? props.t.unstarAction : props.t.starAction}: ${dockFullId(props.dock)}`;
  return (
    <button
      aria-label={label}
      className={`star-button ${props.starred ? "starred" : ""}`}
      disabled={props.busy}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onToggle(props.dock);
      }}
      title={label}
      type="button"
    >
      <Star fill={props.starred ? "currentColor" : "none"} size={13} />
      <span>{props.count}</span>
    </button>
  );
}

function DetailPanel(props: {
  commandTask: CommandTask | null;
  detail: Dock;
  detailTab: "readme" | "versions";
  detailVersion: DockVersion | null;
  installedDocks: Record<string, boolean>;
  onBack: () => void;
  onCancelCommand: () => void;
  onDeleteDock: (dock: Dock) => void;
  onInstallDock: (dock: Dock) => void;
  onSetDetailTab: (tab: "readme" | "versions") => void;
  onSetDetailVersion: (version: DockVersion) => void;
  onSetVersionPage: (page: number) => void;
  onToggleDockStar: (dock: Dock) => void;
  starredDockIds: Record<string, boolean>;
  starUpdatingId: string;
  t: (typeof TEXT)[Lang];
  versionPage: number;
  versionPageCount: number;
}) {
  const fullId = dockFullId(props.detail);
  const installed = Boolean(props.installedDocks[fullId] || props.installedDocks[props.detail.id]);
  const publisher = props.detail.publisher ?? props.detail.owner ?? "opendock";
  const taskActive = isTaskActive(props.commandTask);
  return (
    <div className="panel detail-panel">
      <div className="detail-sticky-header">
        <div className="detail-hero">
          <button aria-label={props.t.back} className="detail-back-button" onClick={props.onBack} title={props.t.back} type="button">
            <ChevronLeft className="detail-back-icon-compact" size={19} />
            <ArrowLeft className="detail-back-icon-expanded" size={15} />
            <span className="detail-back-label">{props.t.back}</span>
          </button>
          <div className="detail-identity">
            <DockIcon dock={props.detail} size="small" />
            <div className="detail-copy">
              <div className="detail-breadcrumb">{props.t.explore} / {props.detail.owner ?? "opendock"}</div>
              <div className="detail-title-row">
                <h1>{fullId}</h1>
              </div>
              <div className="detail-meta">
                {props.t.by} {publisher} {props.detail.official === false ? null : <img alt="official badge" src={badgeSrc} />} <span>·</span> {props.t.updated} {formatDateLabel(props.detail.updatedAt)}
                <span>·</span>
                <StarButton
                  busy={props.starUpdatingId === fullId}
                  count={props.detail.stars ?? 0}
                  dock={props.detail}
                  onToggle={props.onToggleDockStar}
                  starred={Boolean(props.starredDockIds[fullId])}
                  t={props.t}
                />
              </div>
              {props.detail.desc ? <p className="detail-header-description">{props.detail.desc}</p> : null}
            </div>
          </div>
          <div className="detail-action">
            {installed ? (
              <button className="danger-button" disabled={taskActive} onClick={() => props.onDeleteDock(props.detail)} type="button">
                {taskActive ? props.t.taskWorking : props.t.deleteAction}
              </button>
            ) : (
              <button className="primary-button" disabled={taskActive} onClick={() => props.onInstallDock(props.detail)} type="button">
                {taskActive ? props.t.taskWorking : props.t.installAction}
              </button>
            )}
          </div>
        </div>
        <div className="detail-tabs">
          <button className={props.detailTab === "readme" ? "active" : ""} onClick={() => props.onSetDetailTab("readme")} type="button">
            {props.t.readme}
          </button>
          <button className={props.detailTab === "versions" ? "active" : ""} onClick={() => props.onSetDetailTab("versions")} type="button">
            {props.t.versions}
          </button>
        </div>
      </div>
      {props.detailTab === "readme" ? (
        <ReadmePanel detail={props.detail} t={props.t} />
      ) : (
        <VersionsPanel
          detail={props.detail}
          onPageChange={props.onSetVersionPage}
          onSelectVersion={props.onSetDetailVersion}
          page={props.versionPage}
          pageCount={props.versionPageCount}
          selectedVersion={props.detailVersion}
          t={props.t}
        />
      )}
    </div>
  );
}

function VersionsPanel(props: {
  detail: Dock;
  onPageChange: (page: number) => void;
  onSelectVersion: (version: DockVersion) => void;
  page: number;
  pageCount: number;
  selectedVersion: DockVersion | null;
  t: (typeof TEXT)[Lang];
}) {
  const versions: DockVersion[] = props.detail.versions ?? [];
  return (
    <div className="versions-panel">
      <h2>{props.t.versions}</h2>
      {versions.length > 0 ? (
        <>
          <div className="versions-list">
            {versions.map((version, index) => {
              const statusClass = versionStatusClass(version.status);
              const statusLabel = versionStatusLabel(version.status);
              const selected = version.version === props.selectedVersion?.version;
              return (
                <button
                  className={`${index === 0 ? "latest " : ""}version-${statusClass}${selected ? " selected" : ""}`}
                  key={version.version}
                  onClick={() => props.onSelectVersion(version)}
                  type="button"
                >
                  <div>
                    <span aria-label={statusLabel} className={`version-status-dot ${statusClass}`} role="img" title={statusLabel} />
                    <code>{version.version}</code>
                  </div>
                  <p>{version.summary ?? props.detail.desc}</p>
                  <small>{version.size ?? ""}</small>
                </button>
              );
            })}
          </div>
          <Pagination
            label={props.t.versions}
            onPageChange={props.onPageChange}
            page={props.page}
            pageCount={props.pageCount}
            t={props.t}
          />
        </>
      ) : (
        <div className="empty-state">
          <strong>{props.t.noVersionsTitle}</strong>
          <p>{props.t.noVersionsSub}</p>
        </div>
      )}
    </div>
  );
}

function InstalledPanel(props: {
  activeProject: Project;
  commandTask: CommandTask | null;
  installedRows: InstalledDockRow[];
  installedSearchQuery: string;
  installedTotalCount: number;
  onDeleteDock: (dock: Dock) => void;
  onOpenDetail: (dockId: string) => void;
  onSetInstalledSearchQuery: (query: string) => void;
  onUpdateDocks: () => void;
  t: (typeof TEXT)[Lang];
  updateAvailableCount: number;
}) {
  const commandActive = isTaskActive(props.commandTask);
  const updateActive = isTaskForTarget(props.commandTask, "update", props.activeProject.path);
  const updateCountLabel = props.t.updateAvailableCount.replace("{count}", String(props.updateAvailableCount));
  return (
    <div className="panel installed-panel">
      <div className="installed-toolbar">
        <div>
          <h1>{props.t.installedTitle}</h1>
          <p>{props.t.installedSub}</p>
        </div>
        {props.installedTotalCount > 0 ? (
          <div className="installed-toolbar-actions">
            <label className="search-box installed-search">
              <Search size={16} />
              <input
                aria-label={props.t.installedSearch}
                onChange={(event) => props.onSetInstalledSearchQuery(event.target.value)}
                placeholder={props.t.installedSearch}
                type="search"
                value={props.installedSearchQuery}
              />
            </label>
            <button className="primary-button" disabled={commandActive} onClick={props.onUpdateDocks} type="button">
              {updateActive ? <span aria-hidden="true" className="button-spinner" /> : <RefreshCw size={15} />}
              {updateActive ? props.t.updatingAction : props.t.updateAllAction}
              {props.updateAvailableCount > 0 ? <span className="button-count-chip">{updateCountLabel}</span> : null}
            </button>
          </div>
        ) : null}
      </div>
      {props.installedTotalCount > 0 && props.installedRows.length > 0 ? (
        <div className="installed-table">
          <div className="installed-head">
            <span>{props.t.dock}</span>
            <span>{props.t.version}</span>
            <span>{props.t.status}</span>
            <span>{props.t.action}</span>
          </div>
          <div className="installed-table-scroll">
            {props.installedRows.map((row) => (
              <div className="installed-row" key={dockFullId(row)}>
                <div className="installed-dock">
                  <DockIcon dock={row} size="small" />
                  <div>
                    <strong>{dockFullId(row)}</strong>
                    <small>{row.installedAt}</small>
                  </div>
                </div>
                <code className={row.updateAvailable ? "version-update" : ""}>
                  {row.updateAvailable && row.latestVersion ? `${row.version} -> ${row.latestVersion}` : row.version}
                </code>
                <span
                  aria-label={row.updateAvailable ? props.t.updateAvailable : props.t.ready}
                  className={row.updateAvailable ? "update-chip" : "ready-chip"}
                  role="img"
                  title={row.updateAvailable ? props.t.updateAvailable : props.t.ready}
                />
                <div className="installed-actions">
                  <button
                    aria-label={props.t.openDetail}
                    className="installed-icon-action"
                    onClick={() => props.onOpenDetail(dockFullId(row))}
                    title={props.t.openDetail}
                    type="button"
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    aria-label={props.t.deleteAction}
                    className="installed-icon-action danger"
                    disabled={commandActive}
                    onClick={() => props.onDeleteDock(row)}
                    title={props.t.deleteAction}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : props.installedTotalCount > 0 ? (
        <div className="empty-state">
          <strong>{props.t.noInstalledSearchTitle}</strong>
          <p>{props.t.noInstalledSearchSub}</p>
        </div>
      ) : (
        <div className="empty-state">
          <strong>{props.t.noInstalledTitle}</strong>
          <p>{props.t.noInstalledSub}</p>
        </div>
      )}
    </div>
  );
}

function LogsPanel(props: { activeProject: Project; logs: AppLog[]; t: (typeof TEXT)[Lang] }) {
  const tailRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: "end" });
  }, [props.logs.length]);

  async function copyLogs() {
    const logText = props.logs.map((log) => `${log.time}\t${log.level}\t${log.message}`).join("\n");
    await navigator.clipboard.writeText(logText);
  }

  return (
    <div className="panel logs-panel">
      <h1>{props.t.logsTitle}</h1>
      <p>{props.t.logsSub}</p>
      <div className="log-shell">
        <div className="log-head">
          <div className="log-head-main">
            <strong>{props.activeProject.name}</strong>
            <code>{props.t.liveTail}</code>
          </div>
          <button
            aria-label={props.t.copyLogs}
            className="icon-button log-copy-button"
            disabled={props.logs.length === 0}
            onClick={() => void copyLogs().catch(() => undefined)}
            title={props.t.copyLogs}
            type="button"
          >
            <Copy size={14} />
          </button>
        </div>
        <div aria-live="polite" className="log-lines">
          {props.logs.map((log, index) => (
            <div className="log-line" key={`${log.time}-${log.message}-${index}`}>
              <span>{log.time}</span>
              <strong style={{ color: log.color }}>{log.level}</strong>
              <p>{log.message}</p>
            </div>
          ))}
          <span aria-hidden="true" className="log-tail-anchor" ref={tailRef} />
        </div>
      </div>
    </div>
  );
}

function CommandProgressDialog(props: {
  commandTask: CommandTask;
  onCancelCommand: () => void;
  onClose: () => void;
  onForceRetryCommand: () => void;
  t: (typeof TEXT)[Lang];
}) {
  return (
    <div className="command-progress-overlay">
      <div aria-labelledby="command-progress-title" aria-modal="true" className="command-progress-dialog" role="dialog">
        <CommandProgressCard
          commandTask={props.commandTask}
          onCancelCommand={props.onCancelCommand}
          onClose={props.onClose}
          onForceRetryCommand={props.onForceRetryCommand}
          t={props.t}
        />
      </div>
    </div>
  );
}

function CommandProgressCard(props: {
  commandTask: CommandTask;
  onCancelCommand: () => void;
  onClose: () => void;
  onForceRetryCommand: () => void;
  t: (typeof TEXT)[Lang];
}) {
  const active = isTaskActive(props.commandTask);
  const percent = `${Math.round(props.commandTask.progress)}%`;
  const rows = props.commandTask.rows.slice(0, 16);
  const forceRetry = !active ? props.commandTask.forceRetry : null;
  return (
    <section aria-live="polite" className={`command-progress ${props.commandTask.status}`} role="status">
      <div className="command-progress-head">
        <div className="command-progress-title-wrap">
          <div>
            <span className="command-progress-dot" />
            <strong id="command-progress-title">{commandTaskTitle(props.commandTask.kind, props.t)}</strong>
          </div>
          <p>{props.commandTask.step}</p>
        </div>
        <strong className="command-progress-percent">{percent}</strong>
      </div>
      <div className="command-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(props.commandTask.progress)}>
        <span style={{ width: `${props.commandTask.progress}%` }} />
      </div>
      <div className="command-progress-log">
        <strong>{props.t.operationLog}</strong>
        <div>
          {rows.map((row, index) => (
            <p key={`${row.time}-${row.message}-${index}`}>
              <span>{row.time}</span>
              <b style={{ color: row.color }}>{row.level}</b>
              <em>{row.message}</em>
            </p>
          ))}
        </div>
      </div>
      {!active ? (
        <div className="command-progress-foot">
          {forceRetry ? <span>{props.t.forceRetryWarning}</span> : null}
          <div className="command-progress-actions">
            {forceRetry ? (
              <button className="danger-button compact" onClick={props.onForceRetryCommand} type="button">
                {forceRetry.kind === "update" ? props.t.forceUpdateAction : props.t.forceDeleteAction}
              </button>
            ) : null}
            <button className="secondary-button compact" onClick={props.onClose} type="button">
              {props.t.close}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CommandPaletteDialog(props: {
  bindings: ShortcutBinding[];
  lang: Lang;
  onClose: () => void;
  onRun: (commandId: ShortcutCommandId) => void;
  platform: ShortcutPlatform;
  t: (typeof TEXT)[Lang];
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [props.onClose]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleBindings = props.bindings.filter((binding) => {
    if (!normalizedQuery) return true;
    return [
      binding.id,
      shortcutCommandLabel(binding, props.lang),
      binding.description[props.lang] ?? binding.description.en,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });

  return (
    <div
      className="modal-layer command-palette-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div aria-labelledby="command-palette-title" aria-modal="true" className="command-palette" role="dialog">
        <div className="command-palette-search">
          <Search size={16} />
          <input
            aria-label={props.t.commandPaletteSearch}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && visibleBindings[0]) props.onRun(visibleBindings[0].id);
            }}
            placeholder={props.t.commandPaletteSearch}
            ref={inputRef}
            value={query}
          />
        </div>
        <div className="command-palette-list">
          {visibleBindings.map((binding) => (
            <button key={binding.id} onClick={() => props.onRun(binding.id)} type="button">
              <span>
                <strong>{shortcutCommandLabel(binding, props.lang)}</strong>
                <small>{binding.description[props.lang] ?? binding.description.en}</small>
              </span>
              <kbd>{binding.accelerator ? formatShortcutForDisplay(binding.accelerator, props.platform) : props.t.shortcutUnset}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectSwitcherDialog(props: {
  activeProjectId: string;
  onClose: () => void;
  onSelect: (projectId: string) => void;
  projects: Project[];
  t: (typeof TEXT)[Lang];
}) {
  return (
    <div className="modal-layer">
      <div aria-labelledby="project-switcher-title" aria-modal="true" className="modal project-switcher" role="dialog">
        <div className="modal-head">
          <div>
            <h2 id="project-switcher-title">{props.t.switchProjectTitle}</h2>
            <p>{props.t.switchProjectSub}</p>
          </div>
          <IconButton label={props.t.close} onClick={props.onClose}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="project-switcher-list">
          {props.projects.map((project) => (
            <button className={project.id === props.activeProjectId ? "active" : ""} key={project.id} onClick={() => props.onSelect(project.id)} type="button">
              <Folder size={16} />
              <span>
                <strong>{project.name}</strong>
                <small>{project.path}</small>
              </span>
              {project.id === props.activeProjectId ? <Check size={15} /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccountPanel(props: {
  accountEmail: string;
  lang: Lang;
  myDocks: MyDock[];
  myDocksCounts: MyDocksCounts;
  myDocksPage: number;
  myDocksPageCount: number;
  myDocksTotal: number;
  myStarredDocks: Dock[];
  nickname: string;
  onBack: () => void;
  onOpenDetail: (dockId: string) => void;
  onSaveNickname: (nickname: string) => void;
  onSetMyDocksPage: (page: number) => void;
  t: (typeof TEXT)[Lang];
}) {
  const [draftNickname, setDraftNickname] = useState(props.nickname);
  const [accountTab, setAccountTab] = useState<"profile" | "docks" | "stars">("profile");
  const accountStats = accountStatsFor(props.myDocksCounts, props.myStarredDocks.length);
  const myDocksStart =
    props.myDocksTotal === 0 || props.myDocks.length === 0 ? 0 : (props.myDocksPage - 1) * ACCOUNT_PAGE_LIMIT + 1;
  const myDocksEnd = myDocksStart === 0 ? 0 : Math.min(props.myDocksTotal, myDocksStart + props.myDocks.length - 1);

  useEffect(() => {
    setDraftNickname(props.nickname);
  }, [props.nickname]);

  return (
    <div className="panel account-panel">
      <button className="text-button" onClick={props.onBack} type="button">
        <ArrowLeft size={15} /> {props.t.backToMain}
      </button>
      <div className="account-heading">
        <div className="kicker">{props.t.memberWorkspace}</div>
        <h1>{props.t.accountInfoTitle}</h1>
        <p>{props.t.accountInfoSub}</p>
      </div>
      <div className="account-layout">
        <aside className="profile-card" aria-label={props.t.accountProfile}>
          <div className="profile-avatar">O</div>
          <div>
            <strong>opendock</strong>
            <img alt="official badge" src={badgeSrc} />
          </div>
          <p>{props.accountEmail}</p>
          <div className="profile-stats">
            <StatRow label={props.t.submittedDocks} value={accountStats.submitted} />
            <StatRow label={props.t.approved} value={accountStats.approved} />
            <StatRow label={props.t.pending} value={accountStats.pending} />
            <StatRow label={props.t.rejected} value={accountStats.rejected} />
            <StatRow label={props.t.unavailable} value={accountStats.unavailable} />
            <StatRow label={props.t.hidden} value={accountStats.hidden} />
            <StatRow label={props.t.stars} value={accountStats.stars} />
          </div>
        </aside>
        <section className="account-main">
          <div className="account-tabs">
            <button className={accountTab === "profile" ? "active" : ""} onClick={() => setAccountTab("profile")} type="button">
              {props.t.profile}
            </button>
            <button className={accountTab === "docks" ? "active" : ""} onClick={() => setAccountTab("docks")} type="button">
              {props.t.myDocks}
            </button>
            <button className={accountTab === "stars" ? "active" : ""} onClick={() => setAccountTab("stars")} type="button">
              {props.t.stars}
            </button>
          </div>
          {accountTab === "profile" ? (
            <div className="profile-form">
              <label>
                <span>{props.t.email}</span>
                <div>{props.accountEmail}</div>
              </label>
              <label>
                <span>{props.t.nickname}</span>
                <input onChange={(event) => setDraftNickname(event.target.value)} value={draftNickname} />
              </label>
              <button onClick={() => props.onSaveNickname(draftNickname)} type="button">{props.t.saveChanges}</button>
            </div>
          ) : null}
          {accountTab === "docks" ? (
            <section className="account-list-panel">
              <div className="account-range">{myDocksStart}-{myDocksEnd} / {props.myDocksTotal}</div>
              {props.myDocks.length > 0 ? (
                <div className="starred-dock-list">
                  {props.myDocks.map((dock) => (
                    <button key={dock.id} onClick={() => props.onOpenDetail(dock.id)} type="button">
                      <DockIcon dock={dockFromMyDock(dock)} size="small" />
                      <span>
                        <strong>{dock.id}</strong>
                        <small>{dock.summary ?? dock.displayName ?? dock.name}</small>
                      </span>
                      <span className={`account-status ${myDockReviewGroup(dock)}`}>{myDockStatusLabel(myDockReviewGroup(dock), props.t)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="starred-empty">{props.t.noSubmittedDocks}</p>
              )}
              {props.myDocksTotal > 0 ? (
                <Pagination
                  label={props.t.myDocks}
                  onPageChange={props.onSetMyDocksPage}
                  page={props.myDocksPage}
                  pageCount={props.myDocksPageCount}
                  t={props.t}
                />
              ) : null}
            </section>
          ) : null}
          {accountTab === "stars" ? (
            <section className="account-list-panel">
              <div className="account-range">0-0 / {props.myStarredDocks.length}</div>
              {props.myStarredDocks.length > 0 ? (
                <div className="starred-dock-list">
                  {props.myStarredDocks.map((dock) => (
                    <button key={dockFullId(dock)} onClick={() => props.onOpenDetail(dockFullId(dock))} type="button">
                      <DockIcon dock={dock} size="small" />
                      <span>
                        <strong>{dockFullId(dock)}</strong>
                        <small>{dock.desc}</small>
                      </span>
                      <DockMetric count={dock.stars ?? 0} icon={<Star fill="currentColor" size={13} />} label={props.t.stars} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="starred-empty">{props.t.noStarredDocks}</p>
              )}
            </section>
          ) : null}
        </section>
      </div>
    </div>
  );
}
