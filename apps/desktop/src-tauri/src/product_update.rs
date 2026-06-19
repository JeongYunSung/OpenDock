use serde::{Deserialize, Serialize};
use std::env;

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/JeongYunSung/OpenDock/releases/latest";

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
    current_version: String,
    latest_version: String,
    name: Option<String>,
    published_at: Option<String>,
    release_url: String,
    update_available: bool,
}

pub(crate) async fn check_product_update() -> Result<ProductUpdateCheck, String> {
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
