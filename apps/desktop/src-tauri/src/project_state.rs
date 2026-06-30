use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub(crate) struct ProjectFolder {
    name: String,
    folder_name: String,
    path: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppProject {
    id: String,
    name: String,
    folder_name: String,
    path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAppState {
    projects: Vec<AppProject>,
    active_project_id: String,
}

#[tauri::command]
pub(crate) fn pick_project_folder() -> Option<ProjectFolder> {
    let path = rfd::FileDialog::new()
        .set_title("Choose OpenDock workspace")
        .pick_folder()?;
    let folder_name = path.file_name()?.to_string_lossy().to_string();
    Some(ProjectFolder {
        name: folder_name.clone(),
        folder_name,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub(crate) fn create_blank_project(index: u32) -> Result<ProjectFolder, String> {
    let base = default_workspace_root()?;
    fs::create_dir_all(&base)
        .map_err(|error| format!("failed to create workspace root: {error}"))?;

    let normalized_index = index.max(1);
    let preferred = if normalized_index == 1 {
        "untitled-workspace".to_string()
    } else {
        format!("untitled-workspace-{normalized_index}")
    };
    let path = unique_project_path(&base, &preferred);
    fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create workspace folder: {error}"))?;
    let folder_name = file_name(&path)?;
    Ok(ProjectFolder {
        name: workspace_display_name(normalized_index),
        folder_name,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub(crate) fn opendock_load_app_state() -> Result<DesktopAppState, String> {
    let path = app_state_path()?;
    if !path.exists() {
        return Ok(DesktopAppState {
            projects: Vec::new(),
            active_project_id: String::new(),
        });
    }
    let raw =
        fs::read_to_string(&path).map_err(|error| format!("failed to read app state: {error}"))?;
    let state = serde_json::from_str::<DesktopAppState>(&raw)
        .map_err(|error| format!("failed to parse app state: {error}"))?;
    let projects = sanitize_projects(state.projects);
    Ok(DesktopAppState {
        active_project_id: resolve_active_project_id(&projects, &state.active_project_id),
        projects,
    })
}

#[tauri::command]
pub(crate) fn opendock_save_app_state(state: DesktopAppState) -> Result<(), String> {
    let path = app_state_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create app state dir: {error}"))?;
    }
    let projects = sanitize_projects(state.projects);
    let sanitized = DesktopAppState {
        active_project_id: resolve_active_project_id(&projects, &state.active_project_id),
        projects,
    };
    let raw = serde_json::to_string_pretty(&sanitized)
        .map_err(|error| format!("failed to encode app state: {error}"))?;
    fs::write(&path, raw).map_err(|error| format!("failed to write app state: {error}"))
}

fn app_state_path() -> Result<PathBuf, String> {
    let data_dir = app_data_dir()?;
    Ok(data_dir.join("state.json"))
}

fn app_data_dir() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("OPENDOCK_APP_DATA_DIR") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    if cfg!(target_os = "windows") {
        if let Some(appdata) = env::var_os("APPDATA") {
            return Ok(PathBuf::from(appdata).join("OpenDock"));
        }
    }

    let home = home_dir().ok_or_else(|| "home directory not found".to_string())?;
    if cfg!(target_os = "macos") {
        Ok(home
            .join("Library")
            .join("Application Support")
            .join("OpenDock"))
    } else {
        Ok(home.join(".local").join("share").join("OpenDock"))
    }
}

fn sanitize_projects(projects: Vec<AppProject>) -> Vec<AppProject> {
    let mut sanitized = Vec::new();
    for project in projects {
        if project.id.trim().is_empty()
            || project.name.trim().is_empty()
            || project.path.trim().is_empty()
        {
            continue;
        }
        if sanitized
            .iter()
            .any(|existing: &AppProject| existing.id == project.id || existing.path == project.path)
        {
            continue;
        }
        sanitized.push(project);
    }
    sanitized
}

fn resolve_active_project_id(projects: &[AppProject], active_project_id: &str) -> String {
    if projects
        .iter()
        .any(|project| project.id == active_project_id)
    {
        return active_project_id.to_string();
    }
    projects
        .first()
        .map(|project| project.id.clone())
        .unwrap_or_default()
}

fn home_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        return env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(PathBuf::from));
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

fn default_workspace_root() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "home directory not found".to_string())?;
    Ok(home.join("Documents").join("OpenDock"))
}

fn workspace_display_name(index: u32) -> String {
    if index == 1 {
        "Untitled Workspace".to_string()
    } else {
        format!("Untitled Workspace {index}")
    }
}

fn unique_project_path(base: &Path, preferred: &str) -> PathBuf {
    let candidate = base.join(preferred);
    if !candidate.exists() {
        return candidate;
    }
    for index in 2..1000 {
        let candidate = base.join(format!("{preferred}-{index}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    base.join(format!("{preferred}-{}", chrono_free_timestamp()))
}

fn chrono_free_timestamp() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_secs().to_string(),
        Err(_) => "0".to_string(),
    }
}

fn file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| "folder name not found".to_string())
}
