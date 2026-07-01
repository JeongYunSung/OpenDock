import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNoticeKind, AppNoticeOptions } from "./app-notice";
import type { ProductUpdateCheck, ProductUpdateState } from "./data";
import { isTauriRuntime } from "./tauri-runtime";

interface ProductUpdateControllerOptions {
  appendLog: (level: string, color: string, message: string) => void;
  messages: {
    available: (currentVersion: string, latestVersion: string) => string;
    checking: string;
    downloading: (latestVersion: string, percent: number | null) => string;
    desktopOnly: string;
    failed: (message: string) => string;
    installing: (latestVersion: string) => string;
    openReleaseFallback: string;
    restarting: string;
    upToDate: (currentVersion: string) => string;
  };
  showNotice: (kind: AppNoticeKind, message: string, options?: AppNoticeOptions) => void;
}

interface ProductUpdateProgress {
  contentLength?: number | null;
  downloadedBytes: number;
  latestVersion: string;
  phase: "downloading" | "installing" | "restarting" | "starting" | string;
}

const initialProductUpdateState: ProductUpdateState = {
  check: null,
  status: "idle",
};

const productUpdateNotice = { stableKey: "product-update-progress" };

export function useProductUpdateController(options: ProductUpdateControllerOptions) {
  const appendLogRef = useRef(options.appendLog);
  const checkRequestRef = useRef(0);
  const installingProductUpdateRef = useRef(false);
  const messagesRef = useRef(options.messages);
  const productUpdateRef = useRef<ProductUpdateState>(initialProductUpdateState);
  const showNoticeRef = useRef(options.showNotice);
  const [productUpdate, setProductUpdate] = useState<ProductUpdateState>(initialProductUpdateState);

  useEffect(() => {
    appendLogRef.current = options.appendLog;
    messagesRef.current = options.messages;
    showNoticeRef.current = options.showNotice;
  }, [options.appendLog, options.messages, options.showNotice]);

  useEffect(() => {
    productUpdateRef.current = productUpdate;
  }, [productUpdate]);

  const checkProductUpdate = useCallback(async (checkOptions: { cancelled?: () => boolean; silentStart?: boolean } = {}) => {
    if (installingProductUpdateRef.current) return;
    const requestId = ++checkRequestRef.current;
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
      if (checkOptions.cancelled?.() || checkRequestRef.current !== requestId || installingProductUpdateRef.current) {
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
      if (checkOptions.cancelled?.() || checkRequestRef.current !== requestId || installingProductUpdateRef.current) {
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

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<ProductUpdateProgress>("opendock-product-update-progress", (event) => {
      const progress = event.payload;
      setProductUpdate((current) => ({ ...current, status: "installing" }));
      if (progress.phase === "downloading") {
        const percent = progress.contentLength
          ? Math.min(100, Math.round((progress.downloadedBytes / progress.contentLength) * 100))
          : null;
        showNoticeRef.current("info", messagesRef.current.downloading(progress.latestVersion, percent), productUpdateNotice);
      } else if (progress.phase === "installing") {
        showNoticeRef.current("info", messagesRef.current.installing(progress.latestVersion), productUpdateNotice);
      } else if (progress.phase === "restarting") {
        showNoticeRef.current("success", messagesRef.current.restarting);
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const openReleaseUrl = useCallback(async (releaseUrl: string) => {
    if (!isTauriRuntime()) {
      window.open(releaseUrl, "_blank", "noopener,noreferrer");
      return;
    }
    await invoke("open_external_url", { url: releaseUrl });
  }, []);

  const openProductRelease = useCallback(async () => {
    const releaseUrl = productUpdate.check?.releaseUrl;
    if (!releaseUrl) {
      return;
    }
    try {
      await openReleaseUrl(releaseUrl);
    } catch (error) {
      appendLogRef.current("WARN", "var(--warning)", errorMessage(error));
    }
  }, [openReleaseUrl, productUpdate.check?.releaseUrl]);

  const installProductUpdate = useCallback(async () => {
    if (installingProductUpdateRef.current) return;
    const check = productUpdateRef.current.check;
    if (!check) {
      await checkProductUpdate();
      return;
    }
    if (!check.updateAvailable) {
      showNoticeRef.current("success", messagesRef.current.upToDate(check.currentVersion));
      return;
    }
    if (!check.autoUpdateAvailable) {
      const message = messagesRef.current.openReleaseFallback;
      appendLogRef.current("INFO", "var(--text-2)", message);
      showNoticeRef.current("info", message);
      try {
        await openReleaseUrl(check.releaseUrl);
      } catch (error) {
        appendLogRef.current("WARN", "var(--warning)", errorMessage(error));
      }
      return;
    }

    installingProductUpdateRef.current = true;
    setProductUpdate((current) => ({ ...current, status: "installing" }));
    appendLogRef.current("RUN", "var(--info)", `install OpenDock ${check.latestVersion}`);
    showNoticeRef.current("info", messagesRef.current.installing(check.latestVersion), productUpdateNotice);
    try {
      await invoke("opendock_app_update_install");
    } catch (error) {
      installingProductUpdateRef.current = false;
      setProductUpdate((current) => ({ ...current, status: current.check?.updateAvailable ? "available" : "failed" }));
      const message = messagesRef.current.failed(errorMessage(error));
      appendLogRef.current("WARN", "var(--warning)", message);
      showNoticeRef.current("warning", message);
    }
  }, [checkProductUpdate, openReleaseUrl]);

  return {
    checkProductUpdate,
    installProductUpdate,
    openProductRelease,
    productUpdate,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
