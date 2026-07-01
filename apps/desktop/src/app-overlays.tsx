import type { FormEvent } from "react";
import { CommandPaletteDialog, CommandProgressDialog, ProjectSwitcherDialog } from "./app-dialogs";
import type { CommandTask } from "./command-task";
import type { Lang, Project, TEXT } from "./data";
import { ProjectAddModal, ProjectDeleteModal, ProjectRenameModal } from "./project-modals";
import type { ShortcutBinding, ShortcutCommandId, ShortcutPlatform } from "./shortcuts";

export function AppOverlays(props: {
  activeProjectId: string;
  bindings: ShortcutBinding[];
  commandPaletteOpen: boolean;
  commandTask: CommandTask | null;
  deleteProjectName: string;
  lang: Lang;
  onAddExistingProject: () => void;
  onCancelCommand: () => void;
  onCloseCommandPalette: () => void;
  onCloseCommandProgress: () => void;
  onCloseProjectAdd: () => void;
  onCloseProjectRename: () => void;
  onConfirmProjectDelete: () => void;
  onCreateBlankProject: () => void;
  onForceRetryCommand: () => void;
  onProjectDeleteCancel: () => void;
  onRenameProjectChange: (name: string) => void;
  onRenameProjectSubmit: (event: FormEvent) => void;
  onRunShortcutCommand: (commandId: ShortcutCommandId) => void;
  onSelectProject: (projectId: string) => void;
  onSwitcherClose: () => void;
  projectAddOpen: boolean;
  projectDeleteOpen: boolean;
  projectRenameOpen: boolean;
  projectSwitcherOpen: boolean;
  projects: Project[];
  renameProjectName: string;
  shortcutPlatform: ShortcutPlatform;
  t: (typeof TEXT)[Lang];
}) {
  return (
    <>
      {props.projectAddOpen ? (
        <ProjectAddModal
          onAddExisting={props.onAddExistingProject}
          onClose={props.onCloseProjectAdd}
          onCreate={props.onCreateBlankProject}
          t={props.t}
        />
      ) : null}

      {props.projectRenameOpen ? (
        <ProjectRenameModal
          name={props.renameProjectName}
          onChange={props.onRenameProjectChange}
          onClose={props.onCloseProjectRename}
          onSubmit={props.onRenameProjectSubmit}
          t={props.t}
        />
      ) : null}

      {props.projectDeleteOpen ? (
        <ProjectDeleteModal
          name={props.deleteProjectName}
          onCancel={props.onProjectDeleteCancel}
          onConfirm={props.onConfirmProjectDelete}
          t={props.t}
        />
      ) : null}

      {props.commandTask ? (
        <CommandProgressDialog
          commandTask={props.commandTask}
          onCancel={props.onCancelCommand}
          onClose={props.onCloseCommandProgress}
          onForceRetryCommand={props.onForceRetryCommand}
          t={props.t}
        />
      ) : null}

      {props.commandPaletteOpen ? (
        <CommandPaletteDialog
          bindings={props.bindings}
          lang={props.lang}
          onClose={props.onCloseCommandPalette}
          onRun={props.onRunShortcutCommand}
          platform={props.shortcutPlatform}
          t={props.t}
        />
      ) : null}

      {props.projectSwitcherOpen ? (
        <ProjectSwitcherDialog
          activeProjectId={props.activeProjectId}
          onClose={props.onSwitcherClose}
          onSelect={props.onSelectProject}
          projects={props.projects}
          t={props.t}
        />
      ) : null}
    </>
  );
}
