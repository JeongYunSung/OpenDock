import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "..", "..");
const readAppText = (...parts) => readFileSync(resolve(appRoot, ...parts), "utf8");
const readRepoText = (...parts) => readFileSync(resolve(repoRoot, ...parts), "utf8");
const readAppBinary = (...parts) => readFileSync(resolve(appRoot, ...parts));
const readSrc = (file) => readAppText("src", file);
const readTauri = (...parts) => readAppText("src-tauri", ...parts);
const readTauriSrc = (file) => readTauri("src", file);
const readJson = (...parts) => JSON.parse(readAppText(...parts));

const rust = readTauriSrc("lib.rs");
const cargoToml = readTauri("Cargo.toml");
const appMenuRust = readTauriSrc("app_menu.rs");
const commandOutputRust = readTauriSrc("command_output.rs");
const opendockRunnerRust = readTauriSrc("opendock_runner.rs");
const productUpdateRust = readTauriSrc("product_update.rs");
const registryRust = readTauriSrc("registry.rs");
const mainRust = readTauriSrc("main.rs");
const accountPanel = readSrc("account-panel.tsx");
const accountDocksController = readSrc("use-account-docks-controller.ts");
const app = readSrc("App.tsx");
const appMenu = readSrc("app-menu.tsx");
const appDialogs = readSrc("app-dialogs.tsx");
const commandLog = readSrc("command-log.ts");
const commandTask = readSrc("command-task.ts");
const commandTaskController = readSrc("use-command-task-controller.ts");
const catalogController = readSrc("use-catalog-controller.ts");
const data = readSrc("data.ts");
const dockData = readSrc("dock-data.ts");
const desktopUi = readSrc("desktop-ui.tsx");
const display = readSrc("display.tsx");
const dockPanels = readSrc("dock-panels.tsx");
const dockWorkspaceModel = readSrc("dock-workspace-model.ts");
const dockWorkspaceHook = readSrc("use-dock-workspace-model.ts");
const installedDockMetadata = readSrc("use-installed-dock-metadata.ts");
const installedPanel = readSrc("installed-panel.tsx");
const authController = readSrc("use-auth-controller.ts");
const dockCommandController = readSrc("use-dock-command-controller.ts");
const projectController = readSrc("use-project-controller.ts");
const projectRuntimeController = readSrc("use-project-runtime-controller.ts");
const productUpdateController = readSrc("use-product-update-controller.ts");
const desktopStateSync = readSrc("use-desktop-state-sync.ts");
const nativeEventBridge = readSrc("use-native-event-bridge.ts");
const navigationController = readSrc("use-navigation-controller.ts");
const responsivePageSize = readSrc("responsive-page-size.ts");
const registryClient = readSrc("registry-client.ts");
const shortcutController = readSrc("use-shortcut-controller.ts");
const titlebar = readSrc("titlebar.tsx");
const workspaceView = readSrc("workspace-view.tsx");
const workspaceShell = readSrc("workspace-shell.tsx");
const styles = readSrc("styles.css");
const tauriConfig = readJson("src-tauri", "tauri.conf.json");
const windowsIcon = readAppBinary("src-tauri", "icons", "icon.ico");
const prepareSidecars = readAppText("scripts", "prepare-sidecars.mjs");
const cli = readRepoText("packages", "cli", "src", "cli.ts");
const defaultCapability = readJson("src-tauri", "capabilities", "default.json");

const menuIds = unique([...appMenuRust.matchAll(/MenuItem::with_id\(\s*app,\s*"([^"]+)"/g)].map((match) => match[1]));
const frontendMenuCases = unique(
  [...extractFunctionBody(navigationController, "async function handleNativeMenu").matchAll(/case "([^"]+)":/g)].map(
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
const frontendRuntimeSources = [
  app,
  authController,
  dockCommandController,
  navigationController,
  projectController,
  projectRuntimeController,
  productUpdateController,
  shortcutController,
].join("\n");
const invokedCommands = unique([...frontendRuntimeSources.matchAll(/invoke(?:<[^>]+>)?\("([^"]+)"/g)].map((match) => match[1]));
const unregisteredInvokes = invokedCommands.filter((command) => !registeredCommands.includes(command));
const requiredWindowPermissions = requiredCoreWindowPermissions([app, titlebar].join("\n"));
const capabilityPermissions = defaultCapability.permissions ?? [];
const missingWindowPermissions = requiredWindowPermissions.filter(
  (permission) => !capabilityPermissions.includes(permission)
);
const forbiddenTitlebarDragCss = styles.includes("-webkit-app-region");
const menuListenerEffect = extractUseEffectContaining(nativeEventBridge, 'listen<string>("opendock-menu"');
const menuListenerUsesRef = menuListenerEffect.includes("handleNativeMenuRef.current");
const menuListenerHasEmptyDeps = /\},\s*\[\]\s*\)/.test(menuListenerEffect);
const blankProjectHasInFlightGuard =
  projectController.includes("if (blankProjectCreatingRef.current) return;") &&
  projectController.includes("blankProjectCreatingRef.current = true;") &&
  projectController.includes("blankProjectCreatingRef.current = false;");
const existingProjectPickerHasInFlightGuard =
  projectController.includes("if (existingProjectPickingRef.current) return;") &&
  projectController.includes("existingProjectPickingRef.current = true;") &&
  projectController.includes("existingProjectPickingRef.current = false;");
const projectRegistrationDeduplicatesPaths =
  projectController.includes("const projectsRef = useRef(projects)") &&
  projectController.includes("const existingProject = projectsRef.current.find((project) => project.path === path)") &&
  projectController.includes("setActiveProjectId(existingProject.id)") &&
  projectController.includes("projectsRef.current = [...projectsRef.current, project]") &&
  projectController.includes("setProjects(projectsRef.current)");
const logCommandBody = extractFunctionBody(rust, "fn opendock_log");
const logCommandIsNonStreaming =
  logCommandBody.includes("run_opendock_blocking") &&
  logCommandBody.includes('"log".to_string()') &&
  !logCommandBody.includes("run_opendock_streaming");
const appParsesHistoricalLogLines =
  commandLog.includes("function parseOpenDockHistoryLine") &&
  commandLog.includes("function formatHistoryTime") &&
  commandLog.includes("function formatLogTime") &&
  commandLog.includes("function commandLinesToStoredLogs") &&
  projectRuntimeController.includes("options.setLogs(commandLinesToStoredLogs(result.lines))");
const registryRequestsBypassCache =
  registryRust.includes("reqwest::header::CACHE_CONTROL") &&
  registryRust.includes("reqwest::header::PRAGMA") &&
  registryClient.includes('cache: "no-store"');
const desktopCatalogUsesLiveRegistry =
  catalogController.includes("const [catalogDocks, setCatalogDocks] = useState<Dock[]>([])") &&
  catalogController.includes(
    "requestCatalog(options.sortMode, options.searchQuery, options.catalogPage, options.catalogPageSize)"
  ) &&
  (data.includes("export function normalizeRegistryDock") ||
    dockData.includes("export function normalizeRegistryDock")) &&
  !data.includes("export const DOCKS") &&
  !data.includes("DOCKS.find");
const catalogRefreshPreservesSameRequestOnFailure =
  catalogController.includes("const loadedCatalogRequestKeyRef = useRef<string | null>(null)") &&
  catalogController.includes("const currentCatalogRequestKey = catalogRequestKey(options)") &&
  catalogController.includes("const requestKey = currentCatalogRequestKey") &&
  catalogController.includes("loadedCatalogRequestKeyRef.current = requestKey") &&
  catalogController.includes("if (loadedCatalogRequestKeyRef.current !== requestKey)") &&
  catalogController.includes("function catalogRequestKey(options: CatalogControllerOptions)") &&
  catalogController.includes("query: options.searchQuery.trim()");
const catalogRefreshSkipsStaleResponses =
  catalogController.includes("const currentCatalogRequestKeyRef = useRef(currentCatalogRequestKey)") &&
  catalogController.includes("currentCatalogRequestKeyRef.current = currentCatalogRequestKey") &&
  catalogController.includes("currentCatalogRequestKeyRef.current !== requestKey") &&
  catalogController.includes("if (cancelled || currentCatalogRequestKeyRef.current !== requestKey) return;");
const appClipboardEditingEnabled =
  appMenu.includes('id: "edit:copy"') &&
  appMenu.includes('id: "edit:paste"') &&
  appMenuRust.includes('"edit:copy"') &&
  appMenuRust.includes('"edit:paste"') &&
  appMenuRust.includes("CmdOrCtrl+C") &&
  appMenuRust.includes("CmdOrCtrl+V") &&
  navigationController.includes('case "edit:copy"') &&
  navigationController.includes('case "edit:paste"') &&
  navigationController.includes("navigator.clipboard.writeText") &&
  navigationController.includes("navigator.clipboard.readText");
const appTextSelectionEnabled =
  styles.includes(".app-root") &&
  styles.includes("user-select: text") &&
  styles.includes(".workspace-main") &&
  styles.includes(".readme-panel") &&
  styles.includes(".log-lines") &&
  styles.includes("button,") &&
  styles.includes("user-select: none");
const registryTauriRequestsHaveTimeout =
  registryClient.includes("function withRegistryRequestTimeout") &&
  registryClient.includes("REGISTRY_REQUEST_TIMEOUT_MS") &&
  registryClient.includes('invoke<RegistryDockSearchResponse>("opendock_catalog"') &&
  registryClient.includes('invoke<RegistryDockDetail>("opendock_dock_detail"') &&
  registryClient.includes('invoke<RegistryDockVersionsResponse>("opendock_dock_versions"') &&
  registryClient.includes('invoke<string>("opendock_registry_asset_data_url"') &&
  registryClient.includes("registry request timed out after");
const installedRowsUseRegistryMetadata =
  app.includes('import { useInstalledDockMetadata } from "./use-installed-dock-metadata"') &&
  app.includes("const installedMetadataDocks = useInstalledDockMetadata({") &&
  app.includes("installedMetadataDocks,") &&
  dockWorkspaceHook.includes("installedMetadataDocks: Dock[]") &&
  dockWorkspaceHook.includes("...options.installedMetadataDocks.filter") &&
  installedDockMetadata.includes("requestDockDetail(record.id)") &&
  installedDockMetadata.includes("normalizeRegistryDock(detail") &&
  installedDockMetadata.includes("mergeRegistryDockDetail");
const detailRefreshKeepsVersionTotalScoped =
  catalogController.includes('const activeDetailKeyRef = useRef(options.dockView === "detail" ? options.detailKey : "")') &&
  catalogController.includes("activeDetailKeyRef.current = options.dockView === \"detail\" ? options.detailKey : \"\"") &&
  catalogController.includes("if (activeDetailKeyRef.current === dockId)") &&
  catalogController.includes("setVersionTotal(versionsResponse.total ?? versions.length)");
const desktopCatalogUsesResponsivePaging =
  app.includes('import { useResponsivePageSizes } from "./responsive-page-size"') &&
  responsivePageSize.includes("function catalogPageLimitForViewport") &&
  responsivePageSize.includes("function versionPageLimitForViewport") &&
  responsivePageSize.includes("window.innerWidth, window.innerHeight") &&
  registryClient.includes('invoke<RegistryDockSearchResponse>("opendock_catalog",') &&
  registryClient.includes("page,") &&
  registryClient.includes("limit,") &&
  rust.includes("async fn opendock_catalog(") &&
  rust.includes("page: Option<u32>") &&
  rust.includes("limit: Option<u32>") &&
  rust.includes("bounded_limit(limit, DEFAULT_CATALOG_PAGE_LIMIT, MAX_CATALOG_PAGE_LIMIT)");
const desktopVersionsUseResponsivePaging =
  registryClient.includes('invoke<RegistryDockVersionsResponse>("opendock_dock_versions", { dockId, page, limit })') &&
  catalogController.includes(
    "requestDockVersions(dockFullId(options.baseDetail!), options.versionPage, options.versionPageSize)"
  ) &&
  rust.includes("async fn opendock_dock_versions(") &&
  rust.includes("DEFAULT_VERSION_PAGE_LIMIT") &&
  rust.includes("MAX_VERSION_PAGE_LIMIT");
const desktopUsesRegistryStars =
  (data.includes("stars: summary.stars ?? 0") ||
    dockData.includes("stars: summary.stars ?? 0")) &&
  dockData.includes("publisherOfficial: summary.publisher?.official ?? summary.official") &&
  dockPanels.includes("dockPublisherOfficial(props.dock)") &&
  data.includes('export type SortMode = "downloads" | "stars" | "recent" | "name"') &&
  dockPanels.includes("props.t.sortStars") &&
  desktopUi.includes("function StarButton") &&
  registryClient.includes('invoke<DockStarStatusResponse>("opendock_star_status", { ids })') &&
  rust.includes("async fn opendock_star_status") &&
  rust.includes("/v1/me/stars/status") &&
  rust.includes("async fn opendock_my_stars") &&
  rust.includes("load_auth_token()");
const desktopMyDocksUsesPaging =
  data.includes("export interface MyDocksCounts") &&
  registryClient.includes('invoke<MyDocksResponse>("opendock_my_docks", { page, limit })') &&
  app.includes("myDocksPageCount") &&
  accountPanel.includes("accountStatsFor(props.myDocksCounts, props.myStarredDocks.length)") &&
  rust.includes("async fn opendock_my_docks(page: Option<u32>, limit: Option<u32>)") &&
  rust.includes("DEFAULT_ACCOUNT_PAGE_LIMIT") &&
  rust.includes("MAX_ACCOUNT_PAGE_LIMIT");
const accountDocksSkipsStaleResponses =
  accountDocksController.includes("const loggedInRef = useRef(options.loggedIn)") &&
  accountDocksController.includes("const myDocksRequestRef = useRef(0)") &&
  accountDocksController.includes("const myStarsRequestRef = useRef(0)") &&
  accountDocksController.includes("function isCurrentAccountRequest") &&
  accountDocksController.includes("requestRef.current === requestId") &&
  accountDocksController.includes("if (!isCurrentAccountRequest(loggedInRef, myDocksRequestRef, requestId)) return;") &&
  accountDocksController.includes("if (!isCurrentAccountRequest(loggedInRef, myStarsRequestRef, requestId)) return;") &&
  accountDocksController.includes("if (!loggedInRef.current) return;");
const starToggleUsesSynchronousInFlightGuard =
  accountDocksController.includes('const starUpdatingRef = useRef("")') &&
  accountDocksController.includes("if (starUpdatingRef.current) return;") &&
  accountDocksController.includes("starUpdatingRef.current = dockId") &&
  accountDocksController.includes('starUpdatingRef.current = ""');
const shortcutImportExportUsesSingleFileDialog =
  shortcutController.includes("const shortcutFileWorkingRef = useRef(false)") &&
  (shortcutController.match(/if \(shortcutFileWorkingRef\.current\) return;/g) ?? []).length >= 2 &&
  (shortcutController.match(/shortcutFileWorkingRef\.current = true;/g) ?? []).length >= 2 &&
  (shortcutController.match(/shortcutFileWorkingRef\.current = false;/g) ?? []).length >= 2;
const desktopAccountProfileSyncsWithRegistry =
  data.includes("export interface AccountProfile") &&
  registryClient.includes('invoke<AccountProfile>("opendock_account_profile")') &&
  registryClient.includes('invoke<AccountProfile>("opendock_update_account_profile"') &&
  rust.includes("async fn opendock_account_profile()") &&
  rust.includes("async fn opendock_update_account_profile(nickname: String)") &&
  rust.includes("/v1/me/profile") &&
  rust.includes("request_registry_json_with_auth_body") &&
  app.includes("requestAccountProfile") &&
  app.includes("requestUpdateAccountProfile") &&
  app.includes("setAccountDisplayName(profile.displayName ?? \"\")") &&
  app.includes("setAccountAvatarUrl(profile.avatarUrl ?? null)") &&
  titlebar.includes("accountAvatarUrl: string | null") &&
  titlebar.includes("const showAccountAvatar = Boolean(props.accountAvatarUrl && !avatarFailed)") &&
  accountPanel.includes("accountDisplayName: string") &&
  accountPanel.includes("const profileName = props.nickname || props.accountDisplayName || props.accountEmail || props.t.opendockAccount") &&
  accountPanel.includes("const showAvatar = Boolean(props.accountAvatarUrl && !avatarFailed)") &&
  accountPanel.includes("<strong>{profileName}</strong>") &&
  !accountPanel.includes("<strong>opendock</strong>");
const accountProfileSkipsStaleLogoutResponses =
  app.includes("const accountProfileRequestRef = useRef(0)") &&
  app.includes("const loggedInRef = useRef(loggedIn)") &&
  app.includes("if (!loggedIn)") &&
  app.includes("accountProfileRequestRef.current += 1") &&
  app.includes("accountProfileRequestRef.current !== requestId || !loggedInRef.current");
const titlebarAvatarContentIsCentered =
  styles.includes(".avatar-button") &&
  styles.includes("flex: 0 0 28px;") &&
  styles.includes("padding: 0;") &&
  styles.includes("line-height: 1;") &&
  styles.includes(".avatar-button img") &&
  styles.includes("display: block;") &&
  styles.includes("object-position: center;");
const missingDatesDoNotUseFakeFallback =
  display.includes('if (!value) return "-";') &&
  !display.includes("Jun 14, 2026");
const dockIconUsesOpenDockLogoFallback =
  display.includes("const imageUrl = hasRegistryLogo ? logoUrl : logoSrc") &&
  display.includes('"fallback-logo"') &&
  styles.includes(".dock-icon.fallback-logo img") &&
  !app.includes("<Zap") &&
  !display.includes("<Zap");
const desktopInstalledSearchExists =
  app.includes('useStoredState("opendock.installedSearchQuery", "")') &&
  dockWorkspaceModel.includes("function matchesInstalledSearch") &&
  installedPanel.includes("props.t.installedSearch") &&
  installedPanel.includes("noInstalledSearchTitle");
const desktopStartsWithoutSampleLogs = data.includes("export const BASE_LOGS: AppLog[] = []");
const detailMergeUsesRegistryLatestVersion =
  data.includes("version: detail.latestVersion ?? base.version") ||
  dockData.includes("version: detail.latestVersion ?? base.version");
const installRefreshesDockBeforeResolvingRef = (() => {
  const installBody = extractFunctionBody(dockCommandController, "async function installDock");
  const refreshIndex = installBody.indexOf("await options.refreshDockDetail(dock)");
  const refIndex = installBody.indexOf("const dockRef = `${dockFullId(freshDock)}@${freshDock.version}`");
  return refreshIndex !== -1 && refIndex !== -1 && refreshIndex < refIndex;
})();
const dockCommandFallbackStateScopedToActiveProject =
  dockCommandController.includes("const activeProjectPathRef = useRef(options.activeProject?.path ?? null)") &&
  dockCommandController.includes("activeProjectPathRef.current = options.activeProject?.path ?? null") &&
  dockCommandController.includes("const targetProject = options.activeProject") &&
  dockCommandController.includes("if (activeProjectPathRef.current === targetProject.path)") &&
  dockCommandController.includes("if (activeProjectPathRef.current === retry.projectPath)");
const commandTaskRefUpdatesSynchronously =
  commandTaskController.includes('const value = typeof next === "function" ? next(commandTaskRef.current) : next;') &&
  commandTaskController.includes("commandTaskRef.current = value;") &&
  commandTaskController.includes("setCommandTaskState(value);") &&
  !commandTaskController.includes("setCommandTaskState((current)");
const dockCommandsRejectConcurrentStarts =
  dockCommandController.includes("function hasActiveCommandTask()") &&
  dockCommandController.includes("return isTaskActive(options.commandTaskRef.current)") &&
  (dockCommandController.match(/if \(hasActiveCommandTask\(\)\) return;/g) ?? []).length >= 4;
const desktopStateSavesAreSerialized =
  desktopStateSync.includes("const pendingSaveStateRef = useRef<DesktopAppState | null>(null)") &&
  desktopStateSync.includes("const savingStateRef = useRef(false)") &&
  desktopStateSync.includes("while (pendingSaveStateRef.current)") &&
  desktopStateSync.includes('await invoke("opendock_save_app_state", { state })') &&
  desktopStateSync.includes("pendingSaveStateRef.current = state") &&
  desktopStateSync.includes("void flushPendingSaveState()");
const installedViewPollsProjectState =
  projectRuntimeController.includes('options.dockView !== "installed"') &&
  projectRuntimeController.includes("refreshInstalledProjectState") &&
  projectRuntimeController.includes("window.setInterval(refreshInstalledProjectState, 5000)") &&
  projectRuntimeController.includes("await refreshProjectState(options.activeProject, { silent: true })");
const projectStateRefreshPreservesSameProjectOnFailure =
  projectRuntimeController.includes("const loadedProjectPathRef = useRef<string | null>(null)") &&
  projectRuntimeController.includes("loadedProjectPathRef.current = project.path") &&
  projectRuntimeController.includes("const canPreserveCurrentState = loadedProjectPathRef.current === project.path") &&
  projectRuntimeController.includes("if (!canPreserveCurrentState)") &&
  projectRuntimeController.includes("if (loadedProjectPathRef.current !== options.activeProject.path)") &&
  projectRuntimeController.includes("resetProjectRuntime();");
const projectStateRefreshSkipsStaleProjectResponses =
  projectRuntimeController.includes("const activeProjectPathRef = useRef<string | null>(activeProjectPath)") &&
  projectRuntimeController.includes("activeProjectPathRef.current = activeProjectPath") &&
  projectRuntimeController.includes("if (activeProjectPathRef.current !== project.path) return;") &&
  projectRuntimeController.includes("if (activeProjectPathRef.current === project.path) setProjectStateLoaded(true)");
const projectLogRefreshSkipsStaleProjectResponses =
  projectRuntimeController.includes('invoke<OpenDockCommandResult>("opendock_log", { projectDir: project.path })') &&
  projectRuntimeController.includes("if (activeProjectPathRef.current !== project.path) return;") &&
  projectRuntimeController.includes("options.setLogs(commandLinesToStoredLogs(result.lines))");
const outdatedRefreshPreservesCompatibleReportsOnFailure =
  projectRuntimeController.includes("preserveCompatibleOutdatedReports(current, records)") &&
  projectRuntimeController.includes("function preserveCompatibleOutdatedReports") &&
  projectRuntimeController.includes("installedVersions.get(dockId) === report.currentVersion");
const changeCommandsUseEvents =
  rust.includes('"install".to_string(),') &&
  rust.includes("dock_ref") &&
  rust.includes('"update".to_string()') &&
  rust.includes('"uninstall".to_string()') &&
  (rust.match(/"--events"\.to_string\(\)/g) ?? []).length >= 3;
const commandProgressBridge =
  opendockRunnerRust.includes('app.emit("opendock-command-progress"') &&
  opendockRunnerRust.includes("command_progress_from_event_line") &&
  nativeEventBridge.includes('listen<OpenDockCommandProgress>("opendock-command-progress"') &&
  nativeEventBridge.includes("handlers.applyCommandProgressToTask(progress)");
const commandLineEventsCarryAndFilterCommandIds =
  commandOutputRust.includes("#[serde(rename_all = \"camelCase\")]") &&
  commandOutputRust.includes("pub(crate) command_id: Option<String>") &&
  opendockRunnerRust.includes("command_id: command_id.map(str::to_string)") &&
  opendockRunnerRust.includes("command_id: command_id.clone()") &&
  data.includes("commandId?: string | null") &&
  commandTask.includes("if (line.commandId && line.commandId !== current.id) return current;");
const commandLineEventsFilterGlobalStaleLines =
  nativeEventBridge.includes("function isStaleCommandLine") &&
  nativeEventBridge.includes("line.commandId !== commandTaskRef.current?.id") &&
  nativeEventBridge.includes("line.commandId !== authCommandIdRef.current") &&
  nativeEventBridge.includes("if (isStaleCommandLine(line, handlers.commandTaskRef, handlers.authCommandIdRef)) return;") &&
  nativeEventBridge.indexOf("if (isStaleCommandLine(line, handlers.commandTaskRef, handlers.authCommandIdRef)) return;") <
    nativeEventBridge.indexOf("handlers.appendLog(line.level, logColor(line.level), line.message)");
const noUpdateProgressDoesNotDuplicatePopupRows =
  commandTask.includes("function isNoUpdateProgress") &&
  commandTask.includes("const suppressProgressRow = isNoUpdateProgress(progress)") &&
  commandTask.includes("step: suppressProgressRow ? current.step : progress.message") &&
  commandTask.includes("!suppressProgressRow &&") &&
  commandTask.includes('progress.message === "No OpenDock dock updates available."');
const commandFailureProgressDoesNotDuplicatePopupRows =
  commandTask.includes("function commandRowsContainMessage") &&
  commandTaskController.includes("!commandRowsContainMessage(currentRows, result.message)") &&
  commandTask.includes("const hasSpecificError = status === \"error\"") &&
  opendockRunnerRust.includes("should_emit_empty_stream_message(&stdout, &stderr)") &&
  commandOutputRust.includes("stdout.trim().is_empty() && stderr.trim().is_empty()");
const commandProgressDialogCanCancelRunningCommands =
  appDialogs.includes("onCancel: () => void") &&
  appDialogs.includes('const canCancel = props.commandTask.status === "running"') &&
  appDialogs.includes("disabled={!canCancel}") &&
  appDialogs.includes("onClick={props.onCancel}") &&
  appDialogs.includes("{!active ? (") &&
  appDialogs.includes("onClick={props.onClose}") &&
  app.includes("onCancelCommand={() => void cancelCommandTask()}") &&
  !workspaceView.includes("onCancelCommand");
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
  commandLog.includes("const MAX_STORED_LOGS = 5000") &&
  commandLog.includes("lines.slice(-MAX_STORED_LOGS)") &&
  commandLog.includes("current.length - (MAX_STORED_LOGS - 1)");
const logPanelUsesAvailableHeight =
  styles.includes(".logs-panel {\n  display: flex;\n  min-height: 0;\n  flex-direction: column;\n  overflow: hidden;") &&
  styles.includes(".log-shell {\n  display: flex;\n  min-height: 0;\n  flex: 1;\n  flex-direction: column;\n  overflow: clip;") &&
  styles.includes(".log-lines {\n  min-height: 0;\n  flex: 1;\n  overflow: auto;") &&
  styles.includes("max-height: none;");
const logTimestampsDoNotWrap =
  styles.includes("grid-template-columns: 20ch 48px max-content;") &&
  styles.includes("grid-template-columns: 20ch 38px max-content;") &&
  styles.includes(".log-lines span {\n  color: var(--neutral-400);\n  white-space: nowrap;") &&
  styles.includes(".command-progress-log span {\n  color: var(--text-3);\n  white-space: nowrap;");
const logTimestampsAlwaysIncludeFullDate =
  commandLog.includes("return formatLogTime(new Date());") &&
  commandLog.includes("return formatLogTime(date);") &&
  commandLog.includes("date.getFullYear()") &&
  commandLog.includes("date.getSeconds()") &&
  !commandLog.includes("sameDay");
const titlebarUsesNativeDragFallback =
  titlebar.includes("getCurrentWindow().startDragging()") &&
  titlebar.includes("function isInteractiveTitlebarTarget") &&
  titlebar.includes("onMouseDown={startDrag}");
const authFailuresAreVisible =
  authController.includes("const [authMessage, setAuthMessage]") &&
  authController.includes("commandFailureMessage(result, options.t.signInFailed)") &&
  workspaceShell.includes("className=\"signin-status\"");
const authRequestsAreScopedAndCancelable =
  authController.includes("const authCommandIdRef = useRef<string | null>(null)") &&
  authController.includes("const authRequestRef = useRef(0)") &&
  authController.includes("const authWorkingRef = useRef(false)") &&
  authController.includes("if (authWorkingRef.current) return;") &&
  authController.includes('invoke<OpenDockCommandResult>("opendock_auth_login", { provider, commandId })') &&
  authController.includes('await invoke("opendock_cancel_command", { commandId })') &&
  authController.includes("!session.loggedIn || !session.email") &&
  rust.includes("command_id: Option<String>") &&
  extractFunctionBody(rust, "fn opendock_auth_login").includes("command_id,") &&
  app.includes("authCommandIdRef,") &&
  nativeEventBridge.includes("authCommandIdRef: MutableRefObject<string | null>");
const sidecarBuildsStandalone =
  prepareSidecars.includes('"--compile"') &&
  prepareSidecars.includes("assertStandaloneSidecar") &&
  prepareSidecars.includes("OpenDock sidecar must be standalone") &&
  prepareSidecars.includes("assertSidecarCliRuns") &&
  prepareSidecars.includes("sidecarSmokeTestEnv") &&
  prepareSidecars.includes('PATH: "/usr/bin:/bin:/usr/sbin:/sbin"');
const compiledCliCanStart = cli.includes("(import.meta as ImportMeta & { main?: boolean }).main === true");
const macosOpenUsesAbsolutePath =
  opendockRunnerRust.includes('Command::new("/usr/bin/open")') ||
  opendockRunnerRust.includes('command_without_window("/usr/bin/open")');
const desktopAppMenuUsesNativeCommands =
  titlebar.includes('export type OpenMenu = "" | "app" | "lang" | "account" | "sort"') &&
  appMenu.includes("function appMenuGroups") &&
  titlebar.includes("<AppMenu") &&
  titlebar.includes('props.openMenu === "app"') &&
  app.includes("onAppMenuCommand") &&
  navigationController.includes("await handleNativeMenu(id)");
const nativeDockCommandsRequireDetailView =
  navigationController.includes('if (options.detail && options.dockView === "detail") await options.installDock(options.detail);') &&
  navigationController.includes('if (options.detail && options.dockView === "detail") await options.deleteDock(options.detail);');
const menuOutsideClickDoesNotBlockTargetClicks =
  app.includes('document.addEventListener("pointerdown", closeOpenMenuFromOutside, true)') &&
  app.includes("function isOpenMenuTarget") &&
  app.includes(".menu-anchor,.app-menu-anchor,.dropdown-menu,.app-menu-panel,.app-menu-flyout") &&
  !app.includes("className=\"menu-overlay\"") &&
  !styles.includes(".menu-overlay");
const desktopAppMenuHiddenOnMac =
  titlebar.includes("const isMac = props.windowControlPlatform === \"macos\"") &&
  titlebar.includes("{!isMac ? (") &&
  titlebar.includes("<AppMenu");
const desktopAppMenuUsesSingleActiveFlyout =
  appMenu.includes("const [activeGroupKey, setActiveGroupKey]") &&
  appMenu.includes("app-menu-group ${activeGroupKey === group.key ? \"active\" : \"\"}") &&
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
  opendockRunnerRust.includes("fn command_without_window") &&
  opendockRunnerRust.includes("fn apply_no_console_window(command: &mut Command)") &&
  opendockRunnerRust.includes("const CREATE_NO_WINDOW: u32 = 0x08000000") &&
  opendockRunnerRust.includes("command.creation_flags(CREATE_NO_WINDOW)") &&
  !opendockRunnerRust.includes("Command::new(\"taskkill\")") &&
  !opendockRunnerRust.includes("Command::new(\"explorer\")") &&
  !opendockRunnerRust.includes("Command::new(\"opendock\")");
const appUpdateStopsRunningSidecars =
  opendockRunnerRust.includes("struct RunningCommandState") &&
  opendockRunnerRust.includes("pids: HashSet<u32>") &&
  opendockRunnerRust.includes("fn drain_pids(&mut self) -> Vec<u32>") &&
  opendockRunnerRust.includes("pub(crate) fn terminate_all_running_commands") &&
  productUpdateRust.includes("stop_running_commands_before_update(&app)?") &&
  productUpdateRust.includes("stop_running_commands_before_update(&finish_cleanup_app)");
const productUpdateCheckSkipsStaleResponses =
  productUpdateController.includes("const checkRequestRef = useRef(0)") &&
  productUpdateController.includes("const requestId = ++checkRequestRef.current") &&
  productUpdateController.includes("checkRequestRef.current !== requestId");
const productUpdateInstallIsSingleFlight =
  productUpdateController.includes("const installingProductUpdateRef = useRef(false)") &&
  productUpdateController.includes("if (installingProductUpdateRef.current) return;") &&
  productUpdateController.includes("installingProductUpdateRef.current = true") &&
  productUpdateController.includes("installingProductUpdateRef.current = false") &&
  productUpdateController.includes("checkRequestRef.current !== requestId || installingProductUpdateRef.current");
const appUsesSingleInstance =
  cargoToml.includes("tauri-plugin-single-instance") &&
  rust.includes("tauri_plugin_single_instance::init") &&
  rust.includes("focus_existing_main_window") &&
  rust.includes('app.get_webview_window("main")') &&
  rust.includes("window.unminimize()") &&
  rust.includes("window.set_focus()");
const appFocusesMainWindowOnStartup =
  rust.includes(".setup(|app|") &&
  rust.includes("focus_existing_main_window(app.handle())");
const macosInactiveWindowClicksReachWebview =
  tauriConfig.app?.windows?.some((window) => window.acceptFirstMouse === true) === true;

const failures = [
  ...unhandledMenuIds.map((id) => `menu id is not handled in the navigation controller: ${id}`),
  ...staleMenuCases.map((id) => `navigation controller handles a menu id not created by Rust: ${id}`),
  ...unregisteredInvokes.map((command) => `Tauri command is invoked but not registered: ${command}`),
  ...missingWindowPermissions.map((permission) => `window control permission is missing: ${permission}`),
  ...(!menuListenerEffect ? ["opendock-menu listener is missing from the native event bridge"] : []),
  ...(menuListenerEffect && !menuListenerUsesRef
    ? ["opendock-menu listener must dispatch through handleNativeMenuRef to avoid stale duplicate listeners"]
    : []),
  ...(menuListenerEffect && !menuListenerHasEmptyDeps
    ? ["opendock-menu listener must be registered once with an empty dependency array"]
    : []),
  ...(!blankProjectHasInFlightGuard
    ? ["createBlankProject must keep an in-flight guard to prevent duplicate native menu project creation"]
    : []),
  ...(!existingProjectPickerHasInFlightGuard
    ? ["addExistingProjectFromFolder must keep an in-flight guard to prevent duplicate native folder pickers"]
    : []),
  ...(!projectRegistrationDeduplicatesPaths
    ? ["project registration must activate an existing matching path instead of duplicating it"]
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
  ...(!catalogRefreshPreservesSameRequestOnFailure
    ? ["catalog refresh failures must preserve the current request's loaded docks"]
    : []),
  ...(!catalogRefreshSkipsStaleResponses
    ? ["catalog refresh must skip stale responses after search, sort, page, or page-size changes"]
    : []),
  ...(!appClipboardEditingEnabled
    ? ["desktop edit menus must expose copy/paste and route them to selected text or active inputs"]
    : []),
  ...(!appTextSelectionEnabled
    ? ["desktop app text should be selectable while interactive controls remain non-selectable"]
    : []),
  ...(!registryTauriRequestsHaveTimeout
    ? ["Tauri registry requests must time out so catalog/detail/logo loading cannot spin forever"]
    : []),
  ...(!installedRowsUseRegistryMetadata
    ? ["installed rows must enrich lockfile records with registry metadata so logos do not depend on the current catalog page"]
    : []),
  ...(!detailRefreshKeepsVersionTotalScoped
    ? ["manual dock detail refresh must not overwrite version pagination for a different active detail"]
    : []),
  ...(!desktopCatalogUsesResponsivePaging
    ? ["desktop catalog must send responsive page/limit values to registry"]
    : []),
  ...(!desktopVersionsUseResponsivePaging
    ? ["desktop dock versions must send responsive page/limit values to registry"]
    : []),
  ...(!desktopUsesRegistryStars
    ? ["desktop app must surface registry star counts and authenticated star actions"]
    : []),
  ...(!desktopMyDocksUsesPaging
    ? ["desktop account My Docks must use paginated registry responses and total counts"]
    : []),
  ...(!accountDocksSkipsStaleResponses
    ? ["desktop account docks and stars must ignore stale responses after logout or page changes"]
    : []),
  ...(!starToggleUsesSynchronousInFlightGuard
    ? ["dock star toggles must use a synchronous in-flight guard to prevent duplicate rapid requests"]
    : []),
  ...(!shortcutImportExportUsesSingleFileDialog
    ? ["shortcut import/export must be single-flight so native file dialogs cannot overlap"]
    : []),
  ...(!desktopAccountProfileSyncsWithRegistry
    ? ["desktop account profile must load and save nickname through registry profile APIs"]
    : []),
  ...(!accountProfileSkipsStaleLogoutResponses
    ? ["desktop account profile requests must ignore stale responses after logout or newer profile requests"]
    : []),
  ...(!titlebarAvatarContentIsCentered
    ? ["titlebar account avatar must remove button padding and center avatar content"]
    : []),
  ...(!missingDatesDoNotUseFakeFallback
    ? ["missing registry dates must render as unavailable instead of a fake hard-coded date"]
    : []),
  ...(!dockIconUsesOpenDockLogoFallback
    ? ["dock icons must use the OpenDock logo while registry logos are loading or unavailable"]
    : []),
  ...(!desktopInstalledSearchExists
    ? ["installed view must provide local search over installed docks"]
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
  ...(!dockCommandFallbackStateScopedToActiveProject
    ? ["dock install/delete commands must only mutate fallback installed state for the still-active project"]
    : []),
  ...(!commandTaskRefUpdatesSynchronously
    ? ["command task ref must update synchronously before React state renders to avoid dropped progress and duplicate starts"]
    : []),
  ...(!dockCommandsRejectConcurrentStarts
    ? ["dock commands must reject new install/update/delete/doctor starts while another command is active"]
    : []),
  ...(!desktopStateSavesAreSerialized
    ? ["desktop app state saves must be serialized so stale writes cannot overwrite newer project state"]
    : []),
  ...(!installedViewPollsProjectState
    ? ["installed view must refresh project outdated state while visible and after update"]
    : []),
  ...(!projectStateRefreshPreservesSameProjectOnFailure
    ? ["project state refresh failures must preserve installed docks for the current workspace"]
    : []),
  ...(!projectStateRefreshSkipsStaleProjectResponses
    ? ["project state refresh must ignore stale responses after active workspace changes"]
    : []),
  ...(!projectLogRefreshSkipsStaleProjectResponses
    ? ["project log refresh must ignore stale responses after active workspace changes"]
    : []),
  ...(!outdatedRefreshPreservesCompatibleReportsOnFailure
    ? ["outdated refresh failures must preserve compatible update reports"]
    : []),
  ...(!changeCommandsUseEvents
    ? ["install/update/uninstall app commands must use --events for structured progress"]
    : []),
  ...(!commandProgressBridge
    ? ["desktop app must bridge opendock progress events into the command progress dialog"]
    : []),
  ...(!commandLineEventsCarryAndFilterCommandIds
    ? ["command line events must carry commandId and task updates must ignore lines from other commands"]
    : []),
  ...(!commandLineEventsFilterGlobalStaleLines
    ? ["command line events with stale commandId must not update global logs or auth status text"]
    : []),
  ...(!noUpdateProgressDoesNotDuplicatePopupRows
    ? ["no-update progress events must not duplicate final update result rows in the command popup"]
    : []),
  ...(!commandFailureProgressDoesNotDuplicatePopupRows
    ? ["failure progress events must not duplicate final command error rows in the command popup"]
    : []),
  ...(!commandProgressDialogCanCancelRunningCommands
    ? ["command progress dialog must expose the running command cancel action and not leave an unused workspace prop"]
    : []),
  ...(!blockingCliCommandsUseBackgroundRuntime
    ? ["blocking OpenDock commands must run through the background runtime"]
    : []),
  ...(!logStorageIsCapped ? ["app logs must be capped before rendering and persisting"] : []),
  ...(!logPanelUsesAvailableHeight ? ["app logs panel must fill and shrink with available panel height"] : []),
  ...(!logTimestampsDoNotWrap ? ["app log timestamps must not wrap when historical dates are shown"] : []),
  ...(!logTimestampsAlwaysIncludeFullDate ? ["app log timestamps must always include year, date, and time"] : []),
  ...(!titlebarUsesNativeDragFallback
    ? ["custom titlebar must call startDragging with an interactive-target guard for packaged apps"]
    : []),
  ...(!authFailuresAreVisible
    ? ["auth login failures must be surfaced on the sign-in screen instead of being swallowed"]
    : []),
  ...(!authRequestsAreScopedAndCancelable
    ? ["auth login must use scoped command ids, reject duplicate starts, validate session state, and cancel pending login on logout"]
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
  ...(!nativeDockCommandsRequireDetailView
    ? ["native dock install/delete commands must only run while a dock detail view is active"]
    : []),
  ...(!menuOutsideClickDoesNotBlockTargetClicks
    ? ["open menus must close from document capture without rendering a full-screen overlay that swallows target clicks"]
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
  ...(!appUpdateStopsRunningSidecars
    ? ["app update must stop running OpenDock sidecars before invoking the Windows installer"]
    : []),
  ...(!productUpdateCheckSkipsStaleResponses
    ? ["product update checks must ignore stale responses when automatic and manual checks overlap"]
    : []),
  ...(!productUpdateInstallIsSingleFlight
    ? ["product update install must be single-flight and block stale update checks while installing"]
    : []),
  ...(!appUsesSingleInstance ? ["desktop app must enforce a single process instance and refocus the main window"] : []),
  ...(!appFocusesMainWindowOnStartup
    ? ["desktop app must focus the main window on startup so updater restarts do not require an activation click"]
    : []),
  ...(!macosInactiveWindowClicksReachWebview
    ? ["macOS window must set acceptFirstMouse so the first inactive-window click reaches the webview"]
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
    .map((entry) => entry.split("::").at(-1))
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
