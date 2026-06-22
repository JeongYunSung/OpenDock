import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, ChevronDown, Globe2, LogOut, Moon, RefreshCw, Sun, UserRound } from "lucide-react";
import type { MouseEvent } from "react";
import { type Lang, type ProductUpdateState, TEXT } from "./data";
import { logoSrc } from "./display";
import { isTauriRuntime } from "./tauri-runtime";
import {
  AppMenu,
  WindowControls,
  appMenuGroups,
  type WindowControlPlatform,
} from "./app-menu";

export type OpenMenu = "" | "app" | "lang" | "account" | "sort";

export function Titlebar(props: {
  accountName: string;
  appVersion: string;
  lang: Lang;
  loggedIn: boolean;
  onAccount: () => void;
  onAppMenu: () => void;
  onAppMenuCommand: (id: string) => void;
  onLang: () => void;
  onLogout: () => void;
  onOpenProfile: () => void;
  onOpenProductUpdate: () => void;
  onSetEnglish: () => void;
  onSetKorean: () => void;
  onTheme: () => void;
  openMenu: OpenMenu;
  productUpdate: ProductUpdateState;
  projectPathLabel: string;
  t: (typeof TEXT)[Lang];
  windowControlPlatform: WindowControlPlatform;
}) {
  const isMac = props.windowControlPlatform === "macos";
  const windowControls = {
    onClose: () => void handleWindow("close"),
    onMaximize: () => void handleWindow("maximize"),
    onMinimize: () => void handleWindow("minimize"),
  };
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
          onClose={windowControls.onClose}
          onMaximize={windowControls.onMaximize}
          onMinimize={windowControls.onMinimize}
          platform={props.windowControlPlatform}
          t={props.t}
        />
      ) : null}
      {!isMac ? (
        <AppMenu
          groups={appMenuGroups(props.t, props.appVersion)}
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
        {props.productUpdate.status === "available" && props.productUpdate.check ? (
          <button
            aria-label={props.t.appUpdateOpenRelease.replace("{version}", props.productUpdate.check.latestVersion)}
            className="product-update-button"
            onClick={props.onOpenProductUpdate}
            title={props.t.appUpdateOpenRelease.replace("{version}", props.productUpdate.check.latestVersion)}
            type="button"
          >
            <RefreshCw size={13} />
            <span>{props.t.appUpdateAvailable.replace("{version}", props.productUpdate.check.latestVersion)}</span>
          </button>
        ) : null}
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
            onClose={windowControls.onClose}
            onMaximize={windowControls.onMaximize}
            onMinimize={windowControls.onMinimize}
            platform={props.windowControlPlatform}
            t={props.t}
          />
        ) : null}
      </div>
    </header>
  );
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

function isInteractiveTitlebarTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.closest(
      'button,a,input,textarea,select,[role="button"],[role="menu"],.dropdown-menu,.app-menu-panel,.window-controls,.titlebar-actions',
    ),
  );
}
