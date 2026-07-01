import { listen } from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { isTaskActive, type CommandTask } from "./command-task";
import { isAuthStatusLine, logColor } from "./command-log";
import type { OpenDockCommandLine, OpenDockCommandProgress } from "./data";
import { shouldIgnoreGlobalShortcut } from "./keyboard-events";
import { shortcutCommandForEvent, type ShortcutBinding, type ShortcutCommandId } from "./shortcuts";
import { isTauriRuntime } from "./tauri-runtime";

interface NativeEventBridgeOptions {
  appendLog: (level: string, color: string, message: string) => void;
  applyCommandLineToTask: (line: OpenDockCommandLine) => void;
  applyCommandProgressToTask: (progress: OpenDockCommandProgress) => void;
  authCommandIdRef: MutableRefObject<string | null>;
  commandTask: CommandTask | null;
  commandTaskRef: MutableRefObject<CommandTask | null>;
  handleNativeMenu: (id: string) => Promise<void> | void;
  projectDialogOpen: boolean;
  shortcutBindings: ShortcutBinding[];
  setAuthMessage: Dispatch<SetStateAction<string>>;
  runShortcutCommand: (commandId: ShortcutCommandId) => Promise<void> | void;
}

export function useNativeEventBridge(options: NativeEventBridgeOptions) {
  const handleNativeMenuRef = useRef<(id: string) => Promise<void> | void>(() => undefined);
  const shortcutBindingsRef = useRef<ShortcutBinding[]>([]);
  const shortcutSuspendedRef = useRef(false);
  const runShortcutCommandRef = useRef<(commandId: ShortcutCommandId) => Promise<void> | void>(() => undefined);
  const commandEventHandlersRef = useRef({
    appendLog: options.appendLog,
    applyCommandLineToTask: options.applyCommandLineToTask,
    applyCommandProgressToTask: options.applyCommandProgressToTask,
    authCommandIdRef: options.authCommandIdRef,
    commandTaskRef: options.commandTaskRef,
    setAuthMessage: options.setAuthMessage,
  });

  useLayoutEffect(() => {
    handleNativeMenuRef.current = options.handleNativeMenu;
    shortcutBindingsRef.current = options.shortcutBindings;
    shortcutSuspendedRef.current = options.projectDialogOpen || Boolean(options.commandTask && isTaskActive(options.commandTask));
    runShortcutCommandRef.current = options.runShortcutCommand;
    commandEventHandlersRef.current = {
      appendLog: options.appendLog,
      applyCommandLineToTask: options.applyCommandLineToTask,
      applyCommandProgressToTask: options.applyCommandProgressToTask,
      authCommandIdRef: options.authCommandIdRef,
      commandTaskRef: options.commandTaskRef,
      setAuthMessage: options.setAuthMessage,
    };
  });

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>("opendock-menu", (event) => {
      void handleNativeMenuRef.current(String(event.payload));
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

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalShortcut(event)) return;
      const commandId = shortcutCommandForEvent(event, shortcutBindingsRef.current);
      if (!commandId) return;
      if (shortcutSuspendedRef.current && commandId !== "command.palette") return;
      event.preventDefault();
      event.stopPropagation();
      void runShortcutCommandRef.current(commandId);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void listen<OpenDockCommandLine>("opendock-command-line", (event) => {
      const line = event.payload;
      const handlers = commandEventHandlersRef.current;
      if (isStaleCommandLine(line, handlers.commandTaskRef, handlers.authCommandIdRef)) return;
      if (isAuthStatusLine(line.message)) handlers.setAuthMessage(line.message);
      handlers.appendLog(line.level, logColor(line.level), line.message);
      handlers.applyCommandLineToTask(line);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisteners.push(dispose);
    });
    void listen<OpenDockCommandProgress>("opendock-command-progress", (event) => {
      const progress = event.payload;
      const handlers = commandEventHandlersRef.current;
      if (progress.commandId && handlers.commandTaskRef.current?.id !== progress.commandId) return;
      const level = progress.level.toUpperCase();
      handlers.appendLog(level, logColor(level), progress.message);
      handlers.applyCommandProgressToTask(progress);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisteners.push(dispose);
    });
    return () => {
      disposed = true;
      for (const dispose of unlisteners) {
        dispose();
      }
    };
  }, []);
}

function isStaleCommandLine(
  line: OpenDockCommandLine,
  commandTaskRef: MutableRefObject<CommandTask | null>,
  authCommandIdRef: MutableRefObject<string | null>,
) {
  if (!line.commandId) return false;
  return line.commandId !== commandTaskRef.current?.id && line.commandId !== authCommandIdRef.current;
}
