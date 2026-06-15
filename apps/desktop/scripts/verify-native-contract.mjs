import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rust = readFileSync(resolve(appRoot, "src-tauri", "src", "lib.rs"), "utf8");
const app = readFileSync(resolve(appRoot, "src", "App.tsx"), "utf8");
const data = readFileSync(resolve(appRoot, "src", "data.ts"), "utf8");
const styles = readFileSync(resolve(appRoot, "src", "styles.css"), "utf8");
const defaultCapability = JSON.parse(
  readFileSync(resolve(appRoot, "src-tauri", "capabilities", "default.json"), "utf8")
);

const menuIds = unique([...rust.matchAll(/MenuItem::with_id\(\s*app,\s*"([^"]+)"/g)].map((match) => match[1]));
const frontendMenuCases = unique(
  [...extractFunctionBody(app, "async function handleNativeMenu").matchAll(/case "([^"]+)":/g)].map(
    (match) => match[1]
  )
);
const emittedMenuIds = menuIds.filter((id) => id !== "app:quit");
const ignoredCaseIds = new Set(["window:reload"]);

const unhandledMenuIds = emittedMenuIds.filter((id) => !frontendMenuCases.includes(id));
const staleMenuCases = frontendMenuCases.filter(
  (id) => !emittedMenuIds.includes(id) && !ignoredCaseIds.has(id)
);

const registeredCommands = extractGenerateHandlerCommands(rust);
const invokedCommands = unique([...app.matchAll(/invoke(?:<[^>]+>)?\("([^"]+)"/g)].map((match) => match[1]));
const unregisteredInvokes = invokedCommands.filter((command) => !registeredCommands.includes(command));
const requiredWindowPermissions = requiredCoreWindowPermissions(app);
const capabilityPermissions = defaultCapability.permissions ?? [];
const missingWindowPermissions = requiredWindowPermissions.filter(
  (permission) => !capabilityPermissions.includes(permission)
);
const forbiddenTitlebarDragCss = styles.includes("-webkit-app-region");
const menuListenerEffect = extractUseEffectContaining(app, 'listen<string>("opendock-menu"');
const menuListenerUsesRef = menuListenerEffect.includes("handleNativeMenuRef.current");
const menuListenerHasEmptyDeps = /\},\s*\[\]\s*\)/.test(menuListenerEffect);
const blankProjectHasInFlightGuard =
  app.includes("if (blankProjectCreatingRef.current) return;") &&
  app.includes("blankProjectCreatingRef.current = true;") &&
  app.includes("blankProjectCreatingRef.current = false;");
const logCommandBody = extractFunctionBody(rust, "fn opendock_log");
const logCommandIsNonStreaming =
  logCommandBody.includes('run_opendock(Some(&project_dir), &["log"])') &&
  !logCommandBody.includes("run_opendock_streaming");
const appParsesHistoricalLogLines =
  app.includes("function parseOpenDockHistoryLine") &&
  app.includes("setLogs(result.lines.map(commandLineLogEntry))");
const registryRequestsBypassCache =
  rust.includes("reqwest::header::CACHE_CONTROL") &&
  rust.includes("reqwest::header::PRAGMA") &&
  app.includes('cache: "no-store"');
const detailMergeUsesRegistryLatestVersion = data.includes("version: detail.latestVersion ?? base.version");
const installRefreshesDockBeforeResolvingRef = (() => {
  const installBody = extractFunctionBody(app, "async function installDock");
  const refreshIndex = installBody.indexOf("await refreshDockDetail(dock)");
  const refIndex = installBody.indexOf("const dockRef = `${dockFullId(freshDock)}@${freshDock.version}`");
  return refreshIndex !== -1 && refIndex !== -1 && refreshIndex < refIndex;
})();
const installedViewPollsProjectState =
  app.includes('dockView !== "installed"') &&
  app.includes("refreshInstalledProjectState") &&
  app.includes("window.setInterval(refreshInstalledProjectState, 5000)") &&
  app.includes("await refreshProjectState(project, { silent: true })");
const changeCommandsUseEvents =
  rust.includes('&["install", &dock_ref, "--events"]') &&
  rust.includes('vec!["update", "--events"') &&
  rust.includes('vec!["uninstall", dock_id.as_str(), "--events"]');
const commandProgressBridge =
  rust.includes('app.emit("opendock-command-progress"') &&
  rust.includes("command_progress_from_event_line") &&
  app.includes('listen<OpenDockCommandProgress>("opendock-command-progress"') &&
  app.includes("applyCommandProgressToTask(progress)");

const failures = [
  ...unhandledMenuIds.map((id) => `menu id is not handled in App.tsx: ${id}`),
  ...staleMenuCases.map((id) => `App.tsx handles a menu id not created by Rust: ${id}`),
  ...unregisteredInvokes.map((command) => `Tauri command is invoked but not registered: ${command}`),
  ...missingWindowPermissions.map((permission) => `window control permission is missing: ${permission}`),
  ...(!menuListenerEffect ? ["opendock-menu listener is missing from App.tsx"] : []),
  ...(menuListenerEffect && !menuListenerUsesRef
    ? ["opendock-menu listener must dispatch through handleNativeMenuRef to avoid stale duplicate listeners"]
    : []),
  ...(menuListenerEffect && !menuListenerHasEmptyDeps
    ? ["opendock-menu listener must be registered once with an empty dependency array"]
    : []),
  ...(!blankProjectHasInFlightGuard
    ? ["createBlankProject must keep an in-flight guard to prevent duplicate native menu project creation"]
    : []),
  ...(!logCommandIsNonStreaming
    ? ["opendock_log must load historical logs without emitting live command events"]
    : []),
  ...(!appParsesHistoricalLogLines
    ? ["project log refresh must parse historical opendock log timestamps before rendering"]
    : []),
  ...(!registryRequestsBypassCache
    ? ["registry reads must bypass cache so disabled releases are reflected before actions"]
    : []),
  ...(!detailMergeUsesRegistryLatestVersion
    ? ["registry detail merge must update Dock.version from latestVersion"]
    : []),
  ...(!installRefreshesDockBeforeResolvingRef
    ? ["installDock must refresh registry detail before constructing the install reference"]
    : []),
  ...(!installedViewPollsProjectState
    ? ["installed view must refresh project outdated state while visible and after update"]
    : []),
  ...(!changeCommandsUseEvents
    ? ["install/update/uninstall app commands must use --events for structured progress"]
    : []),
  ...(!commandProgressBridge
    ? ["desktop app must bridge opendock progress events into the command progress dialog"]
    : []),
  ...(forbiddenTitlebarDragCss
    ? ["CSS app-region drag is forbidden; use data-tauri-drag-region on the dedicated drag target instead"]
    : [])
];

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `native contract verification passed (${emittedMenuIds.length} menu ids, ${invokedCommands.length} invokes, ${requiredWindowPermissions.length} window permissions)`
);

function unique(values) {
  return [...new Set(values)];
}

function requiredCoreWindowPermissions(source) {
  const permissionByCall = new Map([
    [".close()", "core:window:allow-close"],
    [".minimize()", "core:window:allow-minimize"],
    [".toggleMaximize()", "core:window:allow-toggle-maximize"],
    [".startDragging()", "core:window:allow-start-dragging"]
  ]);
  return [...permissionByCall]
    .filter(([call]) => source.includes(call))
    .map(([, permission]) => permission);
}

function extractGenerateHandlerCommands(source) {
  const marker = "tauri::generate_handler![";
  const start = source.indexOf(marker);
  if (start === -1) return [];
  const bodyStart = start + marker.length;
  const end = source.indexOf("]", bodyStart);
  if (end === -1) return [];
  return source
    .slice(bodyStart, end)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extractFunctionBody(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1) return "";
  const bodyStart = source.indexOf("{", start);
  if (bodyStart === -1) return "";
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  return "";
}

function extractUseEffectContaining(source, needle) {
  const needleIndex = source.indexOf(needle);
  if (needleIndex === -1) return "";
  const start = source.lastIndexOf("useEffect(() =>", needleIndex);
  if (start === -1) return "";
  const callStart = source.indexOf("(", start);
  if (callStart === -1) return "";
  let depth = 0;
  for (let index = callStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  return "";
}
