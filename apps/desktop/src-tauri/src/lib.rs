use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Emitter;

mod app_menu;
mod command_output;
mod opendock_runner;
mod product_update;
mod project_state;
mod registry;
mod shortcut_files;

use app_menu::build_app_menu;
use opendock_runner::{
    canonical_project_dir, command_failure_message, open_path, open_value, run_opendock_blocking,
    run_opendock_streaming_blocking, terminate_process, validate_dock_id, validate_dock_ref,
    OpenDockCommandResult, RunningCommands,
};
use product_update::{check_product_update, ProductUpdateCheck};
use registry::{
    bounded_limit, bounded_page, load_auth_token, registry_asset_data_url, registry_base,
    request_registry_json, request_registry_json_with_auth, DEFAULT_ACCOUNT_PAGE_LIMIT,
    DEFAULT_CATALOG_PAGE_LIMIT, DEFAULT_VERSION_PAGE_LIMIT, MAX_ACCOUNT_PAGE_LIMIT,
    MAX_CATALOG_PAGE_LIMIT, MAX_VERSION_PAGE_LIMIT,
};

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
async fn opendock_app_update_check() -> Result<ProductUpdateCheck, String> {
    check_product_update().await
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
    registry_asset_data_url(&url).await
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
        "https://github.com/JeongYunSung/OpenDock/releases",
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
            project_state::pick_project_folder,
            project_state::create_blank_project,
            project_state::opendock_load_app_state,
            project_state::opendock_save_app_state,
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
            opendock_app_update_check,
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
            shortcut_files::opendock_import_shortcuts,
            shortcut_files::opendock_export_shortcuts,
            open_project_folder,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenDock");
}

fn parse_auth_email(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .find_map(|line| line.trim().strip_prefix("Logged in as "))
        .map(|value| value.trim().trim_end_matches('.').to_string())
        .filter(|value| value.contains('@'))
}
