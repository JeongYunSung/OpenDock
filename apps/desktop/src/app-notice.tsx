import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

export type AppNoticeKind = "info" | "success" | "warning";

export interface AppNoticeState {
  id: number;
  kind: AppNoticeKind;
  message: string;
}

export function AppNotice(props: {
  closeLabel: string;
  notice: AppNoticeState;
  onClose: () => void;
}) {
  const Icon = props.notice.kind === "success" ? CheckCircle2 : props.notice.kind === "warning" ? AlertTriangle : Info;

  return (
    <div aria-live="polite" className={`app-notice app-notice-${props.notice.kind}`} role="status">
      <Icon aria-hidden="true" size={17} />
      <span>{props.notice.message}</span>
      <button aria-label={props.closeLabel} onClick={props.onClose} type="button">
        <X size={14} />
      </button>
    </div>
  );
}
