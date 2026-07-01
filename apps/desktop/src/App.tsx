import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  BASE_LOGS,
  type AppLog,
  type DockView,
  type Lang,
  type SortMode,
  TEXT,
  type Theme
} from "./data";
import {
  appendStoredLog,
  normalizeStoredLogs,
} from "./command-log";
import { AppNotice, type AppNoticeKind, type AppNoticeOptions, type AppNoticeState } from "./app-notice";
import { AppOverlays } from "./app-overlays";
import { ProjectEmpty, ProjectLoading, SignInScreen } from "./workspace-shell";
import { useResponsivePageSizes } from "./responsive-page-size";
import { requestAccountProfile, requestUpdateAccountProfile } from "./registry-client";
import { isTauriRuntime } from "./tauri-runtime";
import { useStoredState } from "./use-stored-state";
import { useAccountDocksController } from "./use-account-docks-controller";
import { useAuthController } from "./use-auth-controller";
import { useCatalogController, useDockDetailController } from "./use-catalog-controller";
import { useCommandTaskController } from "./use-command-task-controller";
import { useDesktopStateSync } from "./use-desktop-state-sync";
import { useDockCommandController } from "./use-dock-command-controller";
import { useDockWorkspaceModel } from "./use-dock-workspace-model";
import { useNativeEventBridge } from "./use-native-event-bridge";
import { useNavigationController } from "./use-navigation-controller";
import { usePaginationGuards } from "./use-pagination-guards";
import { useProjectController } from "./use-project-controller";
import { useProjectRuntimeController } from "./use-project-runtime-controller";
import { useProductUpdateController } from "./use-product-update-controller";
import { useShortcutController } from "./use-shortcut-controller";
import { Titlebar, type OpenMenu } from "./titlebar";
import { ACCOUNT_PAGE_LIMIT, Workspace } from "./workspace-view";

export function App() {
  const [theme, setTheme] = useStoredState<Theme>("opendock.theme", "light");
  const [lang, setLang] = useStoredState<Lang>("opendock.lang", "ko");
  const t = TEXT[lang];
  const [loggedIn, setLoggedIn] = useStoredState("opendock.loggedIn", false);
  const [appVersion, setAppVersion] = useState("");
  const [appNotice, setAppNotice] = useState<AppNoticeState | null>(null);
  const appNoticeIdRef = useRef(0);
  const [authProvider, setAuthProvider] = useStoredState("opendock.authProvider", "");
  const [openMenu, setOpenMenu] = useState<OpenMenu>("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [sortMode, setSortMode] = useStoredState<SortMode>("opendock.sortMode", "downloads");
  const [searchQuery, setSearchQuery] = useStoredState("opendock.searchQuery", "");
  const [installedSearchQuery, setInstalledSearchQuery] = useStoredState("opendock.installedSearchQuery", "");
  const [dockView, setDockView] = useStoredState<DockView>("opendock.dockView", "list");
  const [detailId, setDetailId] = useStoredState("opendock.detailId", "");
  const [detailTab, setDetailTab] = useStoredState<"readme" | "versions">("opendock.detailTab", "readme");
  const [detailVersion, setDetailVersion] = useStoredState("opendock.detailVersion", "");
  const [catalogPage, setCatalogPage] = useState(1);
  const [versionPage, setVersionPage] = useState(1);
  const [installedDocks, setInstalledDocks] = useStoredState<Record<string, boolean>>("opendock.installedDocks", {});
  const [logs, setLogs] = useStoredState<AppLog[]>("opendock.logs", BASE_LOGS, {
    defer: true,
    normalize: (value) => normalizeStoredLogs(value, BASE_LOGS),
  });
  const {
    applyCommandLineToTask,
    applyCommandProgressToTask,
    appendCommandResultLog,
    beginCommandTask,
    closeCommandProgress,
    commandTask,
    commandTaskRef,
    finishCommandResult,
    finishCommandTask,
    setCommandTask,
  } = useCommandTaskController(t);
  const [nickname, setNickname] = useStoredState("opendock.nickname", "");
  const [accountEmail, setAccountEmail] = useStoredState("opendock.accountEmail", "");
  const [accountDisplayName, setAccountDisplayName] = useState("");
  const [accountAvatarUrl, setAccountAvatarUrl] = useState<string | null>(null);
  const [accountOfficial, setAccountOfficial] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [appStateLoaded, setAppStateLoaded] = useState(!isTauriRuntime());
  const responsivePageSizes = useResponsivePageSizes();
  const catalogPageSize = responsivePageSizes.catalog;
  const versionPageSize = responsivePageSizes.versions;
  const {
    catalogDocks,
    catalogTotal,
    refreshCatalogFromRegistry,
    setCatalogDocks,
  } = useCatalogController({
    appendLog,
    catalogPage,
    catalogPageSize,
    searchQuery,
    sortMode,
  });
  const {
    exportShortcuts,
    importShortcuts,
    resetAllShortcuts,
    resetShortcut,
    shortcutBindings,
    shortcutPlatform,
    shortcutStatus,
    updateShortcut,
    windowControlPlatform,
  } = useShortcutController(lang, t);

  const {
    activeProjectId,
    addExistingProjectFromFolder,
    closeProjectDelete,
    closeProjectRename,
    confirmProjectDelete,
    createBlankProject,
    deleteProjectName,
    openDeleteProject,
    openRenameProject,
    projectAddOpen,
    projectDeleteOpen,
    projectRenameOpen,
    projects,
    projectSidebarCollapsed,
    renameProjectName,
    resetProjectDialogs,
    saveProjectRename,
    setActiveProjectId,
    setProjectAddOpen,
    setProjectDeleteOpen,
    setProjectRenameOpen,
    setProjects,
    setProjectSidebarCollapsed,
    setRenameProjectName,
  } = useProjectController({
    appendLog,
    resetDockWorkspaceView,
    setOpenMenu,
  });

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId]
  );
  const projectPathLabel = activeProject ? activeProject.path : t.noProjectPath;
  const {
    installedRecords,
    outdatedReportsById,
    projectStateLoaded,
    refreshProjectLogs,
    refreshProjectState,
    resetProjectRuntime,
  } = useProjectRuntimeController({
    activeProject,
    appendLog,
    commandTaskRef,
    dockView,
    setInstalledDocks,
    setLogs,
  });
  const {
    activeInstalledDocks,
    allKnownDocks,
    baseDetail,
    detailKey,
    filteredInstalledRows,
    installedRows,
    sortedDocks,
    updateAvailableCount,
  } = useDockWorkspaceModel({
    catalogDocks,
    detailId,
    installedDocks,
    installedRecords,
    installedSearchQuery,
    lang,
    outdatedReportsById,
    projectStateLoaded,
    sortMode,
  });
  const {
    dockDetails,
    refreshDockDetail,
    setDockDetails,
    setVersionTotal,
    versionTotal,
  } = useDockDetailController({
    appendLog,
    baseDetail,
    catalogDocks,
    detailKey,
    dockView,
    setCatalogDocks,
    versionPage,
    versionPageSize,
  });
  const detail = baseDetail ? dockDetails[detailKey] ?? baseDetail : null;
  const selectedDetailVersion = useMemo(
    () => detail?.versions?.find((version) => version.version === detailVersion) ?? detail?.versions?.[0] ?? null,
    [detail, detailVersion]
  );
  const catalogPageCount = Math.max(1, Math.ceil(Math.max(catalogTotal, sortedDocks.length) / catalogPageSize));
  const versionPageCount = Math.max(1, Math.ceil(Math.max(versionTotal, detail?.versions?.length ?? 0) / versionPageSize));
  const overlayOpen = openMenu !== "";
  const accountMenuName = nickname || accountDisplayName || accountEmail || (authProvider === "github" ? t.githubAccount : t.opendockAccount);
  const showAppLoading = isTauriRuntime() && !appStateLoaded;
  const {
    myDocks,
    myDocksCounts,
    myDocksPage,
    myDocksTotal,
    myStarredDocks,
    resetAccountDocks,
    setMyDocksPage,
    starredDockIds,
    starUpdatingId,
    toggleDockStar,
  } = useAccountDocksController({
    appendLog,
    catalogDocks,
    detailKey,
    loggedIn,
    pageSize: ACCOUNT_PAGE_LIMIT,
    setCatalogDocks,
    setDockDetails,
    signInToStar: t.signInToStar,
  });
  const myDocksPageCount = Math.max(1, Math.ceil(myDocksTotal / ACCOUNT_PAGE_LIMIT));
  const {
    authMessage,
    authWorking,
    login,
    logout,
    setAuthMessage,
  } = useAuthController({
    resetAccountDocks,
    resetDockWorkspaceView,
    resetProjectDialogs,
    resetProjectRuntime,
    setAccountAvatarUrl,
    setAccountDisplayName,
    setAccountEmail,
    setAccountOfficial,
    setAuthProvider,
    setInstalledDocks,
    setLoggedIn,
    setProjectSidebarCollapsed,
    t,
  });
  const {
    cancelCommandTask,
    deleteDock,
    forceRetryCommand,
    installDock,
    runDoctor,
    updateDocks,
  } = useDockCommandController({
    activeProject,
    allKnownDocks,
    appendCommandResultLog,
    appendLog,
    beginCommandTask,
    commandTaskRef,
    finishCommandResult,
    finishCommandTask,
    installedRows,
    projects,
    refreshDockDetail,
    refreshProjectState,
    setCommandTask,
    setDockView,
    setInstalledDocks,
    t,
  });
  const {
    checkProductUpdate,
    installProductUpdate,
    productUpdate,
  } = useProductUpdateController({
    appendLog,
    messages: {
      available: (_currentVersion, latestVersion) => t.appUpdateAvailableNotice.replace("{version}", latestVersion),
      checking: t.appUpdateChecking,
      downloading: (latestVersion, percent) =>
        t.appUpdateDownloading
          .replace("{version}", latestVersion)
          .replace("{percent}", percent === null ? "" : `${percent}%`)
          .trim(),
      desktopOnly: t.appUpdateDesktopOnly,
      failed: (message) => t.appUpdateCheckFailed.replace("{message}", message),
      installing: (latestVersion) => t.appUpdateInstalling.replace("{version}", latestVersion),
      openReleaseFallback: t.appUpdateOpenReleaseFallback,
      restarting: t.appUpdateRestarting,
      upToDate: (currentVersion) => t.appUpdateUpToDate.replace("{version}", currentVersion || t.unavailable),
    },
    showNotice: showAppNotice,
  });
  const currentAppVersion = appVersion || productUpdate.check?.currentVersion || "";
  const {
    handleNativeMenu,
    openDockDetail,
    runAppMenuCommand,
    runShortcutCommand,
    selectProject,
    setMainView,
  } = useNavigationController({
    activeProject,
    appVersion: currentAppVersion,
    addExistingProjectFromFolder,
    appendLog,
    createBlankProject,
    deleteDock,
    detail,
    detailKey,
    dockView,
    exportShortcuts,
    checkProductUpdate,
    importShortcuts,
    installDock,
    openDeleteProject,
    openRenameProject,
    projects,
    refreshCatalogFromRegistry,
    refreshProjectLogs,
    resetDockWorkspaceView,
    runDoctor,
    setActiveProjectId,
    setCommandPaletteOpen,
    setDetailId,
    setDetailTab,
    setDockView,
    setOpenMenu,
    setProjectSidebarCollapsed,
    setProjectSwitcherOpen,
    updateDocks,
  });

  useNativeEventBridge({
    appendLog,
    applyCommandLineToTask,
    applyCommandProgressToTask,
    commandTask,
    commandTaskRef,
    handleNativeMenu,
    projectDialogOpen:
      projectAddOpen ||
      projectRenameOpen ||
      projectDeleteOpen ||
      commandPaletteOpen ||
      projectSwitcherOpen,
    runShortcutCommand,
    setAuthMessage,
    shortcutBindings,
  });

  function resetDockWorkspaceView() {
    setDockView("list");
    setDetailTab("readme");
    setDetailVersion("");
    setSearchQuery("");
    setInstalledSearchQuery("");
    setCatalogPage(1);
    setVersionPage(1);
    setOpenMenu("");
  }

  useDesktopStateSync({
    activeProjectId,
    appendLog,
    appStateLoaded,
    projects,
    setAccountEmail,
    setActiveProjectId,
    setAppStateLoaded,
    setAuthProvider,
    setLoggedIn,
    setProjects,
  });

  useEffect(() => {
    if (!appStateLoaded || !loggedIn || !isTauriRuntime()) return;
    let cancelled = false;
    void requestAccountProfile()
      .then((profile) => {
        if (cancelled || !profile) return;
        setNickname(profile.nickname);
        setAccountEmail(profile.email);
        setAccountDisplayName(profile.displayName ?? "");
        setAccountAvatarUrl(profile.avatarUrl ?? null);
        setAccountOfficial(profile.official);
      })
      .catch((error) => {
        if (!cancelled) {
          appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [appStateLoaded, loggedIn]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void getVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch((error) => {
        appendLog("WARN", "var(--warning)", `OpenDock version check failed · ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!appNotice) return;
    const timeout = window.setTimeout(() => setAppNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [appNotice]);

  usePaginationGuards({
    catalogPage,
    catalogPageCount,
    catalogPageSize,
    detailKey,
    myDocksPage,
    myDocksPageCount,
    searchQuery,
    setCatalogPage,
    setDetailVersion,
    setMyDocksPage,
    setVersionPage,
    setVersionTotal,
    sortMode,
    versionPage,
    versionPageCount,
    versionPageSize,
  });

  function appendLog(level: string, color: string, message: string) {
    setLogs((current) => appendStoredLog(current, level, color, message));
  }

  function showAppNotice(kind: AppNoticeKind, message: string, options: AppNoticeOptions = {}) {
    setAppNotice((current) => {
      if (options.stableKey && current?.stableKey === options.stableKey) {
        if (current.kind === kind && current.message === message) return current;
        return { ...current, kind, message };
      }
      return { id: appNoticeIdRef.current++, kind, message, stableKey: options.stableKey };
    });
  }

  async function saveNickname(nextNickname: string) {
    const normalized = nextNickname.trim();
    if (!normalized) return;
    if (!isTauriRuntime()) {
      setNickname(normalized);
      setAccountDisplayName("");
      setAccountAvatarUrl(null);
      setAccountOfficial(false);
      return;
    }
    setProfileSaving(true);
    try {
      const profile = await requestUpdateAccountProfile(normalized);
      setNickname(profile.nickname);
      setAccountEmail(profile.email);
      setAccountDisplayName(profile.displayName ?? "");
      setAccountAvatarUrl(profile.avatarUrl ?? null);
      setAccountOfficial(profile.official);
      appendLog("OK", "var(--success)", t.profileSaved);
      showAppNotice("success", t.profileSaved);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog("WARN", "var(--warning)", message);
      showAppNotice("warning", t.profileSaveFailed.replace("{message}", message));
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <div className="app-root" data-lang={lang} data-theme={theme}>
      <Titlebar
        accountAvatarUrl={accountAvatarUrl}
        accountName={accountMenuName}
        appVersion={currentAppVersion}
        lang={lang}
        loggedIn={loggedIn}
        onAccount={() => setOpenMenu((current) => (current === "account" ? "" : "account"))}
        onAppMenu={() => setOpenMenu((current) => (current === "app" ? "" : "app"))}
        onAppMenuCommand={(id) => void runAppMenuCommand(id)}
        onLang={() => setOpenMenu((current) => (current === "lang" ? "" : "lang"))}
        onLogout={logout}
        onOpenProfile={() => setMainView("account")}
        onOpenProductUpdate={() => void installProductUpdate()}
        onSetEnglish={() => {
          setLang("en");
          setOpenMenu("");
        }}
        onSetKorean={() => {
          setLang("ko");
          setOpenMenu("");
        }}
        onTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        openMenu={openMenu}
        productUpdate={productUpdate}
        projectPathLabel={projectPathLabel}
        t={t}
        windowControlPlatform={windowControlPlatform}
      />

      {appNotice ? <AppNotice key={appNotice.id} closeLabel={t.close} notice={appNotice} onClose={() => setAppNotice(null)} /> : null}

      {overlayOpen ? <button aria-label={t.close} className="menu-overlay" onClick={() => setOpenMenu("")} type="button" /> : null}

      <main className="desktop-frame">
        {showAppLoading ? (
          <ProjectLoading t={t} />
        ) : !loggedIn ? (
          <SignInScreen
            authMessage={authMessage}
            authWorking={authWorking}
            onGmail={() => login("gmail")}
            onGitHub={() => login("github")}
            t={t}
          />
        ) : !activeProject ? (
          <ProjectEmpty onAddExisting={() => void addExistingProjectFromFolder()} onCreate={createBlankProject} t={t} />
        ) : (
          <Workspace
            activeProject={activeProject}
            catalogPage={catalogPage}
            catalogPageCount={catalogPageCount}
            detail={detail}
            detailTab={detailTab}
            detailVersion={selectedDetailVersion}
            dockView={dockView}
            installedDocks={activeInstalledDocks}
            installedRows={filteredInstalledRows}
            installedSearchQuery={installedSearchQuery}
            installedTotalCount={installedRows.length}
            lang={lang}
            logs={logs}
            myDocks={myDocks}
            myDocksCounts={myDocksCounts}
            myDocksPage={myDocksPage}
            myDocksPageCount={myDocksPageCount}
            myDocksTotal={myDocksTotal}
            myStarredDocks={myStarredDocks}
            accountAvatarUrl={accountAvatarUrl}
            accountDisplayName={accountDisplayName}
            nickname={nickname}
            profileSaving={profileSaving}
            accountEmail={accountEmail}
            accountOfficial={accountOfficial}
            commandTask={commandTask}
            onAddExisting={() => void addExistingProjectFromFolder()}
            onBack={() => setMainView("list")}
            onCancelCommand={() => void cancelCommandTask()}
            onCreate={createBlankProject}
            onDeleteDock={deleteDock}
            onInstallDock={installDock}
            onOpenAdd={() => {
              setProjectAddOpen(true);
              setProjectRenameOpen(false);
              setProjectDeleteOpen(false);
              setOpenMenu("");
            }}
            onOpenDetail={openDockDetail}
            onOpenProfile={() => setMainView("account")}
            onRemove={openDeleteProject}
            onRename={openRenameProject}
            onSaveNickname={saveNickname}
            onSelectProject={selectProject}
            onSetCatalogPage={setCatalogPage}
            onSetDetailTab={setDetailTab}
            onSetDetailVersion={(version) => setDetailVersion(version.version)}
            onSetInstalledSearchQuery={setInstalledSearchQuery}
            onSetMyDocksPage={setMyDocksPage}
            onSetSearchQuery={setSearchQuery}
            onSetSortMode={(mode) => {
              setSortMode(mode);
              setOpenMenu("");
            }}
            onSetVersionPage={setVersionPage}
            onSetView={setMainView}
            onToggleDockStar={toggleDockStar}
            onToggleSidebar={() => setProjectSidebarCollapsed((current) => !current)}
            onUpdateDocks={() => void updateDocks(activeProject, { showLogs: false })}
            openMenu={openMenu}
            projects={projects}
            projectSidebarCollapsed={projectSidebarCollapsed}
            searchQuery={searchQuery}
            setOpenMenu={setOpenMenu}
            shortcutBindings={shortcutBindings}
            shortcutPlatform={shortcutPlatform}
            shortcutStatus={shortcutStatus}
            sortMode={sortMode}
            sortedDocks={sortedDocks}
            starredDockIds={starredDockIds}
            starUpdatingId={starUpdatingId}
            t={t}
            updateAvailableCount={updateAvailableCount}
            versionPage={versionPage}
            versionPageCount={versionPageCount}
            onExportShortcuts={() => void exportShortcuts()}
            onImportShortcuts={() => void importShortcuts()}
            onResetAllShortcuts={resetAllShortcuts}
            onResetShortcut={resetShortcut}
            onSetShortcut={updateShortcut}
          />
        )}
      </main>

      <AppOverlays
        activeProjectId={activeProjectId}
        bindings={shortcutBindings}
        commandPaletteOpen={commandPaletteOpen}
        commandTask={commandTask}
        deleteProjectName={deleteProjectName}
        lang={lang}
        onAddExistingProject={() => void addExistingProjectFromFolder()}
        onCloseCommandPalette={() => setCommandPaletteOpen(false)}
        onCloseCommandProgress={closeCommandProgress}
        onCloseProjectAdd={() => setProjectAddOpen(false)}
        onCloseProjectRename={closeProjectRename}
        onConfirmProjectDelete={confirmProjectDelete}
        onCreateBlankProject={createBlankProject}
        onForceRetryCommand={() => void forceRetryCommand()}
        onProjectDeleteCancel={closeProjectDelete}
        onRenameProjectChange={setRenameProjectName}
        onRenameProjectSubmit={saveProjectRename}
        onRunShortcutCommand={(commandId) => {
          setCommandPaletteOpen(false);
          void runShortcutCommand(commandId);
        }}
        onSelectProject={selectProject}
        onSwitcherClose={() => setProjectSwitcherOpen(false)}
        projectAddOpen={projectAddOpen}
        projectDeleteOpen={projectDeleteOpen}
        projectRenameOpen={projectRenameOpen}
        projectSwitcherOpen={projectSwitcherOpen}
        projects={projects}
        renameProjectName={renameProjectName}
        shortcutPlatform={shortcutPlatform}
        t={t}
      />
    </div>
  );
}
