import defaultShortcutConfig from "./shortcuts.default.json";

export type ShortcutPlatform = "mac" | "windows";
export type ShortcutLocale = "en" | "ko";
export type ShortcutCommandId = keyof typeof defaultShortcutConfig.shortcuts;

export interface ShortcutDefinition {
  description: Record<ShortcutLocale, string>;
  editable: boolean;
  id: ShortcutCommandId;
  label: Record<ShortcutLocale, string>;
  mac: string | null;
  windows: string | null;
}

export interface ShortcutBinding extends ShortcutDefinition {
  accelerator: string | null;
}

export type ShortcutOverrides = Partial<
  Record<ShortcutCommandId, Partial<Record<ShortcutPlatform, string | null>>>
>;

export interface ShortcutConfigFile {
  shortcuts: Record<string, Partial<Record<ShortcutPlatform, string | null>>>;
  version: 1;
}

type KeyboardLikeEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

const defaultShortcuts = defaultShortcutConfig.shortcuts;
const commandIds = Object.keys(defaultShortcuts) as ShortcutCommandId[];
const commandIdSet = new Set<string>(commandIds);

export const shortcutDefinitions: ShortcutDefinition[] = commandIds.map((id) => ({
  id,
  description: defaultShortcuts[id].description,
  editable: defaultShortcuts[id].editable,
  label: defaultShortcuts[id].label,
  mac: defaultShortcuts[id].mac,
  windows: defaultShortcuts[id].windows,
}));

export function shortcutPlatformForWindow(platform: "macos" | "windows"): ShortcutPlatform {
  return platform === "macos" ? "mac" : "windows";
}

export function shortcutBindingsForPlatform(
  overrides: ShortcutOverrides,
  platform: ShortcutPlatform,
): ShortcutBinding[] {
  return shortcutDefinitions.map((definition) => ({
    ...definition,
    accelerator: shortcutForCommand(definition.id, overrides, platform),
  }));
}

export function shortcutForCommand(
  commandId: ShortcutCommandId,
  overrides: ShortcutOverrides,
  platform: ShortcutPlatform,
): string | null {
  const override = overrides[commandId]?.[platform];
  if (override !== undefined) return override;
  return defaultShortcuts[commandId][platform];
}

export function shortcutCommandForEvent(
  event: KeyboardLikeEvent,
  bindings: ShortcutBinding[],
): ShortcutCommandId | null {
  const shortcut = shortcutFromKeyboardEvent(event);
  if (!shortcut) return null;
  return bindings.find((binding) => binding.accelerator === shortcut)?.id ?? null;
}

export function shortcutFromKeyboardEvent(event: KeyboardLikeEvent): string | null {
  const key = normalizeShortcutKey(event.key);
  if (!key) return null;
  const parts = [
    event.metaKey ? "Meta" : "",
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    key,
  ].filter(Boolean);
  return parts.length > 1 ? parts.join("+") : null;
}

export function formatShortcutForDisplay(shortcut: string | null, platform: ShortcutPlatform) {
  if (!shortcut) return "Unset";
  const labels: Record<string, string> =
    platform === "mac"
      ? {
          Alt: "⌥",
          Ctrl: "⌃",
          Enter: "↵",
          Meta: "⌘",
          Shift: "⇧",
        }
      : {
          Alt: "Alt",
          Ctrl: "Ctrl",
          Enter: "Enter",
          Meta: "Win",
          Shift: "Shift",
        };
  return shortcut
    .split("+")
    .map((part) => labels[part] ?? part)
    .join(platform === "mac" ? "" : "+");
}

export function findShortcutConflict(
  bindings: ShortcutBinding[],
  commandId: ShortcutCommandId,
  shortcut: string | null,
): ShortcutBinding | null {
  if (!shortcut) return null;
  return bindings.find((binding) => binding.id !== commandId && binding.accelerator === shortcut) ?? null;
}

export function setShortcutOverride(
  overrides: ShortcutOverrides,
  commandId: ShortcutCommandId,
  platform: ShortcutPlatform,
  shortcut: string | null,
): ShortcutOverrides {
  const next: ShortcutOverrides = { ...overrides };
  const commandOverride = { ...(next[commandId] ?? {}) };
  commandOverride[platform] = shortcut;
  next[commandId] = commandOverride;
  return pruneShortcutOverrides(next);
}

export function resetShortcutOverride(
  overrides: ShortcutOverrides,
  commandId: ShortcutCommandId,
  platform: ShortcutPlatform,
): ShortcutOverrides {
  const next: ShortcutOverrides = { ...overrides };
  const commandOverride = { ...(next[commandId] ?? {}) };
  delete commandOverride[platform];
  if (Object.keys(commandOverride).length > 0) {
    next[commandId] = commandOverride;
  } else {
    delete next[commandId];
  }
  return next;
}

export function exportShortcutConfig(overrides: ShortcutOverrides): string {
  const shortcuts: ShortcutConfigFile["shortcuts"] = {};
  for (const definition of shortcutDefinitions) {
    shortcuts[definition.id] = {
      mac: shortcutForCommand(definition.id, overrides, "mac"),
      windows: shortcutForCommand(definition.id, overrides, "windows"),
    };
  }
  return `${JSON.stringify({ version: 1, shortcuts }, null, 2)}\n`;
}

export function importShortcutConfig(raw: string): ShortcutOverrides {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Shortcut file must be valid JSON.");
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.shortcuts)) {
    throw new Error("Shortcut file must use version 1 and include shortcuts.");
  }
  const next: ShortcutOverrides = {};
  for (const [commandId, value] of Object.entries(parsed.shortcuts)) {
    if (!commandIdSet.has(commandId) || !isRecord(value)) continue;
    const mac = normalizeImportedShortcut(value.mac);
    const windows = normalizeImportedShortcut(value.windows);
    const entry: Partial<Record<ShortcutPlatform, string | null>> = {};
    if (mac !== undefined) entry.mac = mac;
    if (windows !== undefined) entry.windows = windows;
    if (Object.keys(entry).length > 0) {
      next[commandId as ShortcutCommandId] = entry;
    }
  }
  validateShortcutConflicts(next);
  return pruneShortcutOverrides(next);
}

export function shortcutCommandLabel(
  binding: Pick<ShortcutDefinition, "label">,
  locale: ShortcutLocale,
) {
  return binding.label[locale] ?? binding.label.en;
}

function validateShortcutConflicts(overrides: ShortcutOverrides): void {
  for (const platform of ["mac", "windows"] as const) {
    const seen = new Map<string, ShortcutCommandId>();
    for (const definition of shortcutDefinitions) {
      const shortcut = shortcutForCommand(definition.id, overrides, platform);
      if (!shortcut) continue;
      const prior = seen.get(shortcut);
      if (prior) {
        throw new Error(`Shortcut ${shortcut} is already used by ${prior}.`);
      }
      seen.set(shortcut, definition.id);
    }
  }
}

function normalizeImportedShortcut(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("Shortcut values must be strings or null.");
  }
  const normalized = normalizeShortcutString(value);
  if (!normalized) {
    throw new Error(`Invalid shortcut: ${value}`);
  }
  return normalized;
}

function normalizeShortcutString(value: string): string | null {
  const parts = value
    .split("+")
    .map((part) => normalizeShortcutPart(part.trim()))
    .filter(Boolean);
  const key = parts.at(-1);
  if (!key || parts.length < 2) return null;
  return parts.join("+");
}

function normalizeShortcutPart(value: string): string | null {
  const lower = value.toLowerCase();
  if (lower === "cmd" || lower === "command" || lower === "meta" || lower === "super") return "Meta";
  if (lower === "control" || lower === "ctrl") return "Ctrl";
  if (lower === "option" || lower === "alt") return "Alt";
  if (lower === "shift") return "Shift";
  if (lower === "return" || lower === "enter") return "Enter";
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  if (/^[0-9]$/.test(lower)) return lower;
  if (["[", "]", "/", "\\", ".", ",", "-", "="].includes(value)) return value;
  return normalizeShortcutKey(value);
}

function normalizeShortcutKey(key: string): string | null {
  if (["Alt", "Control", "Meta", "Shift"].includes(key)) return null;
  if (key === " ") return "Space";
  if (key === "Esc") return "Escape";
  if (key === "Return") return "Enter";
  if (key.length === 1) return key.toUpperCase();
  if (/^Arrow(Left|Right|Up|Down)$/.test(key)) return key;
  if (/^F([1-9]|1[0-2])$/.test(key)) return key;
  if (["Backspace", "Delete", "Enter", "Escape", "Space", "Tab"].includes(key)) return key;
  return null;
}

function pruneShortcutOverrides(overrides: ShortcutOverrides): ShortcutOverrides {
  const next: ShortcutOverrides = {};
  for (const definition of shortcutDefinitions) {
    const entry = overrides[definition.id];
    if (!entry) continue;
    const pruned: Partial<Record<ShortcutPlatform, string | null>> = {};
    for (const platform of ["mac", "windows"] as const) {
      if (entry[platform] !== undefined && entry[platform] !== defaultShortcuts[definition.id][platform]) {
        pruned[platform] = entry[platform];
      }
    }
    if (Object.keys(pruned).length > 0) {
      next[definition.id] = pruned;
    }
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
