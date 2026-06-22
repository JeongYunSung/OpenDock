import { ChevronRight, Maximize2, Menu as MenuIcon, Minus, X } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { type Lang, TEXT } from "./data";

export type WindowControlPlatform = "macos" | "windows";
type AppMenuItem = { id: string; label: string; shortcut?: string } | { type: "separator" };
export type AppMenuGroup = { items: AppMenuItem[]; key: string; label: string };

export function detectWindowControlPlatform(): WindowControlPlatform {
  if (typeof navigator === "undefined") return "windows";
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  return platform.includes("mac") ? "macos" : "windows";
}

export function appMenuGroups(t: (typeof TEXT)[Lang], appVersion: string): AppMenuGroup[] {
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
        { id: "help:current-version", label: t.menuCurrentVersion.replace("{version}", appVersion || "...") },
        { id: "help:check-for-updates", label: t.menuCheckForUpdates },
        { type: "separator" },
        { id: "help:docs", label: t.menuDocs },
        { id: "help:cli-commands", label: t.menuCliCommands },
        { id: "help:troubleshooting", label: t.menuTroubleshooting },
      ],
    },
  ];
}

export function AppMenu(props: {
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
                    <button className="app-menu-item" key={item.id} onClick={() => props.onCommand(item.id)} type="button">
                      <span>{item.label}</span>
                      {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                    </button>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WindowControls(props: {
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
