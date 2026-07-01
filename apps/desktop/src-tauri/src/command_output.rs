use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenDockCommandLine {
    pub(crate) command_id: Option<String>,
    pub(crate) level: String,
    pub(crate) message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenDockCommandProgress {
    pub(crate) command_id: Option<String>,
    pub(crate) current: Option<u64>,
    pub(crate) dock_id: Option<String>,
    pub(crate) level: String,
    pub(crate) message: String,
    pub(crate) operation: String,
    pub(crate) percent: f64,
    pub(crate) phase: String,
    pub(crate) total: Option<u64>,
    pub(crate) version: Option<String>,
}

pub(crate) fn command_lines(stdout: &str, stderr: &str, success: bool) -> Vec<OpenDockCommandLine> {
    let mut lines = Vec::new();
    for line in stdout
        .lines()
        .filter(|line| !line.trim().is_empty() && !is_command_json_line(line))
    {
        lines.push(OpenDockCommandLine {
            command_id: None,
            level: infer_level(line, success).to_string(),
            message: line.to_string(),
        });
    }
    for line in stderr.lines().filter(|line| !line.trim().is_empty()) {
        lines.push(OpenDockCommandLine {
            command_id: None,
            level: "ERR".to_string(),
            message: line.to_string(),
        });
    }
    if lines.is_empty() {
        lines.push(OpenDockCommandLine {
            command_id: None,
            level: if success { "OK" } else { "ERR" }.to_string(),
            message: empty_stream_message(success),
        });
    }
    lines
}

pub(crate) fn parse_command_json(stdout: &str) -> Option<Value> {
    stdout.lines().rev().find_map(|line| {
        serde_json::from_str::<Value>(line.trim())
            .ok()
            .and_then(|value| command_json_from_value(&value))
    })
}

pub(crate) fn is_command_json_line(line: &str) -> bool {
    serde_json::from_str::<Value>(line.trim())
        .ok()
        .as_ref()
        .is_some_and(|value| command_json_from_value(value).is_some() || is_opendock_event(value))
}

pub(crate) fn command_progress_from_event_line(
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

pub(crate) fn should_emit_empty_stream_message(stdout: &str, stderr: &str) -> bool {
    stdout.trim().is_empty() && stderr.trim().is_empty()
}

pub(crate) fn empty_stream_message(success: bool) -> String {
    if success {
        "opendock command completed".to_string()
    } else {
        "opendock command failed".to_string()
    }
}

pub(crate) fn infer_level(line: &str, success: bool) -> &'static str {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_stream_result_does_not_emit_empty_stream_message() {
        let stdout = r#"{"opendock":1,"type":"progress","operation":"install","phase":"error","message":"OpenDock Registry signature verification failed","percent":100,"level":"ERR"}
{"opendock":1,"type":"result","operation":"install","success":false,"result":{"operation":"install","reports":[],"summary":{"created":[],"deleted":[],"reviewRequired":[],"unchanged":[],"updated":[]},"success":false,"message":"OpenDock Registry signature verification failed"}}"#;

        assert!(!should_emit_empty_stream_message(stdout, ""));
    }

    #[test]
    fn empty_stream_keeps_generic_success_message() {
        assert!(should_emit_empty_stream_message("", ""));
        assert_eq!(empty_stream_message(true), "opendock command completed");
    }

    #[test]
    fn empty_stream_failure_keeps_error_message() {
        assert!(should_emit_empty_stream_message("", ""));
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
}
