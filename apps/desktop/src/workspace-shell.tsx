import { ChevronLeft, ChevronRight, Folder, FolderOpen, Github, Pencil, Plus, X } from "lucide-react";
import type { Dock, DockVersion, Lang, Project, TEXT } from "./data";
import { IconButton, logoSrc, formatDateLabel, platformLabel, versionStatusLabel } from "./display";
import { GoogleMark, Meta } from "./desktop-ui";

export function SignInScreen(props: {
  authMessage: string;
  authWorking: boolean;
  onGmail: () => void;
  onGitHub: () => void;
  t: (typeof TEXT)[Lang];
}) {
  return (
    <section className="center-stage">
      <div className="signin-card">
        <img alt="OpenDock logo" src={logoSrc} />
        <div className="kicker">{props.t.memberSignIn}</div>
        <h1>{props.t.signInTitle}</h1>
        <p>{props.t.signInSub}</p>
        {props.authMessage ? <p className="signin-status">{props.authMessage}</p> : null}
        <div className="signin-actions">
          <button disabled={props.authWorking} onClick={props.onGmail} type="button">
            <GoogleMark /> {props.t.continueGmail}
          </button>
          <button disabled={props.authWorking} onClick={props.onGitHub} type="button">
            <Github size={19} /> {props.t.continueGitHub}
          </button>
        </div>
      </div>
    </section>
  );
}

export function ProjectEmpty(props: { onAddExisting: () => void; onCreate: () => void; t: (typeof TEXT)[Lang] }) {
  return (
    <section className="project-empty">
      <div>
        <div className="kicker">{props.t.noProjectKicker}</div>
        <h2>{props.t.noProjectTitle}</h2>
      </div>
      <div className="project-choice-grid">
        <button className="project-choice primary" onClick={props.onCreate} type="button">
          <span>
            <Plus size={21} />
          </span>
          <strong>{props.t.createProjectAction}</strong>
          <small>{props.t.createProjectSub}</small>
        </button>
        <button className="project-choice" onClick={props.onAddExisting} type="button">
          <span>
            <FolderOpen size={21} />
          </span>
          <strong>{props.t.continueWithoutProjectAction}</strong>
          <small>{props.t.continueWithoutProjectSub}</small>
        </button>
      </div>
    </section>
  );
}

export function ProjectLoading(props: { t: (typeof TEXT)[Lang] }) {
  return (
    <section className="project-empty project-loading">
      <div>
        <div className="kicker">OpenDock</div>
        <h2>{props.t.loadingWorkspace}</h2>
      </div>
    </section>
  );
}

export function ProjectSidebar(props: {
  activeProject: Project;
  collapsed: boolean;
  detail: Dock | null;
  detailTab: "readme" | "versions";
  detailVersion: DockVersion | null;
  detailView: boolean;
  onOpenAdd: () => void;
  onRemove: (project: Project) => void;
  onRename: (project: Project) => void;
  onSelect: (projectId: string) => void;
  onToggle: () => void;
  projects: Project[];
  t: (typeof TEXT)[Lang];
}) {
  if (props.collapsed) {
    return (
      <aside className="project-sidebar collapsed">
        <IconButton label={props.t.expandProjects} onClick={props.onToggle}>
          <ChevronRight size={13} />
        </IconButton>
      </aside>
    );
  }

  return (
    <aside className="project-sidebar">
      <div className="project-sidebar-top">
        <div className="project-sidebar-head">
          <div>
            <IconButton label={props.t.collapseProjects} onClick={props.onToggle}>
              <ChevronLeft size={13} />
            </IconButton>
            <span>{props.t.projects}</span>
          </div>
          <IconButton label={props.t.addProjectTitle} onClick={props.onOpenAdd}>
            <Plus size={13} />
          </IconButton>
        </div>
        <div className="project-list">
          {props.projects.map((project) => {
            const active = project.id === props.activeProject.id;
            return (
              <div className={`project-row ${active ? "active" : ""}`} key={project.id}>
                <button onClick={() => props.onSelect(project.id)} type="button">
                  <Folder size={16} />
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.folderName}</small>
                  </span>
                </button>
                <IconButton label={props.t.renameProjectTitle} onClick={() => props.onRename(project)}>
                  <Pencil size={13} />
                </IconButton>
                <IconButton className="danger" label={props.t.deleteProjectTitle} onClick={() => props.onRemove(project)}>
                  <X size={13} />
                </IconButton>
              </div>
            );
          })}
        </div>
      </div>
      {props.detailView && props.detail ? (
        <DetailSidebar detail={props.detail} detailTab={props.detailTab} detailVersion={props.detailVersion} t={props.t} />
      ) : null}
    </aside>
  );
}

function DetailSidebar(props: { detail: Dock; detailTab: "readme" | "versions"; detailVersion: DockVersion | null; t: (typeof TEXT)[Lang] }) {
  const version = props.detailVersion;
  return (
    <div className="detail-sidebar">
      {props.detailTab === "readme" ? (
        <>
          <h4>{props.t.packageDetails}</h4>
          <Meta label={props.t.latestRelease} value={props.detail.version} />
          <Meta label={props.t.downloads} value={props.detail.downloadLabel} />
          <Meta label={props.t.stars} value={String(props.detail.stars ?? 0)} />
          <Meta label={props.t.updated} value={formatDateLabel(props.detail.updatedAt)} />
          <Meta label={props.t.publisher} value={props.detail.publisher ?? props.detail.owner ?? "opendock"} />
          <h4>{props.t.tags}</h4>
          <div className="tag-wrap">{props.detail.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <h4>{props.t.supportedPlatforms}</h4>
          <div className="tag-wrap">
            {(props.detail.platforms?.length ? props.detail.platforms : ["macos", "windows"]).map((platform) => (
              <span key={platform}>{platformLabel(platform)}</span>
            ))}
          </div>
        </>
      ) : (
        <>
          <h4>{props.t.versions}</h4>
          <Meta label={props.t.version} value={version?.version ?? props.detail.version} />
          <Meta label="Archive" value={version?.size ?? props.detail.size} />
          <Meta label="Checksum" value={version?.checksum ?? props.detail.checksum} />
          <Meta label={props.t.status} value={versionStatusLabel(version?.status)} />
          <Meta label={props.t.downloads} value={version?.downloadCount == null ? props.detail.downloadLabel : String(version.downloadCount)} />
          <Meta label={props.t.updated} value={formatDateLabel(version?.publishedAt ?? props.detail.updatedAt)} />
        </>
      )}
    </div>
  );
}
