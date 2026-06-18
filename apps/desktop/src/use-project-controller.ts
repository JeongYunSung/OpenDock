import { invoke } from "@tauri-apps/api/core";
import { useRef, useState, type FormEvent } from "react";
import type { Project, ProjectFolder } from "./data";
import { isTauriRuntime } from "./tauri-runtime";
import { useStoredState } from "./use-stored-state";

interface ProjectControllerOptions {
  appendLog: (level: string, color: string, message: string) => void;
  resetDockWorkspaceView: () => void;
  setOpenMenu: (value: "") => void;
}

export function useProjectController(options: ProjectControllerOptions) {
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
  const blankProjectCreatingRef = useRef(false);

  function registerProject(name: string, folderName: string, path: string) {
    const cleanFolderName = (folderName || name || "selected-project").trim();
    const cleanName = (name || cleanFolderName).trim();
    const project = {
      id: `project-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      name: cleanName,
      folderName: cleanFolderName,
      path,
    };
    setProjects((current) => [...current, project]);
    setActiveProjectId(project.id);
    setProjectAddOpen(false);
    setProjectRenameOpen(false);
    setProjectDeleteOpen(false);
    options.resetDockWorkspaceView();
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
      { once: true },
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
    options.setOpenMenu("");
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
    options.setOpenMenu("");
  }

  function closeProjectDelete() {
    setProjectDeleteOpen(false);
    setDeleteProjectId("");
    setDeleteProjectName("");
  }

  function resetProjectDialogs() {
    setProjectAddOpen(false);
    setProjectRenameOpen(false);
    setProjectDeleteOpen(false);
    setRenameProjectId("");
    setRenameProjectName("");
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
      options.resetDockWorkspaceView();
    } else {
      options.setOpenMenu("");
    }
    options.appendLog("OK", "var(--success)", `removed project · ${project.folderName}`);
  }

  return {
    activeProjectId,
    addExistingProjectFromFolder,
    closeProjectDelete,
    closeProjectRename,
    confirmProjectDelete,
    createBlankProject,
    deleteProjectName,
    openDeleteProject,
    openRenameProject,
    projectAddOpen,
    projectDeleteOpen,
    projectRenameOpen,
    projects,
    projectSidebarCollapsed,
    resetProjectDialogs,
    removeProjectFromOpenDock,
    renameProjectName,
    saveProjectRename,
    setActiveProjectId,
    setProjectAddOpen,
    setProjectDeleteOpen,
    setProjectRenameOpen,
    setProjects,
    setProjectSidebarCollapsed,
    setRenameProjectName,
  };
}
