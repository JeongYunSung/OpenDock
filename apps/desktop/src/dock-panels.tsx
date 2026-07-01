import { ArrowLeft, ChevronDown, ChevronLeft, Download, Search } from "lucide-react";
import { isTaskActive, type CommandTask } from "./command-task";
import {
  dockFullId,
  dockOwnerFromId,
  dockPublisherLabel,
  dockPublisherOfficial,
  type Dock,
  type DockVersion,
  type Lang,
  type TEXT,
} from "./data";
import {
  DockIcon,
  KeyboardButton,
  badgeSrc,
  formatDateLabel,
  platformLabel,
  versionStatusClass,
  versionStatusLabel,
} from "./display";
import { DockMetric, Pagination, StarButton } from "./desktop-ui";
import { ReadmePanel } from "./readme-panel";

export function ExplorePanel(props: {
  catalogPage: number;
  catalogPageCount: number;
  onOpenDetail: (dockId: string) => void;
  onSetCatalogPage: (page: number) => void;
  onSetSearchQuery: (query: string) => void;
  onSetSortMode: (mode: "downloads" | "stars" | "recent" | "name") => void;
  onToggleDockStar: (dock: Dock) => void;
  openMenu: "" | "app" | "lang" | "account" | "sort";
  searchQuery: string;
  setOpenMenu: (menu: "" | "app" | "lang" | "account" | "sort") => void;
  sortMode: "downloads" | "stars" | "recent" | "name";
  sortedDocks: Dock[];
  starredDockIds: Record<string, boolean>;
  starUpdatingId: string;
  t: (typeof TEXT)[Lang];
}) {
  const sortLabels = {
    downloads: props.t.sortDownloads,
    name: props.t.sortName,
    recent: props.t.sortRecent,
    stars: props.t.sortStars,
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
            {props.sortedDocks.map((dock) => {
              const fullId = dockFullId(dock);
              return (
                <DockCard
                  dock={dock}
                  key={fullId}
                  onOpen={() => props.onOpenDetail(fullId)}
                  onToggleStar={props.onToggleDockStar}
                  starBusy={props.starUpdatingId === fullId}
                  starred={Boolean(props.starredDockIds[fullId])}
                  t={props.t}
                />
              );
            })}
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

export function CatalogEmptyState(props: { t: (typeof TEXT)[Lang] }) {
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
  const publisher = dockPublisherLabel(props.dock);
  const publisherOfficial = dockPublisherOfficial(props.dock);
  return (
    <KeyboardButton ariaLabel={`${props.t.openDetail}: ${dockFullId(props.dock)}`} className="dock-card" onOpen={props.onOpen}>
      <div className="dock-card-head">
        <DockIcon dock={props.dock} />
        <div>
          <div className="dock-title">
            <strong>{props.dock.short}</strong>
          </div>
          {publisher ? (
            <small className="dock-publisher-line">
              {props.t.by} {publisher}
              {publisherOfficial ? <img alt="official badge" src={badgeSrc} /> : null}
            </small>
          ) : null}
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

export function DetailPanel(props: {
  commandTask: CommandTask | null;
  detail: Dock;
  detailTab: "readme" | "versions";
  detailVersion: DockVersion | null;
  installedDocks: Record<string, boolean>;
  onBack: () => void;
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
  const owner = props.detail.owner ?? dockOwnerFromId(fullId);
  const publisher = dockPublisherLabel(props.detail);
  const publisherOfficial = dockPublisherOfficial(props.detail);
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
              <div className="detail-breadcrumb">{props.t.explore}{owner ? ` / ${owner}` : ""}</div>
              <div className="detail-title-row">
                <h1>{fullId}</h1>
              </div>
              <div className="detail-meta">
                {publisher ? (
                  <>
                    {props.t.by} {publisher}
                    {publisherOfficial ? <img alt="official badge" src={badgeSrc} /> : null}
                    <span>·</span>
                  </>
                ) : null}
                {props.t.updated} {formatDateLabel(props.detail.updatedAt)}
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
