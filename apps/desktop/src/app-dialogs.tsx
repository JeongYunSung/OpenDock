import { Check, Folder, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  commandTaskTitle,
  isTaskActive,
  type CommandTask,
} from "./command-task";
import type { Lang, Project, TEXT } from "./data";
import { IconButton } from "./display";
import {
  formatShortcutForDisplay,
  shortcutCommandLabel,
  type ShortcutBinding,
  type ShortcutCommandId,
  type ShortcutPlatform,
} from "./shortcuts";

export function CommandProgressDialog(props: {
  commandTask: CommandTask;
  onClose: () => void;
  onForceRetryCommand: () => void;
  t: (typeof TEXT)[Lang];
}) {
  return (
    <div className="command-progress-overlay">
      <div aria-labelledby="command-progress-title" aria-modal="true" className="command-progress-dialog" role="dialog">
        <CommandProgressCard
          commandTask={props.commandTask}
          onClose={props.onClose}
          onForceRetryCommand={props.onForceRetryCommand}
          t={props.t}
        />
      </div>
    </div>
  );
}

function CommandProgressCard(props: {
  commandTask: CommandTask;
  onClose: () => void;
  onForceRetryCommand: () => void;
  t: (typeof TEXT)[Lang];
}) {
  const active = isTaskActive(props.commandTask);
  const percent = `${Math.round(props.commandTask.progress)}%`;
  const rows = props.commandTask.rows.slice(0, 16);
  const forceRetry = !active ? props.commandTask.forceRetry : null;
  return (
    <section aria-live="polite" className={`command-progress ${props.commandTask.status}`} role="status">
      <div className="command-progress-head">
        <div className="command-progress-title-wrap">
          <div>
            <span className="command-progress-dot" />
            <strong id="command-progress-title">{commandTaskTitle(props.commandTask.kind, props.t)}</strong>
          </div>
          <p>{props.commandTask.step}</p>
        </div>
        <strong className="command-progress-percent">{percent}</strong>
      </div>
      <div
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(props.commandTask.progress)}
        className="command-progress-bar"
        role="progressbar"
      >
        <span style={{ width: `${props.commandTask.progress}%` }} />
      </div>
      <div className="command-progress-log">
        <strong>{props.t.operationLog}</strong>
        <div>
          {rows.map((row, index) => (
            <p key={`${row.time}-${row.message}-${index}`}>
              <span>{row.time}</span>
              <b style={{ color: row.color }}>{row.level}</b>
              <em>{row.message}</em>
            </p>
          ))}
        </div>
      </div>
      {!active ? (
        <div className="command-progress-foot">
          {forceRetry ? <span>{props.t.forceRetryWarning}</span> : null}
          <div className="command-progress-actions">
            {forceRetry ? (
              <button className="danger-button compact" onClick={props.onForceRetryCommand} type="button">
                {forceRetry.kind === "update" ? props.t.forceUpdateAction : props.t.forceDeleteAction}
              </button>
            ) : null}
            <button className="secondary-button compact" onClick={props.onClose} type="button">
              {props.t.close}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function CommandPaletteDialog(props: {
  bindings: ShortcutBinding[];
  lang: Lang;
  onClose: () => void;
  onRun: (commandId: ShortcutCommandId) => void;
  platform: ShortcutPlatform;
  t: (typeof TEXT)[Lang];
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [props.onClose]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleBindings = props.bindings.filter((binding) => {
    if (!normalizedQuery) return true;
    return [
      binding.id,
      shortcutCommandLabel(binding, props.lang),
      binding.description[props.lang] ?? binding.description.en,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });

  return (
    <div
      className="modal-layer command-palette-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div aria-labelledby="command-palette-title" aria-modal="true" className="command-palette" role="dialog">
        <div className="command-palette-search">
          <Search size={16} />
          <input
            aria-label={props.t.commandPaletteSearch}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && visibleBindings[0]) props.onRun(visibleBindings[0].id);
            }}
            placeholder={props.t.commandPaletteSearch}
            ref={inputRef}
            value={query}
          />
        </div>
        <div className="command-palette-list">
          {visibleBindings.map((binding) => (
            <button key={binding.id} onClick={() => props.onRun(binding.id)} type="button">
              <span>
                <strong>{shortcutCommandLabel(binding, props.lang)}</strong>
                <small>{binding.description[props.lang] ?? binding.description.en}</small>
              </span>
              <kbd>{binding.accelerator ? formatShortcutForDisplay(binding.accelerator, props.platform) : props.t.shortcutUnset}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProjectSwitcherDialog(props: {
  activeProjectId: string;
  onClose: () => void;
  onSelect: (projectId: string) => void;
  projects: Project[];
  t: (typeof TEXT)[Lang];
}) {
  return (
    <div className="modal-layer">
      <div aria-labelledby="project-switcher-title" aria-modal="true" className="modal project-switcher" role="dialog">
        <div className="modal-head">
          <div>
            <h2 id="project-switcher-title">{props.t.switchProjectTitle}</h2>
            <p>{props.t.switchProjectSub}</p>
          </div>
          <IconButton label={props.t.close} onClick={props.onClose}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="project-switcher-list">
          {props.projects.map((project) => (
            <button className={project.id === props.activeProjectId ? "active" : ""} key={project.id} onClick={() => props.onSelect(project.id)} type="button">
              <Folder size={16} />
              <span>
                <strong>{project.name}</strong>
                <small>{project.path}</small>
              </span>
              {project.id === props.activeProjectId ? <Check size={15} /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
