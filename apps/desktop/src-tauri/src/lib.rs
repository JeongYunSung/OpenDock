use base64::{engine::general_purpose, Engine as _};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, Runtime};

const DEFAULT_REGISTRY_URL: &str = "https://registry.opendock.app";
const DEFAULT_CATALOG_PAGE_LIMIT: u32 = 12;
const MAX_CATALOG_PAGE_LIMIT: u32 = 60;
const DEFAULT_VERSION_PAGE_LIMIT: u32 = 6;
const MAX_VERSION_PAGE_LIMIT: u32 = 30;
const DEFAULT_ACCOUNT_PAGE_LIMIT: u32 = 6;
const MAX_ACCOUNT_PAGE_LIMIT: u32 = 60;
const MAX_REGISTRY_ASSET_BYTES: usize = 2 * 1024 * 1024;

#[derive(Default)]
struct RunningCommands(Mutex<HashMap<String, u32>>);

#[derive(Serialize)]
struct ProjectFolder {
    name: String,
    folder_name: String,
    path: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppProject {
    id: String,
    name: String,
    folder_name: String,
    path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAppState {
    projects: Vec<AppProject>,
    active_project_id: String,
}

#[derive(Serialize)]
struct OpenDockCommandResult {
    success: bool,
    code: Option<i32>,
    stdout: String,
    stderr: String,
    lines: Vec<OpenDockCommandLine>,
    json: Option<Value>,
}

#[derive(Clone, Serialize)]
struct OpenDockCommandLine {
    level: String,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenDockCommandProgress {
    command_id: Option<String>,
    current: Option<u64>,
    dock_id: Option<String>,
    level: String,
    message: String,
    operation: String,
    percent: f64,
    phase: String,
    total: Option<u64>,
    version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSession {
    logged_in: bool,
    email: Option<String>,
    provider: Option<String>,
    raw: OpenDockCommandResult,
}

#[derive(Serialize)]
struct ProjectStateResult {
    has_state: bool,
    project_path: String,
    lock_path: String,
    docks: Vec<InstalledDock>,
}

#[derive(Serialize, Deserialize, Clone)]
struct InstalledDock {
    id: String,
    name: Option<String>,
    requested: Option<String>,
    version: String,
    checksum: Option<String>,
    signature: Option<String>,
    platform: Option<String>,
    workdir: Option<String>,
    files: Option<Vec<AppliedFile>>,
}

#[derive(Serialize, Deserialize, Clone)]
struct AppliedFile {
    path: String,
    mode: Option<String>,
    checksum: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenDockListResult {
    success: bool,
    has_state: bool,
    project_path: String,
    lock_path: String,
    docks: Vec<InstalledDock>,
}

#[derive(Serialize)]
struct ShortcutFileResult {
    path: String,
    contents: String,
}

#[tauri::command]
fn pick_project_folder() -> Option<ProjectFolder> {
    let path = rfd::FileDialog::new()
        .set_title("Choose OpenDock project")
        .pick_folder()?;
    let folder_name = path.file_name()?.to_string_lossy().to_string();
    Some(ProjectFolder {
        name: folder_name.clone(),
        folder_name,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn create_blank_project(index: u32) -> Result<ProjectFolder, String> {
    let home = home_dir().ok_or_else(|| "home directory not found".to_string())?;
    let base = home.join("OpenDock Projects");
    fs::create_dir_all(&base).map_err(|error| format!("failed to create project root: {error}"))?;

    let normalized_index = index.max(1);
    let preferred = format!("empty-project-{normalized_index}");
    let path = unique_project_path(&base, &preferred);
    fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create project folder: {error}"))?;
    let folder_name = file_name(&path)?;
    Ok(ProjectFolder {
        name: format!("Empty Project {normalized_index}"),
        folder_name,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn opendock_load_app_state() -> Result<DesktopAppState, String> {
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
fn opendock_save_app_state(state: DesktopAppState) -> Result<(), String> {
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

#[tauri::command]
async fn opendock_install(
    app: tauri::AppHandle,
    project_dir: String,
    dock_ref: String,
    command_id: Option<String>,
) -> Result<OpenDockCommandResult, String> {
    validate_dock_ref(&dock_ref)?;
    run_opendock_streaming_blocking(
        app,
        Some(project_dir),
        vec!["install".to_string(), dock_ref, "--events".to_string()],
        command_id,
    )
    .await
}

#[tauri::command]
async fn opendock_update(
    app: tauri::AppHandle,
    project_dir: String,
    command_id: Option<String>,
    force: Option<bool>,
) -> Result<OpenDockCommandResult, String> {
    let args = if force.unwrap_or(false) {
        vec![
            "update".to_string(),
            "--events".to_string(),
            "--force".to_string(),
        ]
    } else {
        vec!["update".to_string(), "--events".to_string()]
    };
    run_opendock_streaming_blocking(app, Some(project_dir), args, command_id).await
}

#[tauri::command]
async fn opendock_outdated(project_dir: String) -> Result<OpenDockCommandResult, String> {
    run_opendock_blocking(
        Some(project_dir),
        vec!["outdated".to_string(), "--json".to_string()],
    )
    .await
}

#[tauri::command]
async fn opendock_uninstall(
    app: tauri::AppHandle,
    project_dir: String,
    dock_id: String,
    command_id: Option<String>,
    force: Option<bool>,
) -> Result<OpenDockCommandResult, String> {
    validate_dock_id(&dock_id)?;
    let mut args = vec!["uninstall".to_string(), dock_id, "--events".to_string()];
    if force.unwrap_or(false) {
        args.push("--force".to_string());
    }
    run_opendock_streaming_blocking(app, Some(project_dir), args, command_id).await
}

#[tauri::command]
async fn opendock_doctor(
    app: tauri::AppHandle,
    project_dir: String,
    command_id: Option<String>,
) -> Result<OpenDockCommandResult, String> {
    run_opendock_streaming_blocking(
        app,
        Some(project_dir),
        vec!["doctor".to_string()],
        command_id,
    )
    .await
}

#[tauri::command]
async fn opendock_log(project_dir: String) -> Result<OpenDockCommandResult, String> {
    run_opendock_blocking(Some(project_dir), vec!["log".to_string()]).await
}

#[tauri::command]
fn opendock_cancel_command(
    state: tauri::State<'_, RunningCommands>,
    command_id: String,
) -> Result<(), String> {
    let pid = {
        let mut commands = state
            .0
            .lock()
            .map_err(|_| "failed to lock running commands".to_string())?;
        commands
            .remove(&command_id)
            .ok_or_else(|| "running command was not found".to_string())?
    };
    terminate_process(pid)
}

#[tauri::command]
async fn opendock_auth_login(
    app: tauri::AppHandle,
    provider: String,
) -> Result<OpenDockCommandResult, String> {
    let provider = match provider.as_str() {
        "gmail" | "google" => "google",
        "github" => "github",
        _ => return Err("auth provider must be google or github".to_string()),
    };
    run_opendock_streaming_blocking(
        app,
        None,
        vec![
            "auth".to_string(),
            "login".to_string(),
            "--provider".to_string(),
            provider.to_string(),
        ],
        None,
    )
    .await
}

#[tauri::command]
async fn opendock_auth_status() -> Result<OpenDockCommandResult, String> {
    run_opendock_blocking(None, vec!["auth".to_string(), "status".to_string()]).await
}

#[tauri::command]
async fn opendock_auth_session() -> Result<AuthSession, String> {
    let raw = run_opendock_blocking(None, vec!["auth".to_string(), "status".to_string()]).await?;
    let email = parse_auth_email(&raw.stdout);
    Ok(AuthSession {
        logged_in: raw.success && email.is_some(),
        email,
        provider: None,
        raw,
    })
}

#[tauri::command]
async fn opendock_auth_logout() -> Result<OpenDockCommandResult, String> {
    run_opendock_blocking(None, vec!["auth".to_string(), "logout".to_string()]).await
}

#[tauri::command]
async fn opendock_catalog(
    sort: Option<String>,
    query: Option<String>,
    page: Option<u32>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let sort = match sort.as_deref().unwrap_or("downloads") {
        "downloads" | "stars" | "updated" | "name" => {
            sort.unwrap_or_else(|| "downloads".to_string())
        }
        "recent" => "updated".to_string(),
        _ => {
            return Err(
                "catalog sort must be downloads, stars, updated, recent, or name".to_string(),
            )
        }
    };
    let mut url = reqwest::Url::parse(&format!("{}/v1/docks", registry_base()))
        .map_err(|error| format!("invalid registry URL: {error}"))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("sort", &sort);
        pairs.append_pair("page", &bounded_page(page));
        pairs.append_pair(
            "limit",
            &bounded_limit(limit, DEFAULT_CATALOG_PAGE_LIMIT, MAX_CATALOG_PAGE_LIMIT),
        );
        if let Some(query) = query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            pairs.append_pair("query", query);
        }
    }
    request_registry_json(url).await
}

#[tauri::command]
async fn opendock_dock_detail(dock_id: String) -> Result<Value, String> {
    validate_dock_id(&dock_id)?;
    let url = reqwest::Url::parse(&format!("{}/v1/docks/{}", registry_base(), dock_id))
        .map_err(|error| format!("invalid registry URL: {error}"))?;
    request_registry_json(url).await
}

#[tauri::command]
async fn opendock_dock_versions(
    dock_id: String,
    page: Option<u32>,
    limit: Option<u32>,
) -> Result<Value, String> {
    validate_dock_id(&dock_id)?;
    let url = reqwest::Url::parse(&format!(
        "{}/v1/docks/{}/versions",
        registry_base(),
        dock_id
    ))
    .map_err(|error| format!("invalid registry URL: {error}"))?;
    let mut url = url;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("page", &bounded_page(page));
        pairs.append_pair(
            "limit",
            &bounded_limit(limit, DEFAULT_VERSION_PAGE_LIMIT, MAX_VERSION_PAGE_LIMIT),
        );
    }
    request_registry_json(url).await
}

#[tauri::command]
async fn opendock_star_status(ids: Vec<String>) -> Result<Value, String> {
    if ids.is_empty() {
        return Ok(serde_json::json!({ "items": [] }));
    }
    for id in &ids {
        validate_dock_id(id)?;
    }
    let token = load_auth_token()?;
    let mut url = reqwest::Url::parse(&format!("{}/v1/me/stars/status", registry_base()))
        .map_err(|error| format!("invalid registry URL: {error}"))?;
    {
        let mut pairs = url.query_pairs_mut();
        for id in ids {
            pairs.append_pair("ids", &id);
        }
    }
    request_registry_json_with_auth(Method::GET, url, &token).await
}

#[tauri::command]
async fn opendock_my_stars() -> Result<Value, String> {
    let token = load_auth_token()?;
    let url = reqwest::Url::parse(&format!("{}/v1/me/stars", registry_base()))
        .map_err(|error| format!("invalid registry URL: {error}"))?;
    request_registry_json_with_auth(Method::GET, url, &token).await
}

#[tauri::command]
async fn opendock_my_docks(page: Option<u32>, limit: Option<u32>) -> Result<Value, String> {
    let token = load_auth_token()?;
    let mut url = reqwest::Url::parse(&format!("{}/v1/me/docks", registry_base()))
        .map_err(|error| format!("invalid registry URL: {error}"))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("page", &bounded_page(page));
        pairs.append_pair(
            "limit",
            &bounded_limit(limit, DEFAULT_ACCOUNT_PAGE_LIMIT, MAX_ACCOUNT_PAGE_LIMIT),
        );
    }
    request_registry_json_with_auth(Method::GET, url, &token).await
}

#[tauri::command]
async fn opendock_star_dock(dock_id: String) -> Result<Value, String> {
    validate_dock_id(&dock_id)?;
    let token = load_auth_token()?;
    let url = reqwest::Url::parse(&format!("{}/v1/me/stars/{}", registry_base(), dock_id))
        .map_err(|error| format!("invalid registry URL: {error}"))?;
    request_registry_json_with_auth(Method::POST, url, &token).await
}

#[tauri::command]
async fn opendock_unstar_dock(dock_id: String) -> Result<Value, String> {
    validate_dock_id(&dock_id)?;
    let token = load_auth_token()?;
    let url = reqwest::Url::parse(&format!("{}/v1/me/stars/{}", registry_base(), dock_id))
        .map_err(|error| format!("invalid registry URL: {error}"))?;
    request_registry_json_with_auth(Method::DELETE, url, &token).await
}

#[tauri::command]
async fn opendock_registry_asset_data_url(url: String) -> Result<String, String> {
    let url = validate_registry_asset_url(&url)?;
    let response = reqwest::Client::new()
        .get(url.clone())
        .header(reqwest::header::ACCEPT, "image/*")
        .header(reqwest::header::CACHE_CONTROL, "no-cache, no-store")
        .header(reqwest::header::PRAGMA, "no-cache")
        .send()
        .await
        .map_err(|error| format!("failed to request registry asset: {error}"))?;
    registry_asset_response_to_data_url(response, &url).await
}

async fn registry_asset_response_to_data_url(
    mut response: reqwest::Response,
    url: &reqwest::Url,
) -> Result<String, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("registry asset returned {status} for {url}"));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| value.starts_with("image/"))
        .ok_or_else(|| "registry asset is not an image".to_string())?
        .to_string();

    if response
        .content_length()
        .is_some_and(|length| length > MAX_REGISTRY_ASSET_BYTES as u64)
    {
        return Err("registry asset is too large".to_string());
    }

    let mut bytes = Vec::with_capacity(response.content_length().unwrap_or(0) as usize);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("failed to read registry asset: {error}"))?
    {
        append_registry_asset_chunk(&mut bytes, &chunk)?;
    }

    Ok(format!(
        "data:{content_type};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

fn append_registry_asset_chunk(bytes: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    let remaining = MAX_REGISTRY_ASSET_BYTES.saturating_sub(bytes.len());
    if chunk.len() > remaining {
        return Err("registry asset is too large".to_string());
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}

#[tauri::command]
async fn opendock_project_state(project_dir: String) -> Result<ProjectStateResult, String> {
    let result = run_opendock_blocking(
        Some(project_dir),
        vec!["list".to_string(), "--json".to_string()],
    )
    .await?;
    if !result.success {
        return Err(command_failure_message(&result));
    }
    let json = result
        .json
        .ok_or_else(|| "opendock list did not return JSON".to_string())?;
    let list = serde_json::from_value::<OpenDockListResult>(json)
        .map_err(|error| format!("failed to parse opendock list JSON: {error}"))?;
    Ok(ProjectStateResult {
        has_state: list.has_state && list.success,
        project_path: list.project_path,
        lock_path: list.lock_path,
        docks: list.docks,
    })
}

#[tauri::command]
fn opendock_import_shortcuts() -> Result<Option<ShortcutFileResult>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("Import OpenDock shortcuts")
        .add_filter("JSON", &["json"])
        .pick_file()
    else {
        return Ok(None);
    };
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("failed to read shortcut file metadata: {error}"))?;
    if metadata.len() > 64 * 1024 {
        return Err("shortcut file is too large".to_string());
    }
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read shortcut file: {error}"))?;
    serde_json::from_str::<Value>(&contents)
        .map_err(|error| format!("shortcut file is not valid JSON: {error}"))?;
    Ok(Some(ShortcutFileResult {
        path: path.to_string_lossy().to_string(),
        contents,
    }))
}

#[tauri::command]
fn opendock_export_shortcuts(contents: String) -> Result<Option<String>, String> {
    if contents.len() > 64 * 1024 {
        return Err("shortcut file is too large".to_string());
    }
    serde_json::from_str::<Value>(&contents)
        .map_err(|error| format!("shortcut export is not valid JSON: {error}"))?;
    let Some(path) = rfd::FileDialog::new()
        .set_title("Export OpenDock shortcuts")
        .set_file_name("opendock-shortcuts.json")
        .add_filter("JSON", &["json"])
        .save_file()
    else {
        return Ok(None);
    };
    fs::write(&path, contents)
        .map_err(|error| format!("failed to write shortcut file: {error}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn open_project_folder(project_dir: String) -> Result<(), String> {
    let project_dir = canonical_project_dir(&project_dir)?;
    open_path(&project_dir)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    let allowed = [
        "https://opendock.app",
        "https://hub.opendock.app",
        "https://registry.opendock.app",
    ];
    if !allowed
        .iter()
        .any(|prefix| trimmed == *prefix || trimmed.starts_with(&format!("{prefix}/")))
    {
        return Err("external URL is not an OpenDock URL".to_string());
    }
    open_value(trimmed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RunningCommands::default())
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "app:quit" {
                app.exit(0);
                return;
            }
            let _ = app.emit("opendock-menu", id);
        })
        .invoke_handler(tauri::generate_handler![
            pick_project_folder,
            create_blank_project,
            opendock_load_app_state,
            opendock_save_app_state,
            opendock_install,
            opendock_update,
            opendock_outdated,
            opendock_uninstall,
            opendock_doctor,
            opendock_log,
            opendock_cancel_command,
            opendock_auth_login,
            opendock_auth_status,
            opendock_auth_session,
            opendock_auth_logout,
            opendock_catalog,
            opendock_dock_detail,
            opendock_dock_versions,
            opendock_star_status,
            opendock_my_stars,
            opendock_my_docks,
            opendock_star_dock,
            opendock_unstar_dock,
            opendock_registry_asset_data_url,
            opendock_project_state,
            opendock_import_shortcuts,
            opendock_export_shortcuts,
            open_project_folder,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenDock");
}

fn build_app_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let quit = MenuItem::with_id(app, "app:quit", "Quit OpenDock", true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(app, "OpenDock", true, &[&quit])?;

    let new_project =
        MenuItem::with_id(app, "file:new-project", "New Project", true, None::<&str>)?;
    let add_existing = MenuItem::with_id(
        app,
        "file:add-existing-project",
        "Add Existing Project",
        true,
        None::<&str>,
    )?;
    let file_menu = Submenu::with_items(app, "File", true, &[&new_project, &add_existing])?;

    let rename_project = MenuItem::with_id(
        app,
        "edit:rename-project",
        "Rename Project",
        true,
        None::<&str>,
    )?;
    let copy_project_path = MenuItem::with_id(
        app,
        "edit:copy-project-path",
        "Copy Project Path",
        true,
        Some("CmdOrCtrl+Shift+C"),
    )?;
    let import_shortcuts = MenuItem::with_id(
        app,
        "edit:import-shortcuts",
        "Import Shortcuts...",
        true,
        None::<&str>,
    )?;
    let export_shortcuts = MenuItem::with_id(
        app,
        "edit:export-shortcuts",
        "Export Shortcuts...",
        true,
        None::<&str>,
    )?;
    let edit_sep = PredefinedMenuItem::separator(app)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &rename_project,
            &copy_project_path,
            &import_shortcuts,
            &export_shortcuts,
            &edit_sep,
            &select_all,
        ],
    )?;

    let explore_docks =
        MenuItem::with_id(app, "view:explore", "Explore Docks", true, None::<&str>)?;
    let installed_docks =
        MenuItem::with_id(app, "view:installed", "Installed Docks", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "view:logs", "Logs", true, None::<&str>)?;
    let toggle_sidebar = MenuItem::with_id(
        app,
        "view:toggle-sidebar",
        "Toggle Sidebar",
        true,
        Some("CmdOrCtrl+B"),
    )?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&explore_docks, &installed_docks, &logs, &toggle_sidebar],
    )?;

    let run_doctor = MenuItem::with_id(
        app,
        "project:run-doctor",
        "Run Doctor",
        true,
        Some("CmdOrCtrl+D"),
    )?;
    let update_docks = MenuItem::with_id(
        app,
        "project:update-docks",
        "Update Docks",
        true,
        None::<&str>,
    )?;
    let open_folder = MenuItem::with_id(
        app,
        "project:open-folder",
        "Open Project Folder",
        true,
        None::<&str>,
    )?;
    let reveal_folder = MenuItem::with_id(
        app,
        "project:reveal-folder",
        "Reveal in Finder / Explorer",
        true,
        None::<&str>,
    )?;
    let remove_project = MenuItem::with_id(
        app,
        "project:remove-from-opendock",
        "Remove from OpenDock",
        true,
        None::<&str>,
    )?;
    let project_menu = Submenu::with_items(
        app,
        "Project",
        true,
        &[
            &run_doctor,
            &update_docks,
            &open_folder,
            &reveal_folder,
            &remove_project,
        ],
    )?;

    let install_dock = MenuItem::with_id(app, "dock:install", "Install Dock", true, None::<&str>)?;
    let delete_dock = MenuItem::with_id(app, "dock:delete", "Delete Dock", true, None::<&str>)?;
    let refresh_registry = MenuItem::with_id(
        app,
        "dock:refresh-registry",
        "Refresh Registry",
        true,
        None::<&str>,
    )?;
    let open_dock_detail = MenuItem::with_id(
        app,
        "dock:open-detail",
        "Open Dock Detail",
        true,
        None::<&str>,
    )?;
    let dock_menu = Submenu::with_items(
        app,
        "Dock",
        true,
        &[
            &install_dock,
            &delete_dock,
            &refresh_registry,
            &open_dock_detail,
        ],
    )?;

    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let zoom = PredefinedMenuItem::maximize(app, None)?;
    let reload_window = MenuItem::with_id(
        app,
        "window:reload",
        "Reload Window",
        true,
        Some("CmdOrCtrl+Shift+R"),
    )?;
    let window_menu =
        Submenu::with_items(app, "Window", true, &[&minimize, &zoom, &reload_window])?;

    let docs = MenuItem::with_id(app, "help:docs", "OpenDock Docs", true, None::<&str>)?;
    let cli_commands = MenuItem::with_id(
        app,
        "help:cli-commands",
        "View CLI Commands",
        true,
        None::<&str>,
    )?;
    let troubleshooting = MenuItem::with_id(
        app,
        "help:troubleshooting",
        "Troubleshooting",
        true,
        None::<&str>,
    )?;
    let help_menu =
        Submenu::with_items(app, "Help", true, &[&docs, &cli_commands, &troubleshooting])?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &project_menu,
            &dock_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

async fn request_registry_json(url: reqwest::Url) -> Result<Value, String> {
    let response = reqwest::Client::new()
        .get(url.clone())
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CACHE_CONTROL, "no-cache, no-store")
        .header(reqwest::header::PRAGMA, "no-cache")
        .send()
        .await
        .map_err(|error| format!("failed to request registry: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let detail = text.trim();
        if detail.is_empty() {
            return Err(format!("registry returned {status} for {url}"));
        }
        return Err(format!("registry returned {status} for {url}: {detail}"));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("failed to parse registry response: {error}"))
}

async fn request_registry_json_with_auth(
    method: Method,
    url: reqwest::Url,
    token: &str,
) -> Result<Value, String> {
    let response = reqwest::Client::new()
        .request(method, url.clone())
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CACHE_CONTROL, "no-cache, no-store")
        .header(reqwest::header::PRAGMA, "no-cache")
        .send()
        .await
        .map_err(|error| format!("failed to request registry: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let detail = text.trim();
        if detail.is_empty() {
            return Err(format!("registry returned {status} for {url}"));
        }
        return Err(format!("registry returned {status} for {url}: {detail}"));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("failed to parse registry response: {error}"))
}

fn registry_base() -> String {
    env::var("OPENDOCK_REGISTRY_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_REGISTRY_URL.to_string())
}

fn bounded_page(page: Option<u32>) -> String {
    page.unwrap_or(1).max(1).to_string()
}

fn bounded_limit(limit: Option<u32>, default_limit: u32, max_limit: u32) -> String {
    limit
        .unwrap_or(default_limit)
        .clamp(1, max_limit)
        .to_string()
}

fn load_auth_token() -> Result<String, String> {
    let path = auth_token_path()?;
    let token = fs::read_to_string(&path)
        .map_err(|_| "OpenDock auth token was not found. Run opendock auth login.".to_string())?
        .trim()
        .to_string();
    if token.is_empty() {
        return Err("OpenDock auth token is empty. Run opendock auth login.".to_string());
    }
    Ok(token)
}

fn auth_token_path() -> Result<PathBuf, String> {
    Ok(cli_data_dir()?.join("auth-token"))
}

fn cli_data_dir() -> Result<PathBuf, String> {
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

fn validate_registry_asset_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value.trim())
        .map_err(|error| format!("invalid registry asset URL: {error}"))?;
    let registry = reqwest::Url::parse(&registry_base())
        .map_err(|error| format!("invalid registry URL: {error}"))?;
    let same_origin = url.scheme() == registry.scheme()
        && url.host_str() == registry.host_str()
        && url.port_or_known_default() == registry.port_or_known_default();
    if !same_origin {
        return Err("registry asset URL must use the configured registry origin".to_string());
    }
    let path = url.path();
    if !path.starts_with("/v1/docks/") || !path.ends_with("/logo") {
        return Err("registry asset URL must point to a dock logo".to_string());
    }
    Ok(url)
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

fn parse_auth_email(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .find_map(|line| line.trim().strip_prefix("Logged in as "))
        .map(|value| value.trim().trim_end_matches('.').to_string())
        .filter(|value| value.contains('@'))
}

async fn run_opendock_blocking(
    project_dir: Option<String>,
    args: Vec<String>,
) -> Result<OpenDockCommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        run_opendock(project_dir.as_deref(), &arg_refs)
    })
    .await
    .map_err(|error| format!("opendock background task failed: {error}"))?
}

async fn run_opendock_streaming_blocking(
    app: tauri::AppHandle,
    project_dir: Option<String>,
    args: Vec<String>,
    command_id: Option<String>,
) -> Result<OpenDockCommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        run_opendock_streaming(
            &app,
            project_dir.as_deref(),
            &arg_refs,
            command_id.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("opendock background task failed: {error}"))?
}

fn run_opendock(project_dir: Option<&str>, args: &[&str]) -> Result<OpenDockCommandResult, String> {
    let cwd = match project_dir {
        Some(dir) => Some(canonical_project_dir(dir)?),
        None => None,
    };
    let output = command_for_opendock()
        .args(args)
        .env("NO_COLOR", "1")
        .current_dir(
            cwd.as_ref()
                .unwrap_or(&env::current_dir().map_err(|error| error.to_string())?),
        )
        .output()
        .map_err(|error| format!("failed to run opendock: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = output.status.success();
    Ok(OpenDockCommandResult {
        success,
        code: output.status.code(),
        json: parse_command_json(&stdout),
        lines: command_lines(&stdout, &stderr, success),
        stdout,
        stderr,
    })
}

fn command_failure_message(result: &OpenDockCommandResult) -> String {
    let detail = result
        .stderr
        .trim()
        .lines()
        .next()
        .or_else(|| result.stdout.trim().lines().next())
        .unwrap_or("opendock command failed");
    match result.code {
        Some(code) => format!("{detail} (exit {code})"),
        None => detail.to_string(),
    }
}

fn run_opendock_streaming(
    app: &tauri::AppHandle,
    project_dir: Option<&str>,
    args: &[&str],
    command_id: Option<&str>,
) -> Result<OpenDockCommandResult, String> {
    let cwd = match project_dir {
        Some(dir) => Some(canonical_project_dir(dir)?),
        None => None,
    };
    let fallback_cwd = env::current_dir().map_err(|error| error.to_string())?;
    let mut command = command_for_opendock();
    command
        .args(args)
        .env("NO_COLOR", "1")
        .current_dir(cwd.as_ref().unwrap_or(&fallback_cwd))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to run opendock: {error}"))?;
    if let Some(command_id) = command_id {
        register_running_command(app, command_id, child.id())?;
    }

    let lines = Arc::new(Mutex::new(Vec::<OpenDockCommandLine>::new()));
    let stdout_text = Arc::new(Mutex::new(String::new()));
    let stderr_text = Arc::new(Mutex::new(String::new()));
    let command_id_owned = command_id.map(str::to_string);

    let stdout_thread = child.stdout.take().map(|stdout| {
        spawn_command_reader(
            app.clone(),
            stdout,
            false,
            Arc::clone(&lines),
            Arc::clone(&stdout_text),
            command_id_owned.clone(),
        )
    });
    let stderr_thread = child.stderr.take().map(|stderr| {
        spawn_command_reader(
            app.clone(),
            stderr,
            true,
            Arc::clone(&lines),
            Arc::clone(&stderr_text),
            command_id_owned.clone(),
        )
    });

    let status = child
        .wait()
        .map_err(|error| format!("failed to wait for opendock: {error}"))?;
    if let Some(command_id) = command_id {
        unregister_running_command(app, command_id);
    }

    if let Some(handle) = stdout_thread {
        let _ = handle.join();
    }
    if let Some(handle) = stderr_thread {
        let _ = handle.join();
    }

    let success = status.success();
    let stdout = stdout_text
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let stderr = stderr_text
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let mut collected_lines = lines.lock().map(|value| value.clone()).unwrap_or_default();
    let json = parse_command_json(&stdout);

    if collected_lines.is_empty() && should_emit_empty_stream_message(success, json.as_ref()) {
        let payload = OpenDockCommandLine {
            level: if success { "OK" } else { "ERR" }.to_string(),
            message: empty_stream_message(success),
        };
        collected_lines.push(payload.clone());
        let _ = app.emit("opendock-command-line", payload);
    }

    Ok(OpenDockCommandResult {
        success,
        code: status.code(),
        json,
        stdout,
        stderr,
        lines: collected_lines,
    })
}

fn spawn_command_reader<R: Read + Send + 'static>(
    app: tauri::AppHandle,
    reader: R,
    is_stderr: bool,
    lines: Arc<Mutex<Vec<OpenDockCommandLine>>>,
    text: Arc<Mutex<String>>,
    command_id: Option<String>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(mut buffer) = text.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
            }
            if line.trim().is_empty() {
                continue;
            }
            if !is_stderr {
                if let Some(payload) = command_progress_from_event_line(&line, command_id.clone()) {
                    let _ = app.emit("opendock-command-progress", payload);
                    continue;
                }
            }
            if !is_stderr && is_command_json_line(&line) {
                continue;
            }
            let payload = OpenDockCommandLine {
                level: if is_stderr {
                    "ERR".to_string()
                } else {
                    infer_level(&line, true).to_string()
                },
                message: line,
            };
            if let Ok(mut current_lines) = lines.lock() {
                current_lines.push(payload.clone());
            }
            let _ = app.emit("opendock-command-line", payload);
        }
    })
}

fn register_running_command(
    app: &tauri::AppHandle,
    command_id: &str,
    pid: u32,
) -> Result<(), String> {
    let state = app.state::<RunningCommands>();
    let mut commands = state
        .0
        .lock()
        .map_err(|_| "failed to lock running commands".to_string())?;
    commands.insert(command_id.to_string(), pid);
    Ok(())
}

fn unregister_running_command(app: &tauri::AppHandle, command_id: &str) {
    if let Ok(mut commands) = app.state::<RunningCommands>().0.lock() {
        commands.remove(command_id);
    }
}

fn terminate_process(pid: u32) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        let status = command_without_window("taskkill")
            .args(["/pid", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|error| format!("failed to cancel command: {error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!(
            "failed to cancel command: taskkill exited with {status}"
        ));
    }

    let status = command_without_window("kill")
        .args(["-TERM", &pid.to_string()])
        .status()
        .map_err(|error| format!("failed to cancel command: {error}"))?;
    if status.success() {
        return Ok(());
    }
    Err(format!(
        "failed to cancel command: kill exited with {status}"
    ))
}

fn command_for_opendock() -> Command {
    if let Ok(path) = env::var("OPENDOCK_CLI_PATH") {
        if !path.trim().is_empty() {
            return command_without_window(path);
        }
    }

    for candidate in sidecar_cli_candidates() {
        if candidate.is_file() {
            return command_without_window(candidate);
        }
    }

    for candidate in local_cli_candidates() {
        if candidate.is_file() {
            return command_without_window(candidate);
        }
    }

    command_without_window("opendock")
}

fn open_path(path: &Path) -> Result<(), String> {
    open_value(&path.to_string_lossy())
}

fn open_value(value: &str) -> Result<(), String> {
    let status = if cfg!(target_os = "macos") {
        command_without_window("/usr/bin/open").arg(value).status()
    } else if cfg!(target_os = "windows") {
        command_without_window("explorer").arg(value).status()
    } else {
        command_without_window("xdg-open").arg(value).status()
    }
    .map_err(|error| format!("failed to open target: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("open command exited with {status}"))
    }
}

fn command_without_window<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    apply_no_console_window(&mut command);
    command
}

#[cfg(target_os = "windows")]
fn apply_no_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_no_console_window(_command: &mut Command) {}

fn sidecar_cli_candidates() -> Vec<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = Vec::new();
    for name in sidecar_file_names() {
        candidates.push(manifest_dir.join("binaries").join(&name));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(bin_dir) = exe.parent() {
            for name in sidecar_file_names() {
                candidates.push(bin_dir.join(&name));
                candidates.push(bin_dir.join("resources").join(&name));
            }
            if let Some(contents_dir) = bin_dir.parent() {
                for name in sidecar_file_names() {
                    candidates.push(contents_dir.join("Resources").join(&name));
                }
            }
        }
    }

    candidates
}

fn local_cli_candidates() -> Vec<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf);
    let mut candidates = Vec::new();
    if let Some(repo_root) = repo_root {
        candidates.push(
            repo_root
                .join("packages")
                .join("cli")
                .join("bin")
                .join("opendock"),
        );
    }
    candidates
}

fn sidecar_file_names() -> Vec<String> {
    vec![
        sidecar_target_name(),
        "opendock".to_string(),
        "opendock.exe".to_string(),
    ]
}

fn sidecar_target_name() -> String {
    format!("opendock-{}", sidecar_target_suffix())
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn sidecar_target_suffix() -> &'static str {
    "aarch64-apple-darwin"
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn sidecar_target_suffix() -> &'static str {
    "x86_64-apple-darwin"
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn sidecar_target_suffix() -> &'static str {
    "x86_64-pc-windows-msvc.exe"
}

#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
fn sidecar_target_suffix() -> &'static str {
    "aarch64-pc-windows-msvc.exe"
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn sidecar_target_suffix() -> &'static str {
    "x86_64-unknown-linux-gnu"
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn sidecar_target_suffix() -> &'static str {
    "aarch64-unknown-linux-gnu"
}

fn canonical_project_dir(project_dir: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(project_dir);
    if !path.is_absolute() {
        return Err("project path must be absolute".to_string());
    }
    let canonical = fs::canonicalize(&path)
        .map_err(|error| format!("failed to resolve project path: {error}"))?;
    if !canonical.is_dir() {
        return Err("project path must be a directory".to_string());
    }
    Ok(canonical)
}

fn validate_dock_ref(value: &str) -> Result<(), String> {
    let (dock_id, version) = value
        .split_once('@')
        .ok_or_else(|| "dock reference must use owner/name@version".to_string())?;
    validate_dock_id(dock_id)?;
    if version.is_empty() || version == "latest" || !version.chars().all(is_version_char) {
        return Err("dock reference must use an exact version".to_string());
    }
    Ok(())
}

fn validate_dock_id(value: &str) -> Result<(), String> {
    let mut parts = value.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || owner.is_empty()
        || name.is_empty()
        || !owner.chars().all(is_dock_name_char)
        || !name.chars().all(is_dock_name_char)
    {
        return Err("dock id must be owner/name".to_string());
    }
    Ok(())
}

fn is_dock_name_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '-' || value == '_'
}

fn is_version_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '.' || value == '-' || value == '_' || value == '+'
}

fn command_lines(stdout: &str, stderr: &str, success: bool) -> Vec<OpenDockCommandLine> {
    let mut lines = Vec::new();
    for line in stdout
        .lines()
        .filter(|line| !line.trim().is_empty() && !is_command_json_line(line))
    {
        lines.push(OpenDockCommandLine {
            level: infer_level(line, success).to_string(),
            message: line.to_string(),
        });
    }
    for line in stderr.lines().filter(|line| !line.trim().is_empty()) {
        lines.push(OpenDockCommandLine {
            level: "ERR".to_string(),
            message: line.to_string(),
        });
    }
    if lines.is_empty() {
        lines.push(OpenDockCommandLine {
            level: if success { "OK" } else { "ERR" }.to_string(),
            message: if success {
                "opendock command completed".to_string()
            } else {
                "opendock command failed".to_string()
            },
        });
    }
    lines
}

fn parse_command_json(stdout: &str) -> Option<Value> {
    stdout.lines().rev().find_map(|line| {
        serde_json::from_str::<Value>(line.trim())
            .ok()
            .and_then(|value| command_json_from_value(&value))
    })
}

fn is_command_json_line(line: &str) -> bool {
    serde_json::from_str::<Value>(line.trim())
        .ok()
        .as_ref()
        .is_some_and(|value| command_json_from_value(value).is_some() || is_opendock_event(value))
}

fn command_json_from_value(value: &Value) -> Option<Value> {
    if is_command_json_value(value) {
        return Some(value.clone());
    }
    if !is_opendock_event(value) || value.get("type").and_then(Value::as_str) != Some("result") {
        return None;
    }
    value
        .get("result")
        .filter(|result| is_command_json_value(result))
        .cloned()
}

fn is_command_json_value(value: &Value) -> bool {
    value.get("reports").is_some()
        && (value.get("operation").is_some() || value.get("updatesAvailable").is_some())
}

fn is_opendock_event(value: &Value) -> bool {
    value.get("opendock").and_then(Value::as_u64) == Some(1)
        && value.get("type").and_then(Value::as_str).is_some()
}

fn command_progress_from_event_line(
    line: &str,
    command_id: Option<String>,
) -> Option<OpenDockCommandProgress> {
    let value = serde_json::from_str::<Value>(line.trim()).ok()?;
    if !is_opendock_event(&value) || value.get("type").and_then(Value::as_str) != Some("progress") {
        return None;
    }
    Some(OpenDockCommandProgress {
        command_id,
        current: value.get("current").and_then(Value::as_u64),
        dock_id: value
            .get("dockId")
            .and_then(Value::as_str)
            .map(str::to_string),
        level: value
            .get("level")
            .and_then(Value::as_str)
            .unwrap_or("RUN")
            .to_string(),
        message: value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("opendock command running")
            .to_string(),
        operation: value
            .get("operation")
            .and_then(Value::as_str)
            .unwrap_or("opendock")
            .to_string(),
        percent: value.get("percent").and_then(Value::as_f64).unwrap_or(0.0),
        phase: value
            .get("phase")
            .and_then(Value::as_str)
            .unwrap_or("progress")
            .to_string(),
        total: value.get("total").and_then(Value::as_u64),
        version: value
            .get("version")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn should_emit_empty_stream_message(success: bool, json: Option<&Value>) -> bool {
    !success || json.is_none()
}

fn empty_stream_message(success: bool) -> String {
    if success {
        "opendock command completed".to_string()
    } else {
        "opendock command failed".to_string()
    }
}

fn infer_level(line: &str, success: bool) -> &'static str {
    let lower = line.to_ascii_lowercase();
    if lower.contains("error") || lower.contains("failed") || !success {
        "ERR"
    } else if lower.contains("warning") || lower.contains("warn") || lower.contains("not logged") {
        "WARN"
    } else if lower.contains("running") || lower.starts_with("run ") {
        "RUN"
    } else if lower.contains("installed")
        || lower.contains("updated")
        || lower.contains("uninstalled")
        || lower.contains("logged")
        || lower.contains("success")
    {
        "OK"
    } else {
        "INFO"
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

fn unique_project_path(base: &Path, preferred: &str) -> PathBuf {
    let candidate = base.join(preferred);
    if !candidate.exists() {
        return candidate;
    }
    for index in 2..1000 {
        let candidate = base.join(format!("{preferred} {index}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    base.join(format!("{preferred} {}", chrono_free_timestamp()))
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::net::TcpListener;

    #[test]
    fn successful_json_result_does_not_emit_empty_stream_message() {
        let value = json!({
            "operation": "update",
            "reports": [],
            "summary": {
                "created": [],
                "deleted": [],
                "reviewRequired": [],
                "unchanged": [],
                "updated": []
            },
            "success": true
        });

        assert!(!should_emit_empty_stream_message(true, Some(&value)));
    }

    #[test]
    fn empty_stream_without_json_keeps_generic_success_message() {
        assert!(should_emit_empty_stream_message(true, None));
        assert_eq!(empty_stream_message(true), "opendock command completed");
    }

    #[test]
    fn empty_stream_failure_keeps_error_message() {
        assert!(should_emit_empty_stream_message(false, None));
        assert_eq!(empty_stream_message(false), "opendock command failed");
    }

    #[test]
    fn parses_json_result_from_events_stream() {
        let stdout = r#"{"opendock":1,"type":"progress","operation":"update","phase":"prepare","message":"Preparing update","percent":8,"level":"RUN"}
{"opendock":1,"type":"result","operation":"update","success":true,"result":{"operation":"update","reports":[],"summary":{"created":[],"deleted":[],"reviewRequired":[],"unchanged":[],"updated":[]},"success":true}}"#;

        let value = parse_command_json(stdout).expect("event result JSON");

        assert_eq!(
            value.get("operation").and_then(Value::as_str),
            Some("update")
        );
        assert_eq!(value.get("success").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn parses_progress_event_payload() {
        let line = r#"{"opendock":1,"type":"progress","operation":"install","phase":"apply","message":"Applying test/designer","percent":62,"level":"RUN","dockId":"test/designer","version":"1.0.0"}"#;

        let progress =
            command_progress_from_event_line(line, Some("cmd-1".to_string())).expect("progress");

        assert_eq!(progress.command_id.as_deref(), Some("cmd-1"));
        assert_eq!(progress.dock_id.as_deref(), Some("test/designer"));
        assert_eq!(progress.percent, 62.0);
    }

    #[test]
    fn registry_asset_chunk_limit_rejects_before_extending_buffer() {
        let mut bytes = vec![0; MAX_REGISTRY_ASSET_BYTES];

        let error = append_registry_asset_chunk(&mut bytes, &[1]).expect_err("oversized chunk");

        assert_eq!(error, "registry asset is too large");
        assert_eq!(bytes.len(), MAX_REGISTRY_ASSET_BYTES);
    }

    #[test]
    fn registry_asset_response_rejects_oversized_content_length_before_body_read() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            MAX_REGISTRY_ASSET_BYTES + 1
        );
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut request = [0; 1024];
            let _ = std::io::Read::read(&mut stream, &mut request);
            std::io::Write::write_all(&mut stream, response.as_bytes())
                .expect("write response headers");
        });
        let url = reqwest::Url::parse(&format!("http://{address}/v1/docks/test/logo"))
            .expect("test logo URL");

        let result = tauri::async_runtime::block_on(async {
            let response = reqwest::Client::new()
                .get(url.clone())
                .send()
                .await
                .expect("registry asset response");
            registry_asset_response_to_data_url(response, &url).await
        });

        server.join().expect("server thread");
        assert_eq!(
            result.expect_err("oversized asset"),
            "registry asset is too large"
        );
    }
}
