import { invoke } from "@tauri-apps/api/core";
import { useState, type Dispatch, type SetStateAction } from "react";
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

  async function login(provider: AuthProvider) {
    setAuthWorking(true);
    setAuthMessage(options.t.signInWaiting);
    if (isTauriRuntime()) {
      try {
        const result = await invoke<OpenDockCommandResult>("opendock_auth_login", { provider });
        if (!result.success) {
          setAuthMessage(commandFailureMessage(result, options.t.signInFailed));
          return;
        }
        const session = await invoke<AuthSession>("opendock_auth_session");
        if (session.email) options.setAccountEmail(session.email);
      } catch (error) {
        setAuthMessage(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        setAuthWorking(false);
      }
    } else if (provider === "gmail") {
      options.setAccountEmail(browserDemoEmail);
    }
    setAuthWorking(false);
    setAuthMessage("");
    options.setLoggedIn(true);
    options.setAuthProvider(provider);
    options.resetDockWorkspaceView();
  }

  async function logout() {
    if (isTauriRuntime()) {
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
    login,
    logout,
    setAuthMessage,
  };
}
