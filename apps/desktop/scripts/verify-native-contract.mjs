import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rust = readFileSync(resolve(appRoot, "src-tauri", "src", "lib.rs"), "utf8");
const mainRust = readFileSync(resolve(appRoot, "src-tauri", "src", "main.rs"), "utf8");
const app = readFileSync(resolve(appRoot, "src", "App.tsx"), "utf8");
const data = readFileSync(resolve(appRoot, "src", "data.ts"), "utf8");
const styles = readFileSync(resolve(appRoot, "src", "styles.css"), "utf8");
const tauriConfig = JSON.parse(readFileSync(resolve(appRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const windowsIcon = readFileSync(resolve(appRoot, "src-tauri", "icons", "icon.ico"));
const prepareSidecars = readFileSync(resolve(appRoot, "scripts", "prepare-sidecars.mjs"), "utf8");
const cli = readFileSync(resolve(appRoot, "..", "..", "packages", "cli", "src", "cli.ts"), "utf8");
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
  logCommandBody.includes("run_opendock_blocking") &&
  logCommandBody.includes('"log".to_string()') &&
  !logCommandBody.includes("run_opendock_streaming");
const appParsesHistoricalLogLines =
  app.includes("function parseOpenDockHistoryLine") &&
  app.includes("setLogs(result.lines.slice(-MAX_STORED_LOGS).map(commandLineLogEntry))");
const registryRequestsBypassCache =
  rust.includes("reqwest::header::CACHE_CONTROL") &&
  rust.includes("reqwest::header::PRAGMA") &&
  app.includes('cache: "no-store"');
const desktopCatalogUsesLiveRegistry =
  app.includes("const [catalogDocks, setCatalogDocks] = useState<Dock[]>([])") &&
  app.includes("requestCatalog(sortMode, searchQuery)") &&
  data.includes("export function normalizeRegistryDock") &&
  !data.includes("export const DOCKS") &&
  !data.includes("DOCKS.find");
const desktopStartsWithoutSampleLogs = data.includes("export const BASE_LOGS: AppLog[] = []");
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
  rust.includes('"install".to_string(),') &&
  rust.includes("dock_ref") &&
  rust.includes('"update".to_string()') &&
  rust.includes('"uninstall".to_string()') &&
  (rust.match(/"--events"\.to_string\(\)/g) ?? []).length >= 3;
const commandProgressBridge =
  rust.includes('app.emit("opendock-command-progress"') &&
  rust.includes("command_progress_from_event_line") &&
  app.includes('listen<OpenDockCommandProgress>("opendock-command-progress"') &&
  app.includes("applyCommandProgressToTask(progress)");
const blockingCliCommandsUseBackgroundRuntime = [
  "opendock_install",
  "opendock_update",
  "opendock_outdated",
  "opendock_uninstall",
  "opendock_doctor",
  "opendock_log",
  "opendock_auth_login",
  "opendock_auth_status",
  "opendock_auth_session",
  "opendock_auth_logout",
  "opendock_project_state",
].every((signature) => {
  const body = extractFunctionBody(rust, `fn ${signature}`);
  return body.includes("run_opendock_blocking") || body.includes("run_opendock_streaming_blocking");
});
const logStorageIsCapped =
  app.includes("const MAX_STORED_LOGS = 400") &&
  app.includes("result.lines.slice(-MAX_STORED_LOGS)") &&
  app.includes("current.length - (MAX_STORED_LOGS - 1)");
const titlebarUsesNativeDragFallback =
  app.includes("getCurrentWindow().startDragging()") &&
  app.includes("function isInteractiveTitlebarTarget") &&
  app.includes("onMouseDown={startDrag}");
const authFailuresAreVisible =
  app.includes("const [authMessage, setAuthMessage]") &&
  app.includes("commandFailureMessage(result, t.signInFailed)") &&
  app.includes("className=\"signin-status\"");
const sidecarBuildsStandalone =
  prepareSidecars.includes('"--compile"') &&
  prepareSidecars.includes("assertStandaloneSidecar") &&
  prepareSidecars.includes("OpenDock sidecar must be standalone") &&
  prepareSidecars.includes("assertSidecarCliRuns") &&
  prepareSidecars.includes("sidecarSmokeTestEnv") &&
  prepareSidecars.includes('PATH: "/usr/bin:/bin:/usr/sbin:/sbin"');
const compiledCliCanStart = cli.includes("(import.meta as ImportMeta & { main?: boolean }).main === true");
const macosOpenUsesAbsolutePath =
  rust.includes('Command::new("/usr/bin/open")') || rust.includes('command_without_window("/usr/bin/open")');
const desktopAppMenuUsesNativeCommands =
  app.includes('type OpenMenu = "" | "app" | "lang" | "account" | "sort"') &&
  app.includes("function appMenuGroups") &&
  app.includes("<AppMenu") &&
  app.includes('props.openMenu === "app"') &&
  app.includes("onAppMenuCommand") &&
  app.includes("await handleNativeMenu(id)");
const desktopAppMenuHiddenOnMac =
  app.includes("const isMac = props.windowControlPlatform === \"macos\"") &&
  app.includes("{!isMac ? (") &&
  app.includes("<AppMenu");
const desktopAppMenuUsesSingleActiveFlyout =
  app.includes("const [activeGroupKey, setActiveGroupKey]") &&
  app.includes("app-menu-group ${activeGroupKey === group.key ? \"active\" : \"\"}") &&
  styles.includes(".app-menu-group.active > .app-menu-flyout") &&
  !styles.includes(".app-menu-group:hover > .app-menu-flyout") &&
  !styles.includes(".app-menu-group:focus-within > .app-menu-flyout");
const requiredWindowsIconSizes = ["16x16", "32x32", "48x48", "64x64", "128x128", "256x256"];
const windowsIconSizes = parseIcoSizes(windowsIcon).map(({ width, height }) => `${width}x${height}`);
const windowsIconIncludesRequiredSizes = requiredWindowsIconSizes.every((size) => windowsIconSizes.includes(size));
const windowsInstallerUsesOpenDockIcon =
  tauriConfig.bundle?.windows?.nsis?.installerIcon === "icons/icon.ico" &&
  tauriConfig.bundle?.windows?.nsis?.uninstallerIcon === "icons/icon.ico";
const windowsReleaseAppHidesConsole =
  mainRust.includes('cfg_attr(not(debug_assertions), windows_subsystem = "windows")');
const windowsChildCommandsHideConsole =
  rust.includes("fn command_without_window") &&
  rust.includes("fn apply_no_console_window(command: &mut Command)") &&
  rust.includes("const CREATE_NO_WINDOW: u32 = 0x08000000") &&
  rust.includes("command.creation_flags(CREATE_NO_WINDOW)") &&
  !rust.includes("Command::new(\"taskkill\")") &&
  !rust.includes("Command::new(\"explorer\")") &&
  !rust.includes("Command::new(\"opendock\")");

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
  ...(!desktopCatalogUsesLiveRegistry
    ? ["desktop catalog must use live registry responses instead of static dock fixtures"]
    : []),
  ...(!desktopStartsWithoutSampleLogs
    ? ["desktop logs must start empty instead of shipping sample command history"]
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
  ...(!blockingCliCommandsUseBackgroundRuntime
    ? ["blocking opendock CLI commands must run through the background runtime"]
    : []),
  ...(!logStorageIsCapped ? ["app logs must be capped before rendering and persisting"] : []),
  ...(!titlebarUsesNativeDragFallback
    ? ["custom titlebar must call startDragging with an interactive-target guard for packaged apps"]
    : []),
  ...(!authFailuresAreVisible
    ? ["auth login failures must be surfaced on the sign-in screen instead of being swallowed"]
    : []),
  ...(!sidecarBuildsStandalone
    ? ["desktop sidecar must be compiled as a standalone binary and reject bun shebang scripts"]
    : []),
  ...(!compiledCliCanStart
    ? ["CLI entrypoint must honor import.meta.main so Bun-compiled sidecars execute run()"]
    : []),
  ...(!macosOpenUsesAbsolutePath
    ? ["macOS open calls must use /usr/bin/open for Finder-launched app environments"]
    : []),
  ...(!desktopAppMenuUsesNativeCommands
    ? ["desktop app menu must expose existing native menu commands through the titlebar"]
    : []),
  ...(!desktopAppMenuHiddenOnMac
    ? ["desktop app menu must be hidden on macOS and visible on non-macOS titlebars"]
    : []),
  ...(!desktopAppMenuUsesSingleActiveFlyout
    ? ["desktop app menu flyouts must be controlled by one active group instead of CSS hover/focus state"]
    : []),
  ...(!windowsIconIncludesRequiredSizes
    ? [`Windows icon.ico must include ${requiredWindowsIconSizes.join(", ")}; got ${windowsIconSizes.join(", ")}`]
    : []),
  ...(!windowsInstallerUsesOpenDockIcon
    ? ["Windows NSIS installer and uninstaller must explicitly use icons/icon.ico"]
    : []),
  ...(!windowsReleaseAppHidesConsole ? ["Windows release app must hide the launcher console window"] : []),
  ...(!windowsChildCommandsHideConsole ? ["Windows child commands must use CREATE_NO_WINDOW"] : []),
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

function parseIcoSizes(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    return [];
  }
  const count = buffer.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    if (offset + 16 > buffer.length) break;
    const width = buffer.readUInt8(offset) || 256;
    const height = buffer.readUInt8(offset + 1) || 256;
    sizes.push({ width, height });
  }
  return sizes;
}

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
