import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { AuthSession, DesktopAppState, Project } from "./data";
import { resolveActiveProjectId } from "./dock-workspace-model";
import { isTauriRuntime } from "./tauri-runtime";

interface DesktopStateSyncOptions {
  activeProjectId: string;
  appendLog: (level: string, color: string, message: string) => void;
  appStateLoaded: boolean;
  projects: Project[];
  setAccountEmail: Dispatch<SetStateAction<string>>;
  setActiveProjectId: Dispatch<SetStateAction<string>>;
  setAppStateLoaded: Dispatch<SetStateAction<boolean>>;
  setAuthProvider: Dispatch<SetStateAction<string>>;
  setLoggedIn: Dispatch<SetStateAction<boolean>>;
  setProjects: Dispatch<SetStateAction<Project[]>>;
}

export function useDesktopStateSync(options: DesktopStateSyncOptions) {
  const pendingSaveStateRef = useRef<DesktopAppState | null>(null);
  const savingStateRef = useRef(false);
  const appendLogRef = useRef(options.appendLog);
  appendLogRef.current = options.appendLog;

  const flushPendingSaveState = useCallback(async () => {
    if (savingStateRef.current) return;
    savingStateRef.current = true;
    try {
      while (pendingSaveStateRef.current) {
        const state = pendingSaveStateRef.current;
        pendingSaveStateRef.current = null;
        try {
          await invoke("opendock_save_app_state", { state });
        } catch (error) {
          appendLogRef.current("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      savingStateRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [state, session] = await Promise.all([
          invoke<DesktopAppState>("opendock_load_app_state"),
          invoke<AuthSession>("opendock_auth_session"),
        ]);
        if (cancelled) return;
        const loadedProjects = state.projects ?? [];
        options.setProjects(loadedProjects);
        options.setActiveProjectId(resolveActiveProjectId(loadedProjects, state.activeProjectId ?? ""));
        if (session.loggedIn) {
          options.setLoggedIn(true);
          options.setAuthProvider(session.provider ?? "google");
          if (session.email) options.setAccountEmail(session.email);
        } else {
          options.setLoggedIn(false);
          options.setAuthProvider("");
        }
      } catch (error) {
        if (!cancelled) {
          options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) options.setAppStateLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || !options.appStateLoaded) return;
    const state: DesktopAppState = {
      projects: options.projects,
      activeProjectId: options.activeProjectId,
    };
    pendingSaveStateRef.current = state;
    void flushPendingSaveState();
  }, [options.projects, options.activeProjectId, options.appStateLoaded, flushPendingSaveState]);

  useEffect(() => {
    const nextActiveProjectId = resolveActiveProjectId(options.projects, options.activeProjectId);
    if (nextActiveProjectId !== options.activeProjectId) options.setActiveProjectId(nextActiveProjectId);
  }, [options.projects, options.activeProjectId]);
}
