import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Download,
  Eye,
  Folder,
  FolderOpen,
  Github,
  Globe2,
  LogOut,
  Maximize2,
  Menu as MenuIcon,
  Minus,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Sun,
  Trash2,
  UserRound,
  X
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
  type DockStarStatusResponse,
  type DockVersion,
  type DockView,
  type InstalledDockRecord,
  type Lang,
  type OpenDockChangeReport,
  type OpenDockChangeResult,
  type OpenDockCommandLine,
  type OpenDockCommandProgress,
  type OpenDockCommandResult,
  type OpenDockOutdatedReport,
  type OpenDockOutdatedResult,
  type Project,
  type ProjectFolder,
  type ProjectStateResult,
  type RegistryDockDetail,
  type RegistryDockSearchResponse,
  type RegistryDockVersionsResponse,
  type MyDock,
  type MyDocksCounts,
  type MyDocksResponse,
  type MyStarsResponse,
  type SortMode,
  TEXT,
  type Theme
} from "./data";
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

const logoSrc = "/opendock-logo.png";
const badgeSrc = "/official-badge.png";
const REGISTRY_ORIGIN = "https://registry.opendock.app";
const MAX_STORED_LOGS = 400;
const DEFAULT_CATALOG_PAGE_LIMIT = 12;
const DEFAULT_VERSION_PAGE_LIMIT = 6;
const ACCOUNT_PAGE_LIMIT = 6;
const registryAssetCache = new Map<string, string | null>();
const registryAssetRequests = new Map<string, Promise<string | null>>();
type WindowControlPlatform = "macos" | "windows";
type CommandTaskKind = "install" | "update" | "delete" | "doctor";
type CommandTaskStatus = "running" | "cancelling" | "success" | "error" | "cancelled";
type VersionStatusClass = "approved" | "pending" | "rejected" | "revoked" | "hidden" | "suspended" | "unavailable";
type OpenMenu = "" | "app" | "lang" | "account" | "sort";
type AppMenuItem = { id: string; label: string; shortcut?: string } | { type: "separator" };
type AppMenuGroup = { items: AppMenuItem[]; key: string; label: string };

interface CommandForceRetry {
  dockId?: string;
  kind: "delete" | "update";
  projectPath: string;
}

interface CommandTask {
  forceRetry: CommandForceRetry | null;
  forceRetryUsed: boolean;
  id: string;
  kind: CommandTaskKind;
  projectPath?: string;
  target: string;
  progress: number;
  status: CommandTaskStatus;
  step: string;
  lines: number;
  rows: CommandTaskRow[];
  startedAt: string;
  updatedAt: string;
}

interface CommandTaskRow {
  time: string;
  level: string;
  color: string;
  message: string;
}

interface ShortcutFileResult {
  contents: string;
  path: string;
}

type InstalledDockRow = Dock & {
  installedAt: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  updatePlatform?: string;
};

interface ResponsivePageSizes {
  catalog: number;
  versions: number;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

function detectWindowControlPlatform(): WindowControlPlatform {
  if (typeof navigator === "undefined") return "windows";
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  return platform.includes("mac") ? "macos" : "windows";
}

function nowTime() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false }).slice(0, 8);
}

function logColor(level: string) {
  switch (level) {
    case "OK":
      return "var(--success)";
    case "RUN":
      return "var(--info)";
    case "WARN":
      return "var(--warning)";
    case "ERR":
      return "var(--danger)";
    default:
      return "var(--text-2)";
  }
}

function commandLineLogEntry(line: OpenDockCommandLine): AppLog {
  const parsed = parseOpenDockHistoryLine(line.message);
  if (parsed) return parsed;
  const level = line.level.toUpperCase();
  return { time: nowTime(), level, color: logColor(level), message: line.message };
}

function parseOpenDockHistoryLine(message: string): AppLog | null {
  const match = message.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+(\S+)\s+(.+)$/);
  if (!match) return null;
  const [, isoTime, status, body] = match;
  const level = logLevelForHistoryStatus(status);
  return {
    time: formatHistoryTime(isoTime),
    level,
    color: logColor(level),
    message: body
  };
}

function logLevelForHistoryStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "success") return "OK";
  if (normalized === "warning" || normalized === "warn") return "WARN";
  if (normalized === "running" || normalized === "run") return "RUN";
  if (normalized === "failed" || normalized === "failure" || normalized === "error") return "ERR";
  return "INFO";
}

function formatHistoryTime(isoTime: string) {
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return nowTime();
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return date.toLocaleTimeString("en-GB", { hour12: false }).slice(0, 8);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function isTaskActive(task: CommandTask | null) {
  return task?.status === "running" || task?.status === "cancelling";
}

function isTaskForTarget(task: CommandTask | null, kind: CommandTaskKind, target: string) {
  return isTaskActive(task) && task?.kind === kind && task.target.startsWith(target);
}

function commandTaskId(kind: CommandTaskKind) {
  return `opendock-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function commandTaskTitle(kind: CommandTaskKind, t: (typeof TEXT)[Lang]) {
  if (kind === "install") return t.taskInstalling;
  if (kind === "update") return t.taskUpdating;
  if (kind === "delete") return t.taskDeleting;
  return t.taskDoctor;
}

function nextCommandProgress(task: CommandTask, line: OpenDockCommandLine) {
  const normalizedLevel = line.level.toUpperCase();
  const bump = normalizedLevel === "OK" ? 18 : normalizedLevel === "RUN" ? 12 : normalizedLevel === "ERR" ? 8 : 7;
  return Math.min(92, Math.max(task.progress + bump, 12));
}

function commandTaskLevel(status: CommandTaskStatus) {
  if (status === "success") return "OK";
  if (status === "error") return "ERR";
  if (status === "cancelled" || status === "cancelling") return "WARN";
  return "RUN";
}

function normalizeCommandRowMessage(message: string) {
  return message.trim().replace(/\s+/g, " ");
}

function commandRowsContainMessage(rows: CommandTaskRow[], message: string) {
  const normalized = normalizeCommandRowMessage(message);
  if (!normalized) return true;
  return rows.some((row) => normalizeCommandRowMessage(row.message) === normalized);
}

function appMenuGroups(t: (typeof TEXT)[Lang]): AppMenuGroup[] {
  return [
    {
      key: "file",
      label: t.menuFile,
      items: [
        { id: "file:new-project", label: t.newProjectAction },
        { id: "file:add-existing-project", label: t.existingProjectAction },
      ],
    },
    {
      key: "edit",
      label: t.menuEdit,
      items: [
        { id: "edit:rename-project", label: t.renameProjectTitle },
        { id: "edit:copy-project-path", label: t.menuCopyProjectPath, shortcut: "Ctrl+Shift+C" },
        { id: "edit:import-shortcuts", label: t.importShortcuts },
        { id: "edit:export-shortcuts", label: t.exportShortcuts },
        { type: "separator" },
        { id: "view:toggle-sidebar", label: t.menuToggleSidebar, shortcut: "Ctrl+B" },
      ],
    },
    {
      key: "view",
      label: t.menuView,
      items: [
        { id: "view:explore", label: t.explore },
        { id: "view:installed", label: t.installed },
        { id: "view:logs", label: t.logs },
      ],
    },
    {
      key: "project",
      label: t.menuProject,
      items: [
        { id: "project:run-doctor", label: t.menuRunDoctor, shortcut: "Ctrl+D" },
        { id: "project:update-docks", label: t.updateAllAction },
        { id: "project:open-folder", label: t.menuOpenProjectFolder },
        { id: "project:reveal-folder", label: t.menuRevealProjectFolder },
        { type: "separator" },
        { id: "project:remove-from-opendock", label: t.menuRemoveProject },
      ],
    },
    {
      key: "dock",
      label: t.menuDock,
      items: [
        { id: "dock:install", label: t.installAction },
        { id: "dock:delete", label: t.deleteAction },
        { id: "dock:refresh-registry", label: t.menuRefreshRegistry },
        { id: "dock:open-detail", label: t.openDetail },
      ],
    },
    {
      key: "window",
      label: t.menuWindow,
      items: [{ id: "window:reload", label: t.menuReloadWindow, shortcut: "Ctrl+Shift+R" }],
    },
    {
      key: "help",
      label: t.menuHelp,
      items: [
        { id: "help:docs", label: t.menuDocs },
        { id: "help:cli-commands", label: t.menuCliCommands },
        { id: "help:troubleshooting", label: t.menuTroubleshooting },
      ],
    },
  ];
}

function commandFailureMessage(result: OpenDockCommandResult, fallback: string) {
  return (
    result.stderr.trim().split("\n").find(Boolean) ??
    result.stdout.trim().split("\n").find(Boolean) ??
    result.lines.find((line) => line.message.trim())?.message ??
    fallback
  );
}

function isAuthStatusLine(message: string) {
  return (
    message.startsWith("Opening browser") ||
    message.startsWith("Open this URL") ||
    message.startsWith("Browser did not open") ||
    message.startsWith("Waiting for login") ||
    message.startsWith("Logged in as")
  );
}

function waitForCommandPopupPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      window.setTimeout(resolve, 0);
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function registrySortMode(mode: SortMode) {
  return mode === "recent" ? "updated" : mode;
}

function readResponsivePageSizes(): ResponsivePageSizes {
  if (typeof window === "undefined") {
    return { catalog: DEFAULT_CATALOG_PAGE_LIMIT, versions: DEFAULT_VERSION_PAGE_LIMIT };
  }
  return {
    catalog: catalogPageLimitForViewport(window.innerWidth, window.innerHeight),
    versions: versionPageLimitForViewport(window.innerWidth, window.innerHeight)
  };
}

function catalogPageLimitForViewport(width: number, height: number) {
  const columns = catalogColumnsForViewport(width);
  const baseRows = width <= 520 ? 5 : 3;
  const extraRows = Math.max(0, Math.floor((height - 980) / 420));
  return Math.min(24, columns * Math.min(8, baseRows + extraRows));
}

function catalogColumnsForViewport(width: number) {
  if (width <= 520) return 1;
  if (width <= 980) return 2;
  if (width >= 1600) return 4;
  return 3;
}

function versionPageLimitForViewport(width: number, height: number) {
  const baseRows = width <= 980 ? 5 : 6;
  const extraRows = Math.max(0, Math.floor((height - 900) / 180));
  return Math.min(18, baseRows + extraRows);
}

function useResponsivePageSizes() {
  const [sizes, setSizes] = useState<ResponsivePageSizes>(() => readResponsivePageSizes());

  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = readResponsivePageSizes();
        setSizes((current) =>
          current.catalog === next.catalog && current.versions === next.versions ? current : next
        );
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, []);

  return sizes;
}

function versionStatusClass(status?: string): VersionStatusClass {
  const normalized = status?.toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "rejected") return "rejected";
  if (normalized === "revoked") return "revoked";
  if (normalized === "hidden") return "hidden";
  if (normalized === "suspended") return "suspended";
  if (normalized === "unavailable") return "unavailable";
  return "pending";
}

function versionStatusLabel(status?: string) {
  const key = versionStatusClass(status);
  if (key === "approved") return "Approved";
  if (key === "rejected") return "Rejected";
  if (key === "revoked") return "Revoked";
  if (key === "hidden") return "Hidden";
  if (key === "suspended") return "Suspended";
  if (key === "unavailable") return "Unavailable";
  return "Pending review";
}

async function requestCatalog(sortMode: SortMode, query: string, page: number, limit: number) {
  const sort = registrySortMode(sortMode);
  const trimmedQuery = query.trim();
  if (isTauriRuntime()) {
    return invoke<RegistryDockSearchResponse>("opendock_catalog", {
      page,
      limit,
      sort,
      query: trimmedQuery || null
    });
  }
  return requestRegistryJson<RegistryDockSearchResponse>("/v1/docks", {
    sort,
    page: String(page),
    limit: String(limit),
    ...(trimmedQuery ? { query: trimmedQuery } : {})
  });
}

async function requestDockDetail(dockId: string) {
  if (isTauriRuntime()) return invoke<RegistryDockDetail>("opendock_dock_detail", { dockId });
  return requestRegistryJson<RegistryDockDetail>(`/v1/docks/${dockId}`);
}

async function requestDockVersions(dockId: string, page: number, limit: number) {
  if (isTauriRuntime()) return invoke<RegistryDockVersionsResponse>("opendock_dock_versions", { dockId, page, limit });
  return requestRegistryJson<RegistryDockVersionsResponse>(`/v1/docks/${dockId}/versions`, {
    page: String(page),
    limit: String(limit)
  });
}

async function requestStarStatus(ids: string[]) {
  if (ids.length === 0) return { items: [] } satisfies DockStarStatusResponse;
  if (!isTauriRuntime()) {
    return { items: ids.map((id) => ({ id, starred: false })) } satisfies DockStarStatusResponse;
  }
  return invoke<DockStarStatusResponse>("opendock_star_status", { ids });
}

async function requestMyStars() {
  if (!isTauriRuntime()) return { items: [] } satisfies MyStarsResponse;
  return invoke<MyStarsResponse>("opendock_my_stars");
}

async function requestMyDocks(page: number, limit: number) {
  if (!isTauriRuntime()) {
    return {
      counts: emptyMyDocksCounts(),
      items: [],
      limit,
      page,
      total: 0
    } satisfies MyDocksResponse;
  }
  return invoke<MyDocksResponse>("opendock_my_docks", { page, limit });
}

function emptyMyDocksCounts(): MyDocksCounts {
  return {
    all: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    unavailable: 0,
    hidden: 0
  };
}

async function requestSetDockStar(dockId: string, starred: boolean) {
  if (!isTauriRuntime()) {
    return { id: dockId, starred, stars: starred ? 1 : 0 } satisfies DockStarResponse;
  }
  return invoke<DockStarResponse>(starred ? "opendock_star_dock" : "opendock_unstar_dock", { dockId });
}

async function requestRegistryJson<T>(path: string, params: Record<string, string> = {}) {
  const url = new URL(`/registry${path}`, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json", "cache-control": "no-cache" }
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(`registry returned ${response.status} for ${url.pathname}${detail ? `: ${detail}` : ""}`);
  }
  return response.json() as Promise<T>;
}

function resolveRegistryAssetUrl(url?: string | null) {
  if (!url || typeof window === "undefined") return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== REGISTRY_ORIGIN) return null;
    const canUseDevProxy = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (canUseDevProxy) {
      return `/registry${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function loadRegistryAssetUrl(url?: string | null) {
  if (!url) return null;
  if (registryAssetCache.has(url)) return registryAssetCache.get(url) ?? null;
  const existing = registryAssetRequests.get(url);
  if (existing) return existing;
  const request = (async () => {
    try {
      const value = isTauriRuntime()
        ? await invoke<string>("opendock_registry_asset_data_url", { url })
        : resolveRegistryAssetUrl(url);
      registryAssetCache.set(url, value);
      return value;
    } catch {
      const fallback = resolveRegistryAssetUrl(url);
      registryAssetCache.set(url, fallback);
      return fallback;
    } finally {
      registryAssetRequests.delete(url);
    }
  })();
  registryAssetRequests.set(url, request);
  return request;
}

function findDockByKey(docks: Dock[], key: string) {
  return docks.find((dock) => dockFullId(dock) === key || dock.id === key || dock.name === key);
}

function formatDateLabel(value?: string | null) {
  if (!value) return "Jun 14, 2026";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function platformLabel(platform: string) {
  if (platform === "macos") return "macOS";
  if (platform === "windows") return "Windows";
  if (platform === "linux") return "Linux";
  if (platform === "any") return "Any";
  return platform;
}

function installedAtLabel(lang: Lang) {
  return lang === "ko" ? "설치됨" : "Installed";
}

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

function chooseShortcutFileFromBrowser(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(String(reader.result ?? "")), { once: true });
        reader.addEventListener("error", () => resolve(null), { once: true });
        reader.readAsText(file);
      },
      { once: true }
    );
    input.style.display = "none";
    document.body.appendChild(input);
    input.click();
  });
}

function downloadShortcutFile(contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "opendock-shortcuts.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
    ...dock.modes
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function resolveActiveProjectId(projects: Project[], activeProjectId: string) {
  if (projects.some((project) => project.id === activeProjectId)) return activeProjectId;
  return projects[0]?.id ?? "";
}

function KeyboardButton(props: {
  children: ReactNode;
  className?: string;
  ariaLabel: string;
  onOpen: () => void;
}) {
  return (
    <div
      aria-label={props.ariaLabel}
      className={props.className}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        props.onOpen();
      }}
      role="button"
      tabIndex={0}
    >
      {props.children}
    </div>
  );
}

function IconButton(props: {
  label: string;
  children: ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button aria-label={props.label} className={`icon-button ${props.className ?? ""}`} onClick={props.onClick} type="button">
      {props.children}
    </button>
  );
}

function DockIcon(props: { dock: Dock; size?: "small" | "large" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const sourceLogoUrl = props.dock.logoUrl ?? null;
  useEffect(() => {
    let cancelled = false;
    setImageFailed(false);
    setLogoUrl(null);
    void loadRegistryAssetUrl(sourceLogoUrl).then((nextLogoUrl) => {
      if (!cancelled) setLogoUrl(nextLogoUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceLogoUrl]);
  const hasRegistryLogo = Boolean(logoUrl && !imageFailed);
  const imageUrl = hasRegistryLogo ? logoUrl : logoSrc;
  const className = ["dock-icon", props.size, "has-logo", hasRegistryLogo ? "" : "fallback-logo"].filter(Boolean).join(" ");
  const label = props.dock.displayName ?? props.dock.short ?? props.dock.id;

  return (
    <div className={className} style={{ background: props.dock.grad }}>
      <img
        alt={hasRegistryLogo ? `${label} logo` : "OpenDock logo"}
        src={imageUrl ?? logoSrc}
        onError={hasRegistryLogo ? () => setImageFailed(true) : undefined}
      />
    </div>
  );
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
          return Number.isNaN(byDate) || byDate === 0 ? b.updatedRank - a.updatedRank : byDate;
        }
        return (b.downloads ?? Number(b.dl)) - (a.downloads ?? Number(a.dl));
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
      dockFullId(dock) === response.id ? { ...dock, stars: response.stars, dl: dock.dl } : dock;
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

function Titlebar(props: {
  accountName: string;
  lang: Lang;
  loggedIn: boolean;
  onAccount: () => void;
  onAppMenu: () => void;
  onAppMenuCommand: (id: string) => void;
  onClose: () => void;
  onLang: () => void;
  onLogout: () => void;
  onMaximize: () => void;
  onMinimize: () => void;
  onOpenProfile: () => void;
  onSetEnglish: () => void;
  onSetKorean: () => void;
  onTheme: () => void;
  openMenu: OpenMenu;
  projectPathLabel: string;
  t: (typeof TEXT)[Lang];
  windowControlPlatform: WindowControlPlatform;
}) {
  const isMac = props.windowControlPlatform === "macos";
  const startDrag = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.detail > 1 || isInteractiveTitlebarTarget(event.target)) return;
    if (!isTauriRuntime()) return;
    void getCurrentWindow().startDragging().catch((error) => {
      console.warn("OpenDock window drag failed", error);
    });
  };
  return (
    <header className={`titlebar ${props.windowControlPlatform}`} data-platform={props.windowControlPlatform} onMouseDown={startDrag}>
      {isMac ? (
        <WindowControls
          onClose={props.onClose}
          onMaximize={props.onMaximize}
          onMinimize={props.onMinimize}
          platform={props.windowControlPlatform}
          t={props.t}
        />
      ) : null}
      {!isMac ? (
        <AppMenu
          groups={appMenuGroups(props.t)}
          onCommand={props.onAppMenuCommand}
          onToggle={props.onAppMenu}
          open={props.openMenu === "app"}
          t={props.t}
        />
      ) : null}
      <div className="titlebar-brand" data-tauri-drag-region>
        <img alt="OpenDock logo" src={logoSrc} />
        <span>OpenDock</span>
        <code>{props.projectPathLabel}</code>
      </div>
      <div className="titlebar-actions">
        <div className="menu-anchor">
          <button className="control-button" onClick={props.onLang} type="button">
            <Globe2 size={14} />
            <span>{props.lang === "ko" ? "한국어" : "English"}</span>
            <ChevronDown size={13} />
          </button>
          {props.openMenu === "lang" ? (
            <div className="dropdown-menu compact">
              <button onClick={props.onSetKorean} type="button">
                한국어 {props.lang === "ko" ? <Check size={14} /> : null}
              </button>
              <button onClick={props.onSetEnglish} type="button">
                English {props.lang === "en" ? <Check size={14} /> : null}
              </button>
            </div>
          ) : null}
        </div>
        <button aria-label={props.t.toggleTheme} className="theme-switch" onClick={props.onTheme} type="button">
          <Sun size={11} />
          <Moon size={11} />
          <span />
        </button>
        {props.loggedIn ? (
          <div className="menu-anchor">
            <button className="avatar-button" onClick={props.onAccount} type="button">
              O
            </button>
            {props.openMenu === "account" ? (
              <div className="dropdown-menu account-menu">
                <div className="account-name">{props.accountName}</div>
                <button onClick={props.onOpenProfile} type="button">
                  <UserRound size={16} /> {props.t.accountProfile}
                </button>
                <button className="danger-menu-item" onClick={props.onLogout} type="button">
                  <LogOut size={16} /> {props.t.logout}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {!isMac ? (
          <WindowControls
            onClose={props.onClose}
            onMaximize={props.onMaximize}
            onMinimize={props.onMinimize}
            platform={props.windowControlPlatform}
            t={props.t}
          />
        ) : null}
      </div>
    </header>
  );
}

function isInteractiveTitlebarTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.closest(
      'button,a,input,textarea,select,[role="button"],[role="menu"],.dropdown-menu,.app-menu-panel,.window-controls,.titlebar-actions'
    )
  );
}

function AppMenu(props: {
  groups: AppMenuGroup[];
  onCommand: (id: string) => void;
  onToggle: () => void;
  open: boolean;
  t: (typeof TEXT)[Lang];
}) {
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) setActiveGroupKey(null);
  }, [props.open]);

  const runCommand = (id: string) => {
    props.onCommand(id);
  };

  return (
    <div className="app-menu-anchor">
      <button
        aria-expanded={props.open}
        aria-haspopup="menu"
        aria-label={props.t.appMenu}
        className={`app-menu-button ${props.open ? "active" : ""}`}
        onClick={props.onToggle}
        title={props.t.appMenu}
        type="button"
      >
        <MenuIcon size={18} />
      </button>
      {props.open ? (
        <div aria-label={props.t.appMenu} className="app-menu-panel" onMouseLeave={() => setActiveGroupKey(null)} role="menu">
          {props.groups.map((group) => (
            <div className={`app-menu-group ${activeGroupKey === group.key ? "active" : ""}`} key={group.key}>
              <button
                aria-expanded={activeGroupKey === group.key}
                className="app-menu-group-button"
                onClick={() => setActiveGroupKey(group.key)}
                onFocus={() => setActiveGroupKey(group.key)}
                onMouseEnter={() => setActiveGroupKey(group.key)}
                type="button"
              >
                <span>{group.label}</span>
                <ChevronRight size={14} />
              </button>
              <div className="app-menu-flyout" role="menu">
                {group.items.map((item, index) =>
                  "type" in item ? (
                    <div className="app-menu-separator" key={`${group.key}-separator-${index}`} role="separator" />
                  ) : (
                    <button
                      className="app-menu-item"
                      key={item.id}
                      onClick={() => runCommand(item.id)}
                      type="button"
                    >
                      <span>{item.label}</span>
                      {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WindowControls(props: {
  onClose: () => void;
  onMaximize: () => void;
  onMinimize: () => void;
  platform: WindowControlPlatform;
  t: (typeof TEXT)[Lang];
}) {
  const runControl = (event: MouseEvent<HTMLButtonElement>, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  if (props.platform === "macos") {
    return (
      <div aria-label="Window controls" className="window-controls macos">
        <button aria-label={props.t.closeWindow} className="mac-window-control close" onClick={(event) => runControl(event, props.onClose)} type="button">
          <span />
        </button>
        <button aria-label={props.t.minimizeWindow} className="mac-window-control minimize" onClick={(event) => runControl(event, props.onMinimize)} type="button">
          <span />
        </button>
        <button aria-label={props.t.maximizeWindow} className="mac-window-control maximize" onClick={(event) => runControl(event, props.onMaximize)} type="button">
          <span />
        </button>
      </div>
    );
  }

  return (
    <div aria-label="Window controls" className="window-controls windows">
      <button aria-label={props.t.minimizeWindow} className="windows-window-control" onClick={(event) => runControl(event, props.onMinimize)} type="button">
        <Minus size={14} />
      </button>
      <button aria-label={props.t.maximizeWindow} className="windows-window-control" onClick={(event) => runControl(event, props.onMaximize)} type="button">
        <Maximize2 size={13} />
      </button>
      <button aria-label={props.t.closeWindow} className="windows-window-control close" onClick={(event) => runControl(event, props.onClose)} type="button">
        <X size={14} />
      </button>
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
          <Meta label={props.t.downloads} value={props.detail.dl} />
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
          <Meta label={props.t.downloads} value={version?.downloadCount == null ? props.detail.dl : String(version.downloadCount)} />
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
        <span>{props.dock.tagA}</span>
        <span>{props.dock.tagB}</span>
        <span>+{props.dock.more}</span>
      </div>
      <div className="card-foot">
        <div>
          {platforms.map((platform) => (
            <span key={platform}>{platformLabel(platform)}</span>
          ))}
        </div>
        <div className="dock-metrics">
          <DockMetric count={props.dock.dl} icon={<Download size={13} />} label={props.t.downloads} />
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

function ReadmePanel(props: { detail: Dock; t: (typeof TEXT)[Lang] }) {
  const readme = parseReadmeMarkdown(props.detail.readmeMarkdown);
  const title = readme.title || props.detail.readmeTitle;
  const intro = readme.intro || props.detail.readmeIntro;
  const description = props.detail.desc?.trim();
  const shouldShowDescription = Boolean(description && description !== intro?.trim());
  return (
    <div className="readme-panel">
      <h2>{props.t.readme}</h2>
      <div className="readme-card">
        <h3>{title}</h3>
        {shouldShowDescription ? <p className="readme-description">{description}</p> : null}
        {intro ? <p>{intro}</p> : null}
        {readme.blocks.length > 0 ? (
          <div className="readme-markdown">
            {readme.blocks.map((block, index) => renderReadmeBlock(block, index))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type ReadmeBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; text: string };

function parseReadmeMarkdown(markdown?: string | null) {
  const blocks = markdown ? markdownToBlocks(markdown) : [];
  const [firstBlock, ...rest] = blocks;
  const title = firstBlock?.type === "heading" && firstBlock.level === 1 ? firstBlock.text : "";
  const content = title ? rest : blocks;
  const introIndex = content.findIndex((block) => block.type === "paragraph");
  const intro = introIndex >= 0 && content[introIndex]?.type === "paragraph" ? content[introIndex].text : "";
  const visibleBlocks = content.filter((_, index) => index !== introIndex);
  return { title, intro, blocks: visibleBlocks };
}

function markdownToBlocks(markdown: string): ReadmeBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReadmeBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", text: code.join("\n").trimEnd() });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: stripInlineMarkdown(heading[2]) });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^[-*]\s+(.+)$/.exec((lines[index] ?? "").trim());
        if (!item) break;
        items.push(stripInlineMarkdown(item[1]));
        index += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = (lines[index] ?? "").trim();
      if (!current || current.startsWith("```") || /^(#{1,6})\s+/.test(current) || /^[-*]\s+/.test(current)) break;
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: stripInlineMarkdown(paragraph.join(" ")) });
  }

  return blocks;
}

function renderReadmeBlock(block: ReadmeBlock, index: number) {
  if (block.type === "heading") {
    const HeadingTag = block.level <= 2 ? "h4" : "h5";
    return <HeadingTag key={`${block.type}-${index}`}>{block.text}</HeadingTag>;
  }
  if (block.type === "list") {
    return (
      <ul key={`${block.type}-${index}`}>
        {block.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    );
  }
  if (block.type === "code") {
    return <pre key={`${block.type}-${index}`}><code>{block.text}</code></pre>;
  }
  return <p key={`${block.type}-${index}`}>{block.text}</p>;
}

function stripInlineMarkdown(value: string) {
  return value.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").trim();
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

function commandResultGroups(result: OpenDockChangeResult, t: (typeof TEXT)[Lang]) {
  const versionChanges = result.reports.flatMap(versionChangeLabel);
  const unchanged = result.summary.unchanged.length > 0
    ? result.summary.unchanged
    : result.reports.filter((report) => report.status === "unchanged").map((report) => report.dockId);
  return [
    { count: result.summary.created.length, items: result.summary.created, key: "created", label: t.resultAdded, symbol: "+" },
    {
      count: versionChanges.length + result.summary.updated.length,
      items: [...versionChanges, ...result.summary.updated],
      key: "updated",
      label: t.resultChanged,
      symbol: "~",
    },
    { count: result.summary.deleted.length, items: result.summary.deleted, key: "deleted", label: t.resultDeleted, symbol: "-" },
    {
      count: result.summary.reviewRequired.length,
      items: result.summary.reviewRequired,
      key: "reviewRequired",
      label: t.resultReviewRequired,
      symbol: "!",
    },
    { count: unchanged.length, items: unchanged, key: "unchanged", label: t.resultNoChanges, symbol: "=" },
  ];
}

function openDockChangeResult(
  value: OpenDockCommandResult["json"],
): OpenDockChangeResult | null {
  if (!value || !("operation" in value)) return null;
  return value;
}

function isNoUpdateChangeResult(result: OpenDockChangeResult | null) {
  return result?.success === true && result.operation === "update" && result.reports.length === 0;
}

function isNoUpdateProgress(progress: OpenDockCommandProgress) {
  return (
    progress.operation === "update" &&
    progress.phase === "complete" &&
    progress.level.toUpperCase() === "OK" &&
    progress.message === "No OpenDock dock updates available."
  );
}

function successStepForChangeResult(result: OpenDockChangeResult | null, fallback: string, t: (typeof TEXT)[Lang]) {
  return isNoUpdateChangeResult(result) ? t.noUpdatesAvailable : fallback;
}

function openDockOutdatedResult(
  value: OpenDockCommandResult["json"],
): OpenDockOutdatedResult | null {
  if (!value || !("updatesAvailable" in value)) return null;
  return value;
}

function outdatedReportsByDockId(
  value: OpenDockCommandResult["json"],
): Record<string, OpenDockOutdatedReport> {
  const result = openDockOutdatedResult(value);
  if (!result?.success) return {};
  return Object.fromEntries(result.reports.map((report) => [report.dockId, report]));
}

function commandResultRows(result: OpenDockChangeResult, t: (typeof TEXT)[Lang]): CommandTaskRow[] {
  const rows: CommandTaskRow[] = [];
  for (const group of commandResultGroups(result, t).filter((item) => item.items.length > 0)) {
    const color = commandResultColor(group.symbol);
    rows.push({
      time: nowTime(),
      level: group.symbol,
      color,
      message: `${group.label} ${group.count}`,
    });
    const visibleItems = visibleChangeItems(group.items);
    for (const item of visibleItems) {
      rows.push({
        time: nowTime(),
        level: group.symbol,
        color,
        message: item,
      });
    }
    if (group.items.length > visibleItems.length) {
      rows.push({
        time: nowTime(),
        level: group.symbol,
        color,
        message: `... +${group.items.length - visibleItems.length}`,
      });
    }
  }
  return rows;
}

function commandResultColor(symbol: string) {
  if (symbol === "+") return "var(--success)";
  if (symbol === "~") return "var(--info)";
  if (symbol === "-") return "var(--danger)";
  if (symbol === "!") return "var(--warning)";
  return "var(--text-3)";
}

function versionChangeLabel(report: OpenDockChangeReport) {
  if (report.operation !== "update") return [];
  if (report.fromVersion && report.toVersion && report.fromVersion !== report.toVersion) {
    return [`${report.dockId} ${report.fromVersion} -> ${report.toVersion}`];
  }
  if (report.status === "updated" && report.fromVersion) {
    return [`${report.dockId} ${report.fromVersion} -> ${report.version}`];
  }
  return [];
}

function visibleChangeItems(items: string[]) {
  return items.slice(0, 8);
}

function statusLabel(status: CommandTaskStatus, t: (typeof TEXT)[Lang]) {
  if (status === "success") return t.taskCompleted;
  if (status === "error") return t.taskFailed;
  if (status === "cancelled") return t.taskCancelled;
  if (status === "cancelling") return t.taskCancelling;
  return t.taskWorking;
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

type MyDockReviewGroup = "approved" | "pending" | "rejected" | "unavailable";

function accountStatsFor(counts: MyDocksCounts, stars: number) {
  return {
    submitted: counts.all,
    approved: counts.approved,
    pending: counts.pending,
    rejected: counts.rejected,
    unavailable: counts.unavailable,
    hidden: counts.hidden,
    stars
  };
}

function myDockReviewGroup(dock: MyDock): MyDockReviewGroup {
  const status = myDockStatus(dock);
  if (status === "approved") return "approved";
  if (status === "pending") return "pending";
  if (status === "rejected") return "rejected";
  return "unavailable";
}

function myDockStatus(dock: MyDock) {
  if (dock.suspended) return "suspended";
  if (dock.hidden) return primaryMyDockVersion(dock)?.status?.toLowerCase() ?? "hidden";
  return dock.status?.toLowerCase() || primaryMyDockVersion(dock)?.status?.toLowerCase() || "pending";
}

function primaryMyDockVersion(dock: MyDock) {
  return dock.versions?.find((version) => version.version === dock.version) ?? dock.versions?.[0] ?? null;
}

function myDockStatusLabel(status: MyDockReviewGroup, t: (typeof TEXT)[Lang]) {
  if (status === "approved") return t.approved;
  if (status === "pending") return t.pending;
  if (status === "rejected") return t.rejected;
  return t.unavailable;
}

function dockFromMyDock(dock: MyDock): Dock {
  return {
    id: dock.name,
    short: dock.name,
    fullId: dock.id,
    owner: dock.owner ?? dock.id.split("/")[0] ?? "opendock",
    name: dock.name,
    displayName: dock.displayName ?? dock.name,
    grad: "linear-gradient(135deg,var(--dock-backend-a),var(--dock-backend-b) 55%,var(--dock-backend-c))",
    desc: dock.summary ?? dock.displayName ?? dock.name,
    tagA: myDockReviewGroup(dock),
    tagB: dock.hidden ? "hidden" : "submitted",
    more: "0",
    dl: "0",
    downloads: 0,
    stars: 0,
    updatedRank: 0,
    updatedAt: dock.updatedAt ?? dock.submittedAt ?? undefined,
    version: dock.latestApprovedVersion ?? dock.version ?? "-",
    size: "-",
    checksum: "-",
    readmeTitle: dock.displayName ?? dock.name,
    readmeIntro: dock.summary ?? "",
    logoUrl: dock.logo?.url ?? null,
    publisher: dock.owner ?? "opendock",
    official: dock.official,
    platforms: dock.versions?.map((version) => version.platform).filter(Boolean) ?? [],
    tags: [myDockReviewGroup(dock), dock.hidden ? "hidden" : "submitted"],
    modes: ["submitted"]
  };
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

function StatRow(props: { label: string; value: number }) {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function ProjectAddModal(props: {
  onAddExisting: () => void;
  onClose: () => void;
  onCreate: () => void;
  t: (typeof TEXT)[Lang];
}) {
  return (
    <div className="modal-layer">
      <div className="modal">
        <div className="modal-head">
          <div>
            <h2>{props.t.addProjectTitle}</h2>
            <p>{props.t.addProjectSub}</p>
          </div>
          <IconButton label={props.t.close} onClick={props.onClose}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="modal-options">
          <button className="project-option primary" onClick={props.onCreate} type="button">
            <span><Plus size={19} /></span>
            <strong>{props.t.newProjectAction}</strong>
            <small>{props.t.newProjectSub}</small>
          </button>
          <button className="project-option" onClick={props.onAddExisting} type="button">
            <span><FolderOpen size={19} /></span>
            <strong>{props.t.existingProjectAction}</strong>
            <small>{props.t.existingProjectSub}</small>
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectRenameModal(props: {
  name: string;
  onChange: (name: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  t: (typeof TEXT)[Lang];
}) {
  return (
    <div className="modal-layer">
      <form className="modal rename-modal" onSubmit={props.onSubmit}>
        <div className="modal-head">
          <div>
            <h2>{props.t.renameProjectTitle}</h2>
            <p>{props.t.renameProjectSub}</p>
          </div>
        </div>
        <div className="rename-body">
          <input aria-label={props.t.projectNameLabel} onChange={(event) => props.onChange(event.target.value)} value={props.name} />
          <div>
            <button onClick={props.onClose} type="button">
              {props.t.cancel}
            </button>
            <button type="submit">{props.t.save}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ProjectDeleteModal(props: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  t: (typeof TEXT)[Lang];
}) {
  return (
    <div className="modal-layer">
      <div aria-labelledby="project-delete-title" aria-modal="true" className="modal delete-modal" role="alertdialog">
        <div className="modal-head">
          <div>
            <h2 id="project-delete-title">{props.t.deleteProjectConfirmTitle}</h2>
            <p>{props.t.deleteProjectConfirmSub}</p>
          </div>
        </div>
        <div className="delete-body">
          <div className="delete-project-name">{props.name}</div>
          <div className="delete-actions">
            <button onClick={props.onCancel} type="button">
              {props.t.cancel}
            </button>
            <button className="danger-button" onClick={props.onConfirm} type="button">
              {props.t.deleteAction}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta(props: { label: string; value: string }) {
  return (
    <div className="meta-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function Pagination(props: {
  label: string;
  onPageChange: (page: number) => void;
  page: number;
  pageCount: number;
  t: (typeof TEXT)[Lang];
}) {
  const pageCount = Math.max(1, props.pageCount);
  const page = Math.min(Math.max(1, props.page), pageCount);
  const canPrevious = page > 1;
  const canNext = page < pageCount;
  const pageLabel = props.t.pageCount
    .replace("{page}", String(page))
    .replace("{pages}", String(pageCount));
  return (
    <nav aria-label={props.label} className="pagination">
      <button aria-label={props.t.firstPage} disabled={!canPrevious} onClick={() => props.onPageChange(1)} type="button"><ChevronsLeft size={13} /></button>
      <button aria-label={props.t.previousPage} disabled={!canPrevious} onClick={() => props.onPageChange(page - 1)} type="button"><ChevronLeft size={13} /></button>
      <span>{pageLabel}</span>
      <button aria-label={props.t.nextPage} disabled={!canNext} onClick={() => props.onPageChange(page + 1)} type="button"><ChevronRight size={13} /></button>
      <button aria-label={props.t.lastPage} disabled={!canNext} onClick={() => props.onPageChange(pageCount)} type="button"><ChevronsRight size={13} /></button>
    </nav>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" height="20" viewBox="0 0 48 48" width="20">
      <path d="M24 9.5c3.4 0 6.4 1.17 8.78 3.47l6.56-6.56C35.37 2.7 30.2.5 24 .5 14.63.5 6.56 5.88 2.63 13.7l7.63 5.92C12.07 13.65 17.6 9.5 24 9.5z" fill="#EA4335" />
      <path d="M46.5 24.5c0-1.57-.14-3.08-.4-4.5H24v8.52h12.64c-.55 2.95-2.2 5.45-4.68 7.13l7.24 5.61c4.23-3.9 7.3-9.65 7.3-16.76z" fill="#4285F4" />
      <path d="M10.26 28.38A14.55 14.55 0 019.5 24c0-1.52.26-3 .76-4.38L2.63 13.7A23.46 23.46 0 00.5 24c0 3.7.89 7.2 2.47 10.3l7.29-5.92z" fill="#FBBC05" />
      <path d="M24 47.5c6.2 0 11.4-2.04 15.2-6.24l-7.24-5.61c-2 1.34-4.57 2.13-7.96 2.13-6.4 0-11.93-4.15-13.74-10l-7.29 5.92C6.91 42.12 14.87 47.5 24 47.5z" fill="#34A853" />
    </svg>
  );
}

function useStoredState<T>(
  key: string,
  initialValue: T,
  options: { defer?: boolean; normalize?: (value: T) => T } = {},
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      const parsed = stored ? (JSON.parse(stored) as T) : initialValue;
      return options.normalize ? options.normalize(parsed) : parsed;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (!options.defer) {
      localStorage.setItem(key, serialized);
      return;
    }
    const timeout = window.setTimeout(() => {
      localStorage.setItem(key, serialized);
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [key, value]);

  return [value, setValue];
}
