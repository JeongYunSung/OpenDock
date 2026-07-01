import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Star } from "lucide-react";
import type { ReactNode } from "react";
import { dockFullId, type Dock, type Lang, TEXT } from "./data";

export function StatRow(props: { label: string; value: number }) {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

export function Meta(props: { label: string; value: string }) {
  return (
    <div className="meta-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

export function Pagination(props: {
  label: string;
  onPageChange: (page: number) => void;
  page: number;
  pageCount: number;
  t: (typeof TEXT)[Lang];
}) {
  const pageCount = Math.max(1, props.pageCount);
  const page = Math.min(Math.max(1, props.page), pageCount);
  const canPrevious = page > 1;
  const canNext = page < pageCount;
  const pageLabel = props.t.pageCount
    .replace("{page}", String(page))
    .replace("{pages}", String(pageCount));
  return (
    <nav aria-label={props.label} className="pagination">
      <button aria-label={props.t.firstPage} disabled={!canPrevious} onClick={() => props.onPageChange(1)} type="button">
        <ChevronsLeft size={13} />
      </button>
      <button aria-label={props.t.previousPage} disabled={!canPrevious} onClick={() => props.onPageChange(page - 1)} type="button">
        <ChevronLeft size={13} />
      </button>
      <span>{pageLabel}</span>
      <button aria-label={props.t.nextPage} disabled={!canNext} onClick={() => props.onPageChange(page + 1)} type="button">
        <ChevronRight size={13} />
      </button>
      <button aria-label={props.t.lastPage} disabled={!canNext} onClick={() => props.onPageChange(pageCount)} type="button">
        <ChevronsRight size={13} />
      </button>
    </nav>
  );
}

export function PanelLoadingState(props: { label: string }) {
  return (
    <div aria-live="polite" className="panel-loading" role="status">
      <span aria-hidden="true" className="button-spinner" />
      <strong>{props.label}</strong>
    </div>
  );
}

export function SkeletonBlock(props: { className?: string }) {
  return <span aria-hidden="true" className={["skeleton-block", props.className].filter(Boolean).join(" ")} />;
}

export function SkeletonSpinner(props: { className?: string }) {
  return <span aria-hidden="true" className={["button-spinner", "skeleton-spinner", props.className].filter(Boolean).join(" ")} />;
}

export function GoogleMark() {
  return (
    <svg aria-hidden="true" height="20" viewBox="0 0 48 48" width="20">
      <path d="M24 9.5c3.4 0 6.4 1.17 8.78 3.47l6.56-6.56C35.37 2.7 30.2.5 24 .5 14.63.5 6.56 5.88 2.63 13.7l7.63 5.92C12.07 13.65 17.6 9.5 24 9.5z" fill="#EA4335" />
      <path d="M46.5 24.5c0-1.57-.14-3.08-.4-4.5H24v8.52h12.64c-.55 2.95-2.2 5.45-4.68 7.13l7.24 5.61c4.23-3.9 7.3-9.65 7.3-16.76z" fill="#4285F4" />
      <path d="M10.26 28.38A14.55 14.55 0 019.5 24c0-1.52.26-3 .76-4.38L2.63 13.7A23.46 23.46 0 00.5 24c0 3.7.89 7.2 2.47 10.3l7.29-5.92z" fill="#FBBC05" />
      <path d="M24 47.5c6.2 0 11.4-2.04 15.2-6.24l-7.24-5.61c-2 1.34-4.57 2.13-7.96 2.13-6.4 0-11.93-4.15-13.74-10l-7.29 5.92C6.91 42.12 14.87 47.5 24 47.5z" fill="#34A853" />
    </svg>
  );
}

export function DockMetric(props: { count: string | number; icon: ReactNode; label: string }) {
  return (
    <span aria-label={`${props.count} ${props.label}`} className="dock-metric" title={`${props.count} ${props.label}`}>
      {props.icon}
      <span>{props.count}</span>
    </span>
  );
}

export function StarButton(props: {
  busy?: boolean;
  count: number;
  dock: Dock;
  onToggle: (dock: Dock) => void;
  starred: boolean;
  t: (typeof TEXT)[Lang];
}) {
  const label = `${props.starred ? props.t.unstarAction : props.t.starAction}: ${dockFullId(props.dock)}`;
  return (
    <button
      aria-label={label}
      className={`star-button ${props.starred ? "starred" : ""}`}
      disabled={props.busy}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onToggle(props.dock);
      }}
      title={label}
      type="button"
    >
      <Star fill={props.starred ? "currentColor" : "none"} size={13} />
      <span>{props.count}</span>
    </button>
  );
}
