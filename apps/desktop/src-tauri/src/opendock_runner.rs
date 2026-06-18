use serde::Serialize;
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

use crate::command_output::{
    command_lines, command_progress_from_event_line, empty_stream_message, infer_level,
    is_command_json_line, parse_command_json, should_emit_empty_stream_message,
    OpenDockCommandLine,
};

#[derive(Default)]
pub(crate) struct RunningCommands(pub(crate) Mutex<HashMap<String, u32>>);

#[derive(Serialize)]
pub(crate) struct OpenDockCommandResult {
    pub(crate) success: bool,
    pub(crate) code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) lines: Vec<OpenDockCommandLine>,
    pub(crate) json: Option<Value>,
}

pub(crate) async fn run_opendock_blocking(
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

pub(crate) async fn run_opendock_streaming_blocking(
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

pub(crate) fn command_failure_message(result: &OpenDockCommandResult) -> String {
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

pub(crate) fn terminate_process(pid: u32) -> Result<(), String> {
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

pub(crate) fn open_path(path: &Path) -> Result<(), String> {
    open_value(&path.to_string_lossy())
}

pub(crate) fn open_value(value: &str) -> Result<(), String> {
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

pub(crate) fn canonical_project_dir(project_dir: &str) -> Result<PathBuf, String> {
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

pub(crate) fn validate_dock_ref(value: &str) -> Result<(), String> {
    let (dock_id, version) = value
        .split_once('@')
        .ok_or_else(|| "dock reference must use owner/name@version".to_string())?;
    validate_dock_id(dock_id)?;
    if version.is_empty() || version == "latest" || !version.chars().all(is_version_char) {
        return Err("dock reference must use an exact version".to_string());
    }
    Ok(())
}

pub(crate) fn validate_dock_id(value: &str) -> Result<(), String> {
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

fn is_dock_name_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '-' || value == '_'
}

fn is_version_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '.' || value == '-' || value == '_' || value == '+'
}
