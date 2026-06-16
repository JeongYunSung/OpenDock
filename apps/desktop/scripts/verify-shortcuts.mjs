import assert from "node:assert/strict";
import { exportShortcutConfig, formatShortcutForDisplay, importShortcutConfig } from "../src/shortcuts.ts";

const customShortcuts = {
  "dock.refresh": {
    mac: "Meta+Ctrl+R",
    windows: "Meta+Alt+R",
  },
  "project.new": {
    mac: "Meta+Alt+P",
    windows: "Ctrl+Alt+P",
  },
};

const exported = JSON.parse(exportShortcutConfig(customShortcuts));

assert.equal(exported.shortcuts["command.palette"].mac, "Command+K");
assert.equal(exported.shortcuts["command.palette"].windows, "Ctrl+K");
assert.equal(exported.shortcuts["project.new"].mac, "Command+Option+P");
assert.equal(exported.shortcuts["project.new"].windows, "Ctrl+Alt+P");
assert.equal(exported.shortcuts["dock.refresh"].mac, "Command+Control+R");
assert.equal(exported.shortcuts["dock.refresh"].windows, "Win+Alt+R");
assert.equal(formatShortcutForDisplay("Meta+K", "mac"), "⌘ + K");
assert.equal(formatShortcutForDisplay("Meta+Ctrl+Alt+Shift+Enter", "mac"), "⌘ + ⌃ + ⌥ + ⇧ + ↵");
assert.equal(formatShortcutForDisplay("Ctrl+Alt+K", "windows"), "Ctrl + Alt + K");
assert.equal(formatShortcutForDisplay("Meta+K", "windows"), "Win + K");

const imported = importShortcutConfig(
  JSON.stringify({
    version: 1,
    shortcuts: {
      "dock.refresh": {
        mac: "Command+Control+R",
        windows: "Win+Alt+R",
      },
      "project.new": {
        mac: "Command+Option+P",
        windows: "Ctrl+Alt+P",
      },
    },
  }),
);

assert.deepEqual(imported, customShortcuts);

assertInvalid("mac", "Cmd+K");
assertInvalid("mac", "Meta+K");
assertInvalid("mac", "Ctrl+K");
assertInvalid("mac", "Alt+K");
assertInvalid("windows", "Command+K");
assertInvalid("windows", "Control+K");
assertInvalid("windows", "Option+K");
assertInvalid("windows", "Meta+K");
assertInvalid("windows", "Escape");

console.log("shortcut import/export verification passed");

function assertInvalid(platform, shortcut) {
  assert.throws(
    () =>
      importShortcutConfig(
        JSON.stringify({
          version: 1,
          shortcuts: {
            "project.new": {
              [platform]: shortcut,
            },
          },
        }),
      ),
    /Invalid shortcut/,
    `${platform} shortcut should be invalid: ${shortcut}`,
  );
}
