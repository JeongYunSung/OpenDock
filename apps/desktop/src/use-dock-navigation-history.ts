import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { DockView, Project } from "./data";

type DetailTab = "readme" | "versions";

interface DockNavigationHistoryOptions {
  activeProjectId: string;
  detailId: string;
  detailTab: DetailTab;
  detailVersion: string;
  dockView: DockView;
  enabled: boolean;
  projects: Project[];
  setActiveProjectId: Dispatch<SetStateAction<string>>;
  setDetailId: Dispatch<SetStateAction<string>>;
  setDetailTab: Dispatch<SetStateAction<DetailTab>>;
  setDetailVersion: Dispatch<SetStateAction<string>>;
  setDockView: Dispatch<SetStateAction<DockView>>;
}

interface DockNavigationSnapshot {
  detailId: string;
  detailTab: DetailTab;
  detailVersion: string;
  projectId: string;
  view: DockView;
}

interface DockNavigationHistoryState extends DockNavigationSnapshot {
  __opendockNavigation: "v1";
  index: number;
}

const HISTORY_MARKER = "v1";
const DETAIL_TABS = new Set<DetailTab>(["readme", "versions"]);
const DOCK_VIEWS = new Set<DockView>(["list", "detail", "installed", "logs", "account"]);

export function useDockNavigationHistory(options: DockNavigationHistoryOptions) {
  const initializedRef = useRef(false);
  const currentIndexRef = useRef(0);
  const lastSnapshotRef = useRef("");
  const optionsRef = useRef(options);
  const replaceNextSnapshotRef = useRef(false);
  optionsRef.current = options;

  const goBack = useCallback((fallback: () => void) => {
    if (typeof window === "undefined" || currentIndexRef.current <= 0) {
      replaceNextSnapshotRef.current = true;
      fallback();
      return;
    }
    window.history.back();
  }, []);

  const replaceNextSnapshot = useCallback(() => {
    replaceNextSnapshotRef.current = true;
  }, []);

  useEffect(() => {
    if (!options.enabled || typeof window === "undefined") return;

    const handlePopState = (event: PopStateEvent) => {
      const state = parseHistoryState(event.state);
      if (!state) return;
      const snapshot = normalizeSnapshot(state);
      currentIndexRef.current = state.index;
      lastSnapshotRef.current = serializeSnapshot(snapshot);
      applySnapshot(snapshot, optionsRef.current);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [options.enabled]);

  useEffect(() => {
    if (!options.enabled || typeof window === "undefined") return;

    const snapshot = normalizeSnapshot(currentSnapshot(options));
    const serialized = serializeSnapshot(snapshot);
    if (!initializedRef.current) {
      const state = buildHistoryState(snapshot, 0);
      window.history.replaceState(state, "");
      initializedRef.current = true;
      currentIndexRef.current = 0;
      lastSnapshotRef.current = serialized;
      return;
    }
    if (serialized === lastSnapshotRef.current) return;

    if (replaceNextSnapshotRef.current) {
      window.history.replaceState(buildHistoryState(snapshot, currentIndexRef.current), "");
      replaceNextSnapshotRef.current = false;
      lastSnapshotRef.current = serialized;
      return;
    }

    const nextIndex = currentIndexRef.current + 1;
    window.history.pushState(buildHistoryState(snapshot, nextIndex), "");
    currentIndexRef.current = nextIndex;
    lastSnapshotRef.current = serialized;
  }, [
    options.activeProjectId,
    options.detailId,
    options.detailTab,
    options.detailVersion,
    options.dockView,
    options.enabled,
  ]);

  return { goBack, replaceNextSnapshot };
}

function currentSnapshot(options: DockNavigationHistoryOptions): DockNavigationSnapshot {
  return {
    detailId: options.detailId,
    detailTab: options.detailTab,
    detailVersion: options.detailVersion,
    projectId: options.activeProjectId,
    view: options.dockView,
  };
}

function buildHistoryState(snapshot: DockNavigationSnapshot, index: number): DockNavigationHistoryState {
  return {
    __opendockNavigation: HISTORY_MARKER,
    index,
    ...snapshot,
  };
}

function parseHistoryState(value: unknown): DockNavigationHistoryState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<DockNavigationHistoryState>;
  if (state.__opendockNavigation !== HISTORY_MARKER || typeof state.index !== "number") return null;
  return state as DockNavigationHistoryState;
}

function normalizeSnapshot(snapshot: DockNavigationSnapshot): DockNavigationSnapshot {
  const view = DOCK_VIEWS.has(snapshot.view) ? snapshot.view : "list";
  const detailTab = DETAIL_TABS.has(snapshot.detailTab) ? snapshot.detailTab : "readme";
  return {
    detailId: typeof snapshot.detailId === "string" ? snapshot.detailId : "",
    detailTab,
    detailVersion: typeof snapshot.detailVersion === "string" ? snapshot.detailVersion : "",
    projectId: typeof snapshot.projectId === "string" ? snapshot.projectId : "",
    view: view === "detail" && !snapshot.detailId ? "list" : view,
  };
}

function serializeSnapshot(snapshot: DockNavigationSnapshot) {
  return JSON.stringify(snapshot);
}

function applySnapshot(snapshot: DockNavigationSnapshot, options: DockNavigationHistoryOptions) {
  if (snapshot.projectId && !options.projects.some((project) => project.id === snapshot.projectId)) {
    options.setDockView("list");
    return;
  }
  if (snapshot.projectId) {
    options.setActiveProjectId(snapshot.projectId);
  }
  options.setDockView(snapshot.view);
  options.setDetailId(snapshot.detailId);
  options.setDetailTab(snapshot.detailTab);
  options.setDetailVersion(snapshot.detailVersion);
}
