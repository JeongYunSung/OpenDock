use serde::{Deserialize, Serialize};
use std::env;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[cfg(target_os = "windows")]
use crate::opendock_runner::terminate_all_running_commands;

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/JeongYunSung/OpenDockReleases/releases/latest";
const PUBLIC_RELEASE_LATEST_URL: &str =
    "https://github.com/JeongYunSung/OpenDockReleases/releases/latest";

#[derive(Deserialize)]
struct GitHubRelease {
    html_url: String,
    name: Option<String>,
    published_at: Option<String>,
    tag_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProductUpdateCheck {
    auto_update_available: bool,
    current_version: String,
    latest_version: String,
    name: Option<String>,
    published_at: Option<String>,
    release_url: String,
    update_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProductUpdateInstallResult {
    latest_version: String,
    restart_requested: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductUpdateProgress {
    content_length: Option<u64>,
    downloaded_bytes: u64,
    latest_version: String,
    phase: &'static str,
}

pub(crate) async fn check_product_update(app: AppHandle) -> Result<ProductUpdateCheck, String> {
    match check_tauri_update(&app).await {
        Ok(Some(update)) => Ok(update),
        Ok(None) => check_github_product_update().await,
        Err(updater_error) => match check_github_product_update().await {
            Ok(update) => Ok(update),
            Err(github_error) => Err(format!("{updater_error}; {github_error}")),
        },
    }
}

pub(crate) async fn install_product_update(
    app: AppHandle,
) -> Result<ProductUpdateInstallResult, String> {
    let updater = app
        .updater()
        .map_err(|error| format!("failed to prepare OpenDock updater: {error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("failed to check OpenDock updater metadata: {error}"))?
        .ok_or_else(|| "OpenDock is already up to date".to_string())?;

    let latest_version = update.version.clone();
    let _ = app.emit(
        "opendock-product-update-progress",
        ProductUpdateProgress {
            content_length: None,
            downloaded_bytes: 0,
            latest_version: latest_version.clone(),
            phase: "starting",
        },
    );

    stop_running_commands_before_update(&app)?;

    let mut downloaded_bytes = 0_u64;
    let progress_app = app.clone();
    let progress_version = latest_version.clone();
    let finish_app = app.clone();
    let finish_cleanup_app = app.clone();
    let finish_version = latest_version.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                downloaded_bytes = downloaded_bytes.saturating_add(chunk_length as u64);
                let _ = progress_app.emit(
                    "opendock-product-update-progress",
                    ProductUpdateProgress {
                        content_length,
                        downloaded_bytes,
                        latest_version: progress_version.clone(),
                        phase: "downloading",
                    },
                );
            },
            move || {
                let _ = finish_app.emit(
                    "opendock-product-update-progress",
                    ProductUpdateProgress {
                        content_length: None,
                        downloaded_bytes: 0,
                        latest_version: finish_version.clone(),
                        phase: "installing",
                    },
                );
                let _ = stop_running_commands_before_update(&finish_cleanup_app);
            },
        )
        .await
        .map_err(|error| format!("failed to install OpenDock update: {error}"))?;

    let _ = app.emit(
        "opendock-product-update-progress",
        ProductUpdateProgress {
            content_length: None,
            downloaded_bytes: 0,
            latest_version: latest_version.clone(),
            phase: "restarting",
        },
    );
    app.restart();
}

#[cfg(target_os = "windows")]
fn stop_running_commands_before_update(app: &AppHandle) -> Result<(), String> {
    terminate_all_running_commands(app)
}

#[cfg(not(target_os = "windows"))]
fn stop_running_commands_before_update(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

async fn check_tauri_update(app: &AppHandle) -> Result<Option<ProductUpdateCheck>, String> {
    let updater = app
        .updater()
        .map_err(|error| format!("failed to prepare OpenDock updater: {error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("failed to check OpenDock updater metadata: {error}"))?;
    Ok(update.map(|update| ProductUpdateCheck {
        auto_update_available: true,
        current_version: normalize_release_version(&update.current_version),
        latest_version: normalize_release_version(&update.version),
        name: Some(format!("OpenDock {}", update.version)),
        published_at: update.date.map(|date| date.to_string()),
        release_url: PUBLIC_RELEASE_LATEST_URL.to_string(),
        update_available: true,
    }))
}

async fn check_github_product_update() -> Result<ProductUpdateCheck, String> {
    let client = reqwest::Client::builder()
        .user_agent(format!("OpenDock/{CURRENT_VERSION}"))
        .build()
        .map_err(|error| format!("failed to create GitHub client: {error}"))?;
    let mut request = client
        .get(GITHUB_LATEST_RELEASE_URL)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = github_token() {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("failed to check latest OpenDock release: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("failed to check latest OpenDock release: {status}"));
    }
    let release = response
        .json::<GitHubRelease>()
        .await
        .map_err(|error| format!("failed to parse latest OpenDock release: {error}"))?;
    let current_version = normalize_release_version(CURRENT_VERSION);
    let latest_version = normalize_release_version(&release.tag_name);
    Ok(ProductUpdateCheck {
        auto_update_available: false,
        update_available: is_version_newer(&latest_version, &current_version),
        current_version,
        latest_version,
        name: release.name,
        published_at: release.published_at,
        release_url: release.html_url,
    })
}

fn normalize_release_version(value: &str) -> String {
    value
        .trim()
        .trim_start_matches(|ch| ch == 'v' || ch == 'V')
        .to_string()
}

fn is_version_newer(candidate: &str, current: &str) -> bool {
    match compare_version_identifiers(candidate, current) {
        Some(ordering) => ordering.is_gt(),
        None => normalize_release_version(candidate) != normalize_release_version(current),
    }
}

fn compare_version_identifiers(left: &str, right: &str) -> Option<std::cmp::Ordering> {
    let left_parts = parse_version_parts(left)?;
    let right_parts = parse_version_parts(right)?;
    Some(left_parts.cmp(&right_parts))
}

fn parse_version_parts(value: &str) -> Option<[u64; 3]> {
    let normalized = normalize_release_version(value);
    let version = normalized
        .split_once(|ch| ch == '-' || ch == '+')
        .map_or(normalized.as_str(), |(prefix, _)| prefix);
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some([major, minor, patch])
}

fn github_token() -> Option<String> {
    ["OPENDOCK_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"]
        .iter()
        .find_map(|key| env::var(key).ok())
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
}

#[cfg(test)]
mod tests {
    use super::{compare_version_identifiers, is_version_newer, normalize_release_version};

    #[test]
    fn compares_release_versions() {
        assert_eq!(normalize_release_version("v0.1.34"), "0.1.34");
        assert!(is_version_newer("0.1.35", "0.1.34"));
        assert!(is_version_newer("0.2.0", "0.1.99"));
        assert!(!is_version_newer("0.1.34", "0.1.34"));
        assert_eq!(
            compare_version_identifiers("0.1.33", "0.1.34"),
            Some(std::cmp::Ordering::Less)
        );
        assert_eq!(compare_version_identifiers("build-a", "0.1.34"), None);
    }
}
