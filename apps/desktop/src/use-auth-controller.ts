import { invoke } from "@tauri-apps/api/core";
import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { commandFailureMessage } from "./command-log";
import type { AuthSession, Lang, OpenDockCommandResult, TEXT } from "./data";
import { isTauriRuntime } from "./tauri-runtime";

type AuthProvider = "gmail" | "github";
const browserDemoEmail = "hello@opendock.app";

interface AuthControllerOptions {
  resetAccountDocks: () => void;
  resetDockWorkspaceView: () => void;
  resetProjectDialogs: () => void;
  resetProjectRuntime: () => void;
  setAccountAvatarUrl: Dispatch<SetStateAction<string | null>>;
  setAccountDisplayName: Dispatch<SetStateAction<string>>;
  setAccountEmail: Dispatch<SetStateAction<string>>;
  setAccountOfficial: Dispatch<SetStateAction<boolean>>;
  setAuthProvider: Dispatch<SetStateAction<string>>;
  setInstalledDocks: Dispatch<SetStateAction<Record<string, boolean>>>;
  setLoggedIn: Dispatch<SetStateAction<boolean>>;
  setProjectSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  t: (typeof TEXT)[Lang];
}

export function useAuthController(options: AuthControllerOptions) {
  const [authWorking, setAuthWorking] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const authCommandIdRef = useRef<string | null>(null);
  const authRequestRef = useRef(0);
  const authWorkingRef = useRef(false);

  async function login(provider: AuthProvider) {
    if (authWorkingRef.current) return;
    const requestId = ++authRequestRef.current;
    const commandId = authCommandId(provider);
    authWorkingRef.current = true;
    authCommandIdRef.current = commandId;
    setAuthWorking(true);
    setAuthMessage(options.t.signInWaiting);
    if (isTauriRuntime()) {
      try {
        const result = await invoke<OpenDockCommandResult>("opendock_auth_login", { provider, commandId });
        if (!isCurrentAuthRequest(authRequestRef, authCommandIdRef, requestId, commandId)) return;
        if (!result.success) {
          setAuthMessage(commandFailureMessage(result, options.t.signInFailed));
          return;
        }
        const session = await invoke<AuthSession>("opendock_auth_session");
        if (!isCurrentAuthRequest(authRequestRef, authCommandIdRef, requestId, commandId)) return;
        if (!session.loggedIn || !session.email) {
          setAuthMessage(options.t.signInFailed);
          return;
        }
        setAuthMessage("");
        applySuccessfulLogin(options, provider, session.email);
        return;
      } catch (error) {
        if (!isCurrentAuthRequest(authRequestRef, authCommandIdRef, requestId, commandId)) return;
        setAuthMessage(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        finishAuthRequest(authRequestRef, authCommandIdRef, authWorkingRef, requestId, commandId, setAuthWorking);
      }
    } else if (provider === "gmail") {
      options.setAccountEmail(browserDemoEmail);
    }
    if (!isCurrentAuthRequest(authRequestRef, authCommandIdRef, requestId, commandId)) return;
    setAuthMessage("");
    applySuccessfulLogin(options, provider);
    finishAuthRequest(authRequestRef, authCommandIdRef, authWorkingRef, requestId, commandId, setAuthWorking);
  }

  async function logout() {
    const commandId = authCommandIdRef.current;
    authRequestRef.current += 1;
    authCommandIdRef.current = null;
    authWorkingRef.current = false;
    setAuthWorking(false);
    setAuthMessage("");
    if (isTauriRuntime()) {
      try {
        if (commandId) await invoke("opendock_cancel_command", { commandId });
      } catch {
        // The browser auth command may already have exited.
      }
      try {
        await invoke<OpenDockCommandResult>("opendock_auth_logout");
      } catch {
        // Local UI state still clears when the registry session is already gone.
      }
    }
    options.setLoggedIn(false);
    options.setAuthProvider("");
    options.setAccountAvatarUrl(null);
    options.setAccountDisplayName("");
    options.setAccountEmail("");
    options.setAccountOfficial(false);
    options.resetProjectDialogs();
    options.setProjectSidebarCollapsed(false);
    options.setInstalledDocks({});
    options.resetAccountDocks();
    options.resetProjectRuntime();
    options.resetDockWorkspaceView();
  }

  return {
    authMessage,
    authWorking,
    authCommandIdRef,
    login,
    logout,
    setAuthMessage,
  };
}

function authCommandId(provider: AuthProvider) {
  return `opendock-auth-${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isCurrentAuthRequest(
  authRequestRef: MutableRefObject<number>,
  authCommandIdRef: MutableRefObject<string | null>,
  requestId: number,
  commandId: string,
) {
  return authRequestRef.current === requestId && authCommandIdRef.current === commandId;
}

function finishAuthRequest(
  authRequestRef: MutableRefObject<number>,
  authCommandIdRef: MutableRefObject<string | null>,
  authWorkingRef: MutableRefObject<boolean>,
  requestId: number,
  commandId: string,
  setAuthWorking: Dispatch<SetStateAction<boolean>>,
) {
  if (!isCurrentAuthRequest(authRequestRef, authCommandIdRef, requestId, commandId)) return;
  authCommandIdRef.current = null;
  authWorkingRef.current = false;
  setAuthWorking(false);
}

function applySuccessfulLogin(options: AuthControllerOptions, provider: AuthProvider, email?: string) {
  if (email) options.setAccountEmail(email);
  options.setLoggedIn(true);
  options.setAuthProvider(provider);
  options.resetDockWorkspaceView();
}
