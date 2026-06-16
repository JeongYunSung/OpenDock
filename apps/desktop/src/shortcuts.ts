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

const rawDefaultShortcuts = defaultShortcutConfig.shortcuts;
const commandIds = Object.keys(rawDefaultShortcuts) as ShortcutCommandId[];
const commandIdSet = new Set<string>(commandIds);
const defaultShortcuts = Object.fromEntries(
  commandIds.map((id) => {
    const shortcut = rawDefaultShortcuts[id];
    return [
      id,
      {
        ...shortcut,
        mac: normalizeDefaultShortcut(shortcut.mac, "mac"),
        windows: normalizeDefaultShortcut(shortcut.windows, "windows"),
      },
    ];
  }),
) as typeof rawDefaultShortcuts;

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
    .join(" + ");
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
      mac: shortcutToConfigString(shortcutForCommand(definition.id, overrides, "mac"), "mac"),
      windows: shortcutToConfigString(shortcutForCommand(definition.id, overrides, "windows"), "windows"),
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
    const mac = normalizeImportedShortcut(value.mac, "mac");
    const windows = normalizeImportedShortcut(value.windows, "windows");
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

function shortcutToConfigString(shortcut: string | null, platform: ShortcutPlatform): string | null {
  if (!shortcut) return null;
  return shortcut
    .split("+")
    .map((part) => shortcutPartToConfigString(part, platform))
    .join("+");
}

function shortcutPartToConfigString(part: string, platform: ShortcutPlatform): string {
  if (platform === "mac") {
    if (part === "Meta") return "Command";
    if (part === "Ctrl") return "Control";
    if (part === "Alt") return "Option";
    return part;
  }
  if (part === "Meta") return "Win";
  return part;
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

function normalizeImportedShortcut(value: unknown, platform: ShortcutPlatform): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("Shortcut values must be strings or null.");
  }
  const normalized = normalizeShortcutString(value, platform);
  if (!normalized) {
    throw new Error(`Invalid shortcut: ${value}`);
  }
  return normalized;
}

function normalizeDefaultShortcut(value: string | null, platform: ShortcutPlatform): string | null {
  const normalized = normalizeImportedShortcut(value, platform);
  if (normalized === undefined) {
    throw new Error(`Missing default shortcut for ${platform}`);
  }
  return normalized;
}

function normalizeShortcutString(value: string, platform: ShortcutPlatform): string | null {
  const parts = value
    .split("+")
    .map((part) => normalizeShortcutPart(part.trim(), platform))
    .filter(Boolean);
  const key = parts.at(-1);
  if (!key || isShortcutModifier(key) || parts.length < 2) return null;
  return parts.join("+");
}

function normalizeShortcutPart(value: string, platform: ShortcutPlatform): string | null {
  const lower = value.toLowerCase();
  if (platform === "mac" && lower === "command") return "Meta";
  if (platform === "mac" && lower === "control") return "Ctrl";
  if (platform === "mac" && lower === "option") return "Alt";
  if (platform === "windows" && lower === "win") return "Meta";
  if (platform === "windows" && lower === "ctrl") return "Ctrl";
  if (platform === "windows" && lower === "alt") return "Alt";
  if (lower === "shift") return "Shift";
  if (lower === "enter") return "Enter";
  if (lower === "escape") return "Escape";
  if (lower === "space") return "Space";
  if (lower === "tab") return "Tab";
  if (lower === "backspace") return "Backspace";
  if (lower === "delete") return "Delete";
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  if (/^[0-9]$/.test(lower)) return lower;
  if (/^arrow(left|right|up|down)$/.test(lower)) {
    return `Arrow${lower.slice(5, 6).toUpperCase()}${lower.slice(6)}`;
  }
  if (/^f([1-9]|1[0-2])$/.test(lower)) return lower.toUpperCase();
  if (["[", "]", "/", "\\", ".", ",", "-", "="].includes(value)) return value;
  return null;
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

function isShortcutModifier(value: string): boolean {
  return value === "Alt" || value === "Ctrl" || value === "Meta" || value === "Shift";
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
