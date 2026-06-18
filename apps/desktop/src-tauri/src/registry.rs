use base64::{engine::general_purpose, Engine as _};
use serde_json::Value;
use std::env;
use std::fs;
use std::path::PathBuf;

pub(crate) const DEFAULT_CATALOG_PAGE_LIMIT: u32 = 12;
pub(crate) const MAX_CATALOG_PAGE_LIMIT: u32 = 60;
pub(crate) const DEFAULT_VERSION_PAGE_LIMIT: u32 = 6;
pub(crate) const MAX_VERSION_PAGE_LIMIT: u32 = 30;
pub(crate) const DEFAULT_ACCOUNT_PAGE_LIMIT: u32 = 6;
pub(crate) const MAX_ACCOUNT_PAGE_LIMIT: u32 = 60;

const DEFAULT_REGISTRY_URL: &str = "https://registry.opendock.app";
const MAX_REGISTRY_ASSET_BYTES: usize = 2 * 1024 * 1024;

pub(crate) async fn request_registry_json(url: reqwest::Url) -> Result<Value, String> {
    let response = reqwest::Client::new()
        .get(url.clone())
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CACHE_CONTROL, "no-cache, no-store")
        .header(reqwest::header::PRAGMA, "no-cache")
        .send()
        .await
        .map_err(|error| format!("failed to request registry: {error}"))?;
    parse_registry_json_response(response, &url).await
}

pub(crate) async fn request_registry_json_with_auth(
    method: reqwest::Method,
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
    parse_registry_json_response(response, &url).await
}

async fn parse_registry_json_response(
    response: reqwest::Response,
    url: &reqwest::Url,
) -> Result<Value, String> {
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

pub(crate) fn registry_base() -> String {
    env::var("OPENDOCK_REGISTRY_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_REGISTRY_URL.to_string())
}

pub(crate) fn bounded_page(page: Option<u32>) -> String {
    page.unwrap_or(1).max(1).to_string()
}

pub(crate) fn bounded_limit(limit: Option<u32>, default_limit: u32, max_limit: u32) -> String {
    limit
        .unwrap_or(default_limit)
        .clamp(1, max_limit)
        .to_string()
}

pub(crate) fn load_auth_token() -> Result<String, String> {
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

pub(crate) async fn registry_asset_data_url(value: &str) -> Result<String, String> {
    let url = validate_registry_asset_url(value)?;
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

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

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
