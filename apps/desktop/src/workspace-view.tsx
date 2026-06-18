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
import { CatalogEmptyState, DetailPanel, ExplorePanel, InstalledPanel, LogsPanel } from "./dock-panels";
import type { InstalledDockRow } from "./dock-workspace-model";
import type { ShortcutBinding, ShortcutCommandId, ShortcutPlatform } from "./shortcuts";
import type { OpenMenu } from "./titlebar";
import { ProjectSidebar } from "./workspace-shell";

export { ACCOUNT_PAGE_LIMIT };

export function Workspace(props: {
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
