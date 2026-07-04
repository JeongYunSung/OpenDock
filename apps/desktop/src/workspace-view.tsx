import { useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import { ACCOUNT_PAGE_LIMIT, AccountPanel } from "./account-panel";
import type { CommandTask } from "./command-task";
import type {
  AppLog,
  Dock,
  DockVersion,
  DockView,
  Lang,
  MyDock,
  MyDocksCounts,
  Project,
  SortMode,
  TEXT,
} from "./data";
import { CatalogEmptyState, DetailLoadingState, DetailPanel, ExplorePanel } from "./dock-panels";
import type { InstalledDockRow } from "./dock-workspace-model";
import { InstalledPanel } from "./installed-panel";
import { LogsPanel } from "./logs-panel";
import type { ShortcutBinding, ShortcutCommandId, ShortcutPlatform } from "./shortcuts";
import type { OpenMenu } from "./titlebar";
import { ProjectSidebar } from "./workspace-shell";

export { ACCOUNT_PAGE_LIMIT };

const DETAIL_LAYER_EXIT_MS = 220;
const BACK_GESTURE_COOLDOWN_MS = 520;
const BACK_GESTURE_RESET_MS = 260;
const BACK_GESTURE_THRESHOLD = 56;
const BACK_GESTURE_DOMINANCE = 1.25;

interface DetailLayerSnapshot {
  detail: Dock | null;
  detailLoading: boolean;
  detailTab: "readme" | "versions";
  detailVersion: DockVersion | null;
  versionPage: number;
  versionPageCount: number;
}

export function Workspace(props: {
  activeProject: Project;
  accountAvatarUrl: string | null;
  accountDisplayName: string;
  accountEmail: string;
  accountOfficial: boolean;
  catalogPage: number;
  catalogPageCount: number;
  commandTask: CommandTask | null;
  detail: Dock | null;
  detailTab: "readme" | "versions";
  detailVersion: DockVersion | null;
  dockView: DockView;
  installedDocks: Record<string, boolean>;
  catalogLoading: boolean;
  detailLoading: boolean;
  installedLoading: boolean;
  installedRows: InstalledDockRow[];
  installedSearchQuery: string;
  installedTotalCount: number;
  lang: Lang;
  logs: AppLog[];
  myDocks: MyDock[];
  myDocksCounts: MyDocksCounts;
  myDocksLoading: boolean;
  myDocksPage: number;
  myDocksPageCount: number;
  myDocksTotal: number;
  myStarredDocks: Dock[];
  myStarsLoading: boolean;
  nickname: string;
  profileSaving: boolean;
  onAddExisting: () => void;
  onBack: () => void;
  onCreate: () => void;
  onDeleteDock: (dock: Dock) => void;
  onDetailBack: () => void;
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
  const [exitingDetail, setExitingDetail] = useState<DetailLayerSnapshot | null>(null);
  const previousDockViewRef = useRef<DockView>(props.dockView);
  const lastDetailLayerRef = useRef<DetailLayerSnapshot | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const backGestureRef = useRef({ deltaX: 0, deltaY: 0, lastAt: 0, lockedUntil: 0 });
  const activeDetailLayer =
    props.dockView === "detail"
      ? {
          detail: props.detail,
          detailLoading: props.detailLoading,
          detailTab: props.detailTab,
          detailVersion: props.detailVersion,
          versionPage: props.versionPage,
          versionPageCount: props.versionPageCount,
        }
      : null;

  if (activeDetailLayer) {
    lastDetailLayerRef.current = activeDetailLayer;
  }

  useEffect(() => {
    const previousDockView = previousDockViewRef.current;
    if (props.dockView === "detail") {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
      setExitingDetail(null);
    } else if (previousDockView === "detail" && props.dockView === "list" && lastDetailLayerRef.current) {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
      setExitingDetail(lastDetailLayerRef.current);
      exitTimerRef.current = window.setTimeout(() => {
        setExitingDetail(null);
        exitTimerRef.current = null;
      }, DETAIL_LAYER_EXIT_MS);
    }
    previousDockViewRef.current = props.dockView;
  }, [props.dockView]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    };
  }, []);

  function renderDetailLayer(layer: DetailLayerSnapshot) {
    if (layer.detailLoading) return <DetailLoadingState label={props.t.loadingDockDetail} />;
    if (!layer.detail) return <CatalogEmptyState t={props.t} />;
    return (
      <DetailPanel
        {...props}
        detail={layer.detail}
        detailTab={layer.detailTab}
        detailVersion={layer.detailVersion}
        onBack={props.onDetailBack}
        versionPage={layer.versionPage}
        versionPageCount={layer.versionPageCount}
      />
    );
  }

  function handlePanelWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (props.dockView !== "detail" || !isMacRuntime() || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode);
    const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode);
    if (deltaX >= 0 || canScrollableAncestorConsumeHorizontalWheel(event.target, event.currentTarget, deltaX)) return;

    const now = Date.now();
    const gesture = backGestureRef.current;
    if (now - gesture.lastAt > BACK_GESTURE_RESET_MS) {
      gesture.deltaX = 0;
      gesture.deltaY = 0;
    }
    gesture.lastAt = now;
    gesture.deltaX += deltaX;
    gesture.deltaY += deltaY;

    const horizontalEnough = Math.abs(gesture.deltaX) >= BACK_GESTURE_THRESHOLD;
    const mostlyHorizontal = Math.abs(gesture.deltaX) > Math.abs(gesture.deltaY) * BACK_GESTURE_DOMINANCE;
    if (!horizontalEnough || !mostlyHorizontal || now < gesture.lockedUntil) return;

    event.preventDefault();
    event.stopPropagation();
    gesture.deltaX = 0;
    gesture.deltaY = 0;
    gesture.lockedUntil = now + BACK_GESTURE_COOLDOWN_MS;
    props.onDetailBack();
  }

  const showExploreSurface = props.dockView === "list" || props.dockView === "detail";
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

        <div className={`workspace-panel-stack ${activeDetailLayer ? "detail-active" : ""}`} onWheelCapture={handlePanelWheel}>
          {showExploreSurface ? <ExplorePanel {...props} loading={props.catalogLoading} /> : null}
          {activeDetailLayer ? <div className="workspace-detail-layer workspace-detail-layer-enter">{renderDetailLayer(activeDetailLayer)}</div> : null}
          {exitingDetail ? (
            <div aria-hidden="true" className="workspace-detail-layer workspace-detail-layer-exit">
              {renderDetailLayer(exitingDetail)}
            </div>
          ) : null}
          {props.dockView === "installed" ? <InstalledPanel {...props} loading={props.installedLoading} /> : null}
          {props.dockView === "logs" ? <LogsPanel activeProject={props.activeProject} logs={props.logs} t={props.t} /> : null}
          {props.dockView === "account" ? (
            <AccountPanel
              accountAvatarUrl={props.accountAvatarUrl}
              accountDisplayName={props.accountDisplayName}
              accountEmail={props.accountEmail}
              accountOfficial={props.accountOfficial}
              lang={props.lang}
              myDocks={props.myDocks}
              myDocksCounts={props.myDocksCounts}
              myDocksLoading={props.myDocksLoading}
              myDocksPage={props.myDocksPage}
              myDocksPageCount={props.myDocksPageCount}
              myDocksTotal={props.myDocksTotal}
              myStarredDocks={props.myStarredDocks}
              myStarsLoading={props.myStarsLoading}
              nickname={props.nickname}
              profileSaving={props.profileSaving}
              onBack={props.onBack}
              onOpenDetail={props.onOpenDetail}
              onSaveNickname={props.onSaveNickname}
              onSetMyDocksPage={props.onSetMyDocksPage}
              t={props.t}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function isMacRuntime() {
  if (typeof navigator === "undefined") return false;
  return `${navigator.platform} ${navigator.userAgent}`.toLowerCase().includes("mac");
}

function normalizeWheelDelta(delta: number, deltaMode: number) {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2 && typeof window !== "undefined") return delta * window.innerWidth;
  return delta;
}

function canScrollableAncestorConsumeHorizontalWheel(target: EventTarget, boundary: HTMLElement, deltaX: number) {
  if (!(target instanceof Element)) return false;

  let element: Element | null = target;
  while (element && element !== boundary) {
    if (element instanceof HTMLElement && isHorizontallyScrollable(element)) {
      if (deltaX < 0 && element.scrollLeft > 1) return true;
      if (deltaX > 0 && element.scrollLeft < element.scrollWidth - element.clientWidth - 1) return true;
    }
    element = element.parentElement;
  }
  return false;
}

function isHorizontallyScrollable(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const overflowX = style.overflowX;
  if (overflowX !== "auto" && overflowX !== "scroll") return false;
  return element.scrollWidth > element.clientWidth + 1;
}
