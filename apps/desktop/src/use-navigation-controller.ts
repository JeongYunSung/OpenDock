import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";
import type { Dock, DockView, Project } from "./data";
import type { OpenMenu } from "./titlebar";
import type { ShortcutCommandId } from "./shortcuts";
import { isTauriRuntime } from "./tauri-runtime";

interface NavigationControllerOptions {
  activeProject: Project | undefined;
  addExistingProjectFromFolder: () => Promise<void>;
  appendLog: (level: string, color: string, message: string) => void;
  createBlankProject: () => Promise<void>;
  deleteDock: (dock: Dock) => Promise<void>;
  detail: Dock | null;
  detailKey: string;
  dockView: DockView;
  exportShortcuts: () => Promise<void>;
  importShortcuts: () => Promise<void>;
  installDock: (dock: Dock) => Promise<void>;
  openDeleteProject: (project: Project) => void;
  openRenameProject: (project: Project) => void;
  projects: Project[];
  refreshCatalogFromRegistry: () => Promise<void>;
  refreshProjectLogs: (project: Project | undefined) => Promise<void>;
  resetDockWorkspaceView: () => void;
  runDoctor: (project: Project | undefined) => Promise<void>;
  setActiveProjectId: Dispatch<SetStateAction<string>>;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setDetailId: Dispatch<SetStateAction<string>>;
  setDetailTab: Dispatch<SetStateAction<"readme" | "versions">>;
  setDockView: Dispatch<SetStateAction<DockView>>;
  setNickname: Dispatch<SetStateAction<string>>;
  setOpenMenu: Dispatch<SetStateAction<OpenMenu>>;
  setProjectSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  setProjectSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  updateDocks: (project: Project | undefined, options?: { showLogs?: boolean }) => Promise<void>;
}

export function useNavigationController(options: NavigationControllerOptions) {
  function openDockDetail(dockId: string) {
    options.setDetailId(dockId);
    options.setDetailTab("readme");
    options.setDockView("detail");
    options.setOpenMenu("");
  }

  function setMainView(view: DockView) {
    options.setDockView(view);
    options.setDetailTab("readme");
    options.setOpenMenu("");
    options.setCommandPaletteOpen(false);
    options.setProjectSwitcherOpen(false);
    if (view === "logs") void options.refreshProjectLogs(options.activeProject);
  }

  function selectProject(projectId: string) {
    options.setActiveProjectId(projectId);
    options.setProjectSwitcherOpen(false);
    options.setCommandPaletteOpen(false);
    options.resetDockWorkspaceView();
  }

  async function runShortcutCommand(commandId: ShortcutCommandId) {
    switch (commandId) {
      case "command.palette":
        options.setCommandPaletteOpen((current) => !current);
        options.setProjectSwitcherOpen(false);
        break;
      case "project.new":
        await options.createBlankProject();
        break;
      case "project.open":
        await options.addExistingProjectFromFolder();
        break;
      case "project.switch":
        if (options.projects.length > 0) {
          options.setProjectSwitcherOpen(true);
          options.setCommandPaletteOpen(false);
        }
        break;
      case "nav.explore":
        if (options.activeProject) setMainView("list");
        break;
      case "nav.installed":
        if (options.activeProject) setMainView("installed");
        break;
      case "nav.logs":
        if (options.activeProject) setMainView("logs");
        break;
      case "project.updateAll":
        await options.updateDocks(options.activeProject, { showLogs: false });
        break;
      case "dock.refresh":
        await options.refreshCatalogFromRegistry();
        break;
      case "dock.install":
        if (options.detail && options.dockView === "detail") await options.installDock(options.detail);
        break;
      default:
        break;
    }
  }

  function saveNickname(nextNickname: string) {
    const normalized = nextNickname.trim();
    if (!normalized) return;
    options.setNickname(normalized);
  }

  async function handleNativeMenu(id: string) {
    switch (id) {
      case "file:new-project":
        await options.createBlankProject();
        break;
      case "file:add-existing-project":
        await options.addExistingProjectFromFolder();
        break;
      case "edit:rename-project":
        if (options.activeProject) options.openRenameProject(options.activeProject);
        break;
      case "edit:copy-project-path":
        await copyProjectPath(options.activeProject);
        break;
      case "edit:import-shortcuts":
        await options.importShortcuts();
        break;
      case "edit:export-shortcuts":
        await options.exportShortcuts();
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
        options.setProjectSidebarCollapsed((current) => !current);
        break;
      case "project:run-doctor":
        await options.runDoctor(options.activeProject);
        break;
      case "project:update-docks":
        await options.updateDocks(options.activeProject);
        break;
      case "project:open-folder":
      case "project:reveal-folder":
        await openProjectFolder(options.activeProject);
        break;
      case "project:remove-from-opendock":
        if (options.activeProject) options.openDeleteProject(options.activeProject);
        break;
      case "dock:install":
        if (options.detail) await options.installDock(options.detail);
        break;
      case "dock:delete":
        if (options.detail) await options.deleteDock(options.detail);
        break;
      case "dock:refresh-registry":
        await options.refreshCatalogFromRegistry();
        break;
      case "dock:open-detail":
        if (options.detailKey) openDockDetail(options.detailKey);
        break;
      case "window:reload":
        window.location.reload();
        break;
      case "help:docs":
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

  async function runAppMenuCommand(id: string) {
    options.setOpenMenu("");
    await handleNativeMenu(id);
  }

  async function openProjectFolder(project: Project | undefined) {
    if (!project) return;
    if (!isTauriRuntime()) {
      options.appendLog("INFO", "var(--text-2)", `open folder ${project.path}`);
      return;
    }
    try {
      await invoke("open_project_folder", { projectDir: project.path });
    } catch (error) {
      options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
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
      options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    }
  }

  async function copyProjectPath(project: Project | undefined) {
    if (!project) return;
    try {
      await navigator.clipboard.writeText(project.path);
      options.appendLog("OK", "var(--success)", `copied project path · ${project.folderName}`);
    } catch {
      options.appendLog("WARN", "var(--warning)", "project path copy failed");
    }
  }

  return {
    handleNativeMenu,
    openDockDetail,
    runAppMenuCommand,
    runShortcutCommand,
    saveNickname,
    selectProject,
    setMainView,
  };
}
