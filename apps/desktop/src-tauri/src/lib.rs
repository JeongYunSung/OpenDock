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
use tauri::{Emitter, Manager};

mod app_menu;
mod command_output;
mod project_state;
mod registry;

use app_menu::build_app_menu;
use command_output::{
    command_lines, command_progress_from_event_line, empty_stream_message, infer_level,
    is_command_json_line, parse_command_json, should_emit_empty_stream_message,
    OpenDockCommandLine,
};
use registry::{
    bounded_limit, bounded_page, load_auth_token, registry_asset_data_url, registry_base,
    request_registry_json, request_registry_json_with_auth, DEFAULT_ACCOUNT_PAGE_LIMIT,
    DEFAULT_CATALOG_PAGE_LIMIT, DEFAULT_VERSION_PAGE_LIMIT, MAX_ACCOUNT_PAGE_LIMIT,
    MAX_CATALOG_PAGE_LIMIT, MAX_VERSION_PAGE_LIMIT,
};

#[derive(Default)]
struct RunningCommands(Mutex<HashMap<String, u32>>);

#[derive(Serialize)]
struct OpenDockCommandResult {
    success: bool,
    code: Option<i32>,
    stdout: String,
    stderr: String,
    lines: Vec<OpenDockCommandLine>,
    json: Option<Value>,
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

    if collected_lines.is_empty() && should_emit_empty_stream_message(&stdout, &stderr) {
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
