import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import type { Lang, TEXT } from "./data";
import { detectWindowControlPlatform } from "./app-menu";
import { chooseShortcutFileFromBrowser, downloadShortcutFile, type ShortcutFileResult } from "./shortcut-file";
import {
  exportShortcutConfig,
  findShortcutConflict,
  importShortcutConfig,
  resetShortcutOverride,
  setShortcutOverride,
  shortcutBindingsForPlatform,
  shortcutCommandLabel,
  shortcutPlatformForWindow,
  type ShortcutCommandId,
  type ShortcutOverrides,
} from "./shortcuts";
import { isTauriRuntime } from "./tauri-runtime";
import { useStoredState } from "./use-stored-state";

export function useShortcutController(lang: Lang, t: (typeof TEXT)[Lang]) {
  const [shortcutOverrides, setShortcutOverrides] = useStoredState<ShortcutOverrides>("opendock.shortcutOverrides", {});
  const [shortcutStatus, setShortcutStatus] = useState("");
  const windowControlPlatform = detectWindowControlPlatform();
  const shortcutPlatform = shortcutPlatformForWindow(windowControlPlatform);
  const shortcutBindings = useMemo(
    () => shortcutBindingsForPlatform(shortcutOverrides, shortcutPlatform),
    [shortcutOverrides, shortcutPlatform],
  );

  function updateShortcut(commandId: ShortcutCommandId, shortcut: string | null) {
    const conflict = findShortcutConflict(shortcutBindings, commandId, shortcut);
    if (conflict) {
      setShortcutStatus(t.shortcutConflict.replace("{command}", shortcutCommandLabel(conflict, lang)));
      return false;
    }
    setShortcutOverrides((current) => setShortcutOverride(current, commandId, shortcutPlatform, shortcut));
    setShortcutStatus(shortcut ? t.shortcutSaved : t.shortcutRemoved);
    return true;
  }

  function resetShortcut(commandId: ShortcutCommandId) {
    setShortcutOverrides((current) => resetShortcutOverride(current, commandId, shortcutPlatform));
    setShortcutStatus(t.shortcutResetDone);
  }

  function resetAllShortcuts() {
    setShortcutOverrides({});
    setShortcutStatus(t.shortcutResetAllDone);
  }

  async function importShortcuts() {
    try {
      const raw = isTauriRuntime()
        ? (await invoke<ShortcutFileResult | null>("opendock_import_shortcuts"))?.contents ?? null
        : await chooseShortcutFileFromBrowser();
      if (!raw) return;
      const next = importShortcutConfig(raw);
      setShortcutOverrides(next);
      setShortcutStatus(t.shortcutImportDone);
    } catch (error) {
      setShortcutStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function exportShortcuts() {
    try {
      const contents = exportShortcutConfig(shortcutOverrides);
      if (isTauriRuntime()) {
        const path = await invoke<string | null>("opendock_export_shortcuts", { contents });
        if (!path) return;
      } else {
        downloadShortcutFile(contents);
      }
      setShortcutStatus(t.shortcutExportDone);
    } catch (error) {
      setShortcutStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    exportShortcuts,
    importShortcuts,
    resetAllShortcuts,
    resetShortcut,
    shortcutBindings,
    shortcutPlatform,
    shortcutStatus,
    updateShortcut,
    windowControlPlatform,
  };
}
