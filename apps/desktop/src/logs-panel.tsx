import { Copy } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AppLog, Lang, Project, TEXT } from "./data";

export function LogsPanel(props: { activeProject: Project; logs: AppLog[]; t: (typeof TEXT)[Lang] }) {
  const tailRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: "end" });
  }, [props.logs.length]);

  async function copyLogs() {
    const logText = props.logs.map((log) => `${log.time}\t${log.level}\t${log.message}`).join("\n");
    await navigator.clipboard.writeText(logText);
  }

  return (
    <div className="panel logs-panel">
      <h1>{props.t.logsTitle}</h1>
      <p>{props.t.logsSub}</p>
      <div className="log-shell">
        <div className="log-head">
          <div className="log-head-main">
            <strong>{props.activeProject.name}</strong>
            <code>{props.t.liveTail}</code>
          </div>
          <button
            aria-label={props.t.copyLogs}
            className="icon-button log-copy-button"
            disabled={props.logs.length === 0}
            onClick={() => void copyLogs().catch(() => undefined)}
            title={props.t.copyLogs}
            type="button"
          >
            <Copy size={14} />
          </button>
        </div>
        <div aria-live="polite" className="log-lines">
          {props.logs.map((log, index) => (
            <div className="log-line" key={`${log.time}-${log.message}-${index}`}>
              <span>{log.time}</span>
              <strong style={{ color: log.color }}>{log.level}</strong>
              <p>{log.message}</p>
            </div>
          ))}
          <span aria-hidden="true" className="log-tail-anchor" ref={tailRef} />
        </div>
      </div>
    </div>
  );
}
