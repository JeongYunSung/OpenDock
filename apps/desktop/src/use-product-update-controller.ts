import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNoticeKind } from "./app-notice";
import type { ProductUpdateCheck, ProductUpdateState } from "./data";
import { isTauriRuntime } from "./tauri-runtime";

interface ProductUpdateControllerOptions {
  appendLog: (level: string, color: string, message: string) => void;
  messages: {
    available: (currentVersion: string, latestVersion: string) => string;
    checking: string;
    desktopOnly: string;
    failed: (message: string) => string;
    upToDate: (currentVersion: string) => string;
  };
  showNotice: (kind: AppNoticeKind, message: string) => void;
}

const initialProductUpdateState: ProductUpdateState = {
  check: null,
  status: "idle",
};

export function useProductUpdateController(options: ProductUpdateControllerOptions) {
  const appendLogRef = useRef(options.appendLog);
  const messagesRef = useRef(options.messages);
  const showNoticeRef = useRef(options.showNotice);
  const [productUpdate, setProductUpdate] = useState<ProductUpdateState>(initialProductUpdateState);

  useEffect(() => {
    appendLogRef.current = options.appendLog;
    messagesRef.current = options.messages;
    showNoticeRef.current = options.showNotice;
  }, [options.appendLog, options.messages, options.showNotice]);

  const checkProductUpdate = useCallback(async (checkOptions: { cancelled?: () => boolean; silentStart?: boolean } = {}) => {
    const silent = checkOptions.silentStart === true;
    if (!isTauriRuntime()) {
      if (!silent) {
        const message = messagesRef.current.desktopOnly;
        appendLogRef.current("INFO", "var(--text-2)", message);
        showNoticeRef.current("info", message);
      }
      return;
    }
    if (!silent) {
      const message = messagesRef.current.checking;
      appendLogRef.current("INFO", "var(--text-2)", message);
      showNoticeRef.current("info", message);
    }
    setProductUpdate((current) => ({ ...current, status: "checking" }));
    try {
      const check = await invoke<ProductUpdateCheck>("opendock_app_update_check");
      if (checkOptions.cancelled?.()) {
        return;
      }
      setProductUpdate({
        check,
        status: check.updateAvailable ? "available" : "current",
      });
      if (!silent) {
        const message = check.updateAvailable
          ? messagesRef.current.available(check.currentVersion, check.latestVersion)
          : messagesRef.current.upToDate(check.currentVersion);
        appendLogRef.current(
          check.updateAvailable ? "WARN" : "OK",
          check.updateAvailable ? "var(--warning)" : "var(--success)",
          message,
        );
        showNoticeRef.current(check.updateAvailable ? "warning" : "success", message);
      }
    } catch (error) {
      if (checkOptions.cancelled?.()) {
        return;
      }
      setProductUpdate({ check: null, status: "failed" });
      if (!silent) {
        const message = messagesRef.current.failed(errorMessage(error));
        appendLogRef.current("WARN", "var(--warning)", message);
        showNoticeRef.current("warning", message);
      }
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let cancelled = false;
    void checkProductUpdate({ cancelled: () => cancelled, silentStart: true });
    return () => {
      cancelled = true;
    };
  }, [checkProductUpdate]);

  const openProductRelease = useCallback(async () => {
    const releaseUrl = productUpdate.check?.releaseUrl;
    if (!releaseUrl) {
      return;
    }
    if (!isTauriRuntime()) {
      window.open(releaseUrl, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      await invoke("open_external_url", { url: releaseUrl });
    } catch (error) {
      appendLogRef.current("WARN", "var(--warning)", errorMessage(error));
    }
  }, [productUpdate.check?.releaseUrl]);

  return {
    checkProductUpdate,
    openProductRelease,
    productUpdate,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
