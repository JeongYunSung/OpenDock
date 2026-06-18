use serde::Serialize;
use serde_json::Value;
use std::fs;

#[derive(Serialize)]
pub(crate) struct ShortcutFileResult {
    path: String,
    contents: String,
}

#[tauri::command]
pub(crate) fn opendock_import_shortcuts() -> Result<Option<ShortcutFileResult>, String> {
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
pub(crate) fn opendock_export_shortcuts(contents: String) -> Result<Option<String>, String> {
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
