import { FolderOpen, Plus, X } from "lucide-react";
import type { FormEvent } from "react";
import { type Lang, TEXT } from "./data";
import { IconButton } from "./display";

export function ProjectAddModal(props: {
  onAddExisting: () => void;
  onClose: () => void;
  onCreate: () => void;
  t: (typeof TEXT)[Lang];
}) {
  return (
    <div className="modal-layer">
      <div className="modal">
        <div className="modal-head">
          <div>
            <h2>{props.t.addProjectTitle}</h2>
            <p>{props.t.addProjectSub}</p>
          </div>
          <IconButton label={props.t.close} onClick={props.onClose}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="modal-options">
          <button className="project-option primary" onClick={props.onCreate} type="button">
            <span>
              <Plus size={19} />
            </span>
            <strong>{props.t.newProjectAction}</strong>
            <small>{props.t.newProjectSub}</small>
          </button>
          <button className="project-option" onClick={props.onAddExisting} type="button">
            <span>
              <FolderOpen size={19} />
            </span>
            <strong>{props.t.existingProjectAction}</strong>
            <small>{props.t.existingProjectSub}</small>
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectRenameModal(props: {
  name: string;
  onChange: (name: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  t: (typeof TEXT)[Lang];
}) {
  return (
    <div className="modal-layer">
      <form className="modal rename-modal" onSubmit={props.onSubmit}>
        <div className="modal-head">
          <div>
            <h2>{props.t.renameProjectTitle}</h2>
            <p>{props.t.renameProjectSub}</p>
          </div>
        </div>
        <div className="rename-body">
          <input aria-label={props.t.projectNameLabel} onChange={(event) => props.onChange(event.target.value)} value={props.name} />
          <div>
            <button onClick={props.onClose} type="button">
              {props.t.cancel}
            </button>
            <button type="submit">{props.t.save}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function ProjectDeleteModal(props: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  t: (typeof TEXT)[Lang];
}) {
  return (
    <div className="modal-layer">
      <div aria-labelledby="project-delete-title" aria-modal="true" className="modal delete-modal" role="alertdialog">
        <div className="modal-head">
          <div>
            <h2 id="project-delete-title">{props.t.deleteProjectConfirmTitle}</h2>
            <p>{props.t.deleteProjectConfirmSub}</p>
          </div>
        </div>
        <div className="delete-body">
          <div className="delete-project-name">{props.name}</div>
          <div className="delete-actions">
            <button onClick={props.onCancel} type="button">
              {props.t.cancel}
            </button>
            <button className="danger-button" onClick={props.onConfirm} type="button">
              {props.t.deleteAction}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
