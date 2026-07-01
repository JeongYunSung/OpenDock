import { Eye, RefreshCw, Search, Trash2 } from "lucide-react";
import { isTaskActive, isTaskForTarget, type CommandTask } from "./command-task";
import { dockFullId, type Dock, type Lang, type Project, type TEXT } from "./data";
import type { InstalledDockRow } from "./dock-workspace-model";
import { PanelLoadingState } from "./desktop-ui";
import { DockIcon } from "./display";

export function InstalledPanel(props: {
  activeProject: Project;
  commandTask: CommandTask | null;
  installedRows: InstalledDockRow[];
  installedSearchQuery: string;
  installedTotalCount: number;
  loading: boolean;
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
      {props.loading ? (
        <PanelLoadingState label={props.t.loadingInstalledDocks} />
      ) : props.installedTotalCount > 0 && props.installedRows.length > 0 ? (
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
