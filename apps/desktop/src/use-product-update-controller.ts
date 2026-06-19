import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductUpdateCheck, ProductUpdateState } from "./data";
import { isTauriRuntime } from "./tauri-runtime";

interface ProductUpdateControllerOptions {
  appendLog: (level: string, color: string, message: string) => void;
}

const initialProductUpdateState: ProductUpdateState = {
  check: null,
  status: "idle",
};

export function useProductUpdateController(options: ProductUpdateControllerOptions) {
  const appendLogRef = useRef(options.appendLog);
  const [productUpdate, setProductUpdate] = useState<ProductUpdateState>(initialProductUpdateState);

  useEffect(() => {
    appendLogRef.current = options.appendLog;
  }, [options.appendLog]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let cancelled = false;
    async function checkLatestRelease() {
      setProductUpdate((current) => ({ ...current, status: "checking" }));
      try {
        const check = await invoke<ProductUpdateCheck>("opendock_app_update_check");
        if (cancelled) {
          return;
        }
        setProductUpdate({
          check,
          status: check.updateAvailable ? "available" : "current",
        });
        appendLogRef.current(
          check.updateAvailable ? "WARN" : "OK",
          check.updateAvailable ? "var(--warning)" : "var(--success)",
          check.updateAvailable
            ? `OpenDock update available · ${check.currentVersion} -> ${check.latestVersion}`
            : `OpenDock is up to date · ${check.currentVersion}`,
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        setProductUpdate({ check: null, status: "failed" });
        appendLogRef.current("WARN", "var(--warning)", `OpenDock update check failed · ${errorMessage(error)}`);
      }
    }
    void checkLatestRelease();
    return () => {
      cancelled = true;
    };
  }, []);

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
    openProductRelease,
    productUpdate,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
