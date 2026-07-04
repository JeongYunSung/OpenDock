import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";
import type { Dock, DockView, Project } from "./data";
import type { OpenMenu } from "./titlebar";
import type { ShortcutCommandId } from "./shortcuts";
import { isTauriRuntime } from "./tauri-runtime";

interface NavigationControllerOptions {
  activeProject: Project | undefined;
  appVersion: string;
  addExistingProjectFromFolder: () => Promise<void>;
  appendLog: (level: string, color: string, message: string) => void;
  createBlankProject: () => Promise<void>;
  deleteDock: (dock: Dock) => Promise<void>;
  detail: Dock | null;
  detailKey: string;
  dockView: DockView;
  exportShortcuts: () => Promise<void>;
  checkProductUpdate: () => Promise<void>;
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
      case "edit:cut":
        await runTextEditCommand("cut");
        break;
      case "edit:copy":
        await runTextEditCommand("copy");
        break;
      case "edit:paste":
        await runTextEditCommand("paste");
        break;
      case "edit:select-all":
        await runTextEditCommand("selectAll");
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
        if (options.detail && options.dockView === "detail") await options.installDock(options.detail);
        break;
      case "dock:delete":
        if (options.detail && options.dockView === "detail") await options.deleteDock(options.detail);
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
      case "help:current-version":
        options.appendLog("INFO", "var(--text-2)", `OpenDock ${options.appVersion || "unknown"}`);
        break;
      case "help:check-for-updates":
        await options.checkProductUpdate();
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
      options.appendLog("OK", "var(--success)", `copied workspace path · ${project.folderName}`);
    } catch {
      options.appendLog("WARN", "var(--warning)", "workspace path copy failed");
    }
  }

  return {
    handleNativeMenu,
    openDockDetail,
    runAppMenuCommand,
    runShortcutCommand,
    selectProject,
    setMainView,
  };
}

type TextEditCommand = "copy" | "cut" | "paste" | "selectAll";
type EditableElement = HTMLInputElement | HTMLTextAreaElement;

async function runTextEditCommand(command: TextEditCommand) {
  try {
    const editable = activeEditableElement();
    if (command === "selectAll") {
      selectAppText(editable);
      return;
    }
    if (command === "paste") {
      await pasteIntoEditable(editable);
      return;
    }

    const text = selectionText(editable);
    if (!text) return;
    await navigator.clipboard.writeText(text);
    if (command === "cut" && editable) replaceEditableSelection(editable, "");
  } catch {
    document.execCommand(command === "selectAll" ? "selectAll" : command);
  }
}

function activeEditableElement(): EditableElement | null {
  const element = document.activeElement;
  if (element instanceof HTMLTextAreaElement && !element.disabled && !element.readOnly) return element;
  if (element instanceof HTMLInputElement && isTextInput(element) && !element.disabled && !element.readOnly) return element;
  return null;
}

function isTextInput(element: HTMLInputElement) {
  return ["", "email", "password", "search", "tel", "text", "url"].includes(element.type);
}

function selectionText(editable: EditableElement | null) {
  if (editable && editable.selectionStart !== null && editable.selectionEnd !== null) {
    return editable.value.slice(editable.selectionStart, editable.selectionEnd);
  }
  return window.getSelection()?.toString() ?? "";
}

async function pasteIntoEditable(editable: EditableElement | null) {
  if (!editable) return;
  const text = await navigator.clipboard.readText();
  if (!text) return;
  replaceEditableSelection(editable, text);
}

function replaceEditableSelection(editable: EditableElement, text: string) {
  const start = editable.selectionStart ?? editable.value.length;
  const end = editable.selectionEnd ?? editable.value.length;
  editable.setRangeText(text, start, end, "end");
  editable.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: text ? "insertText" : "deleteByCut" }));
}

function selectAppText(editable: EditableElement | null) {
  if (editable) {
    editable.select();
    return;
  }
  const selection = window.getSelection();
  const target = document.querySelector(".workspace-main") ?? document.body;
  if (!selection || !target) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
}
