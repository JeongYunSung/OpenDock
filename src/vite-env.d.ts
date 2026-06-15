/// <reference types="vite/client" />

interface Window {
  showDirectoryPicker?: () => Promise<{ name?: string }>;
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
}
