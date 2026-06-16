export type Lang = "ko" | "en";
export type Theme = "light" | "dark";
export type DockView = "list" | "detail" | "installed" | "logs" | "account";
export type SortMode = "downloads" | "stars" | "recent" | "name";

export interface Project {
  id: string;
  name: string;
  folderName: string;
  path: string;
}

export interface DesktopAppState {
  projects: Project[];
  activeProjectId: string;
}

export interface Dock {
  id: string;
  short: string;
  fullId?: string;
  owner?: string;
  name?: string;
  displayName?: string;
  grad: string;
  desc: string;
  tagA: string;
  tagB: string;
  more: string;
  dl: string;
  downloads?: number;
  stars?: number;
  updatedRank: number;
  updatedAt?: string;
  version: string;
  size: string;
  checksum: string;
  readmeTitle: string;
  readmeIntro: string;
  readmeMarkdown?: string | null;
  logoUrl?: string | null;
  publisher?: string;
  official?: boolean;
  platforms?: string[];
  tags: string[];
  modes: string[];
  versions?: DockVersion[];
}

export interface DockVersion {
  version: string;
  platform?: string;
  size?: string;
  checksum?: string;
  status?: string;
  approved?: boolean;
  publishedAt?: string | null;
  revokedAt?: string | null;
  downloadCount?: number;
  summary?: string | null;
}

export interface RegistryDockSummary {
  id: string;
  owner: string;
  name: string;
  displayName: string;
  summary: string;
  official: boolean;
  publisher: { nickname: string; official: boolean } | null;
  logo: { url: string; contentType: string; sizeBytes: number } | null;
  platforms: string[];
  latestVersion: string;
  downloads: number;
  stars: number;
  updatedAt: string;
  tags: string[];
}

export interface RegistryDockDetail extends RegistryDockSummary {
  description: string;
  readmeMarkdown: string | null;
}

export interface RegistryDockSearchResponse {
  items: RegistryDockSummary[];
  page: number;
  limit: number;
  total: number;
}

export interface RegistryDockVersionsResponse {
  id?: string;
  items: Array<RegistryDockVersionItem | RegistryDockVersionGroup>;
  page?: number;
  limit?: number;
  total?: number;
}

export interface RegistryDockVersionGroup {
  version: string;
  status?: string;
  summary?: string | null;
  updatedAt?: string | null;
  platforms?: RegistryDockVersionItem[];
}

export interface RegistryDockVersionItem {
  version: string;
  platform?: string;
  approved?: boolean;
  status?: string;
  checksum?: string;
  publishedAt?: string | null;
  approvedAt?: string | null;
  revokedAt?: string | null;
  downloadCount?: number;
  metadata?: { summary?: string | null };
  archive?: { sizeBytes?: number | null };
}

export interface DockStarResponse {
  id: string;
  starred: boolean;
  stars: number;
}

export interface DockStarStatusResponse {
  items: Array<{
    id: string;
    starred: boolean;
  }>;
}

export interface MyStarsResponse {
  items: Array<{
    starredAt: string;
    dock: RegistryDockSummary;
  }>;
}

export interface MyDocksResponse {
  items: MyDock[];
  page: number;
  limit: number;
  total: number;
  counts: MyDocksCounts;
}

export interface MyDocksCounts {
  all: number;
  approved: number;
  pending: number;
  rejected: number;
  unavailable: number;
  hidden: number;
}

export interface MyDock {
  id: string;
  owner: string | null;
  name: string;
  displayName: string | null;
  summary: string | null;
  version: string | null;
  status: string;
  hidden: boolean;
  suspended: boolean;
  official: boolean;
  logo: { url: string; contentType: string; sizeBytes: number } | null;
  latestApprovedVersion: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
  versions: Array<{
    version: string | null;
    platform: string;
    status: string;
    submittedAt: string | null;
    approvedAt: string | null;
    revokedAt: string | null;
    downloadCount: number | null;
  }>;
}

export interface ProjectStateResult {
  has_state: boolean;
  project_path: string;
  lock_path: string;
  docks: InstalledDockRecord[];
}

export interface InstalledDockRecord {
  id: string;
  name?: string;
  requested?: string;
  version: string;
  checksum?: string;
  signature?: string;
  platform?: string;
  workdir?: string;
  files?: Array<{ path: string; mode?: string; checksum?: string }>;
}

export interface ProjectFolder {
  name: string;
  folder_name: string;
  path: string;
}

export interface OpenDockCommandLine {
  level: "INFO" | "OK" | "RUN" | "WARN" | "ERR" | string;
  message: string;
}

export interface OpenDockCommandProgress {
  commandId?: string | null;
  current?: number | null;
  dockId?: string | null;
  level: "INFO" | "OK" | "RUN" | "WARN" | "ERR" | string;
  message: string;
  operation: string;
  percent: number;
  phase: string;
  total?: number | null;
  version?: string | null;
}

export interface OpenDockCommandResult {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  lines: OpenDockCommandLine[];
  json?: OpenDockChangeResult | OpenDockOutdatedResult | null;
}

export interface OpenDockChangeResult {
  errorCode?: string;
  forceable?: boolean;
  message?: string;
  operation: "install" | "uninstall" | "update" | string;
  reports: OpenDockChangeReport[];
  success: boolean;
  summary: OpenDockChangeSummary;
}

export interface OpenDockOutdatedResult {
  reports: OpenDockOutdatedReport[];
  success: boolean;
  summary: {
    current: string[];
    outdated: string[];
  };
  updatesAvailable: boolean;
}

export interface OpenDockOutdatedReport {
  currentVersion: string;
  dockId: string;
  latestVersion: string;
  platform: string;
  status: "current" | "outdated" | string;
}

export interface OpenDockChangeReport {
  dockId: string;
  fileChanges: OpenDockFileChanges;
  filesCreated: number;
  filesDeleted: number;
  filesReviewRequired: number;
  filesUpdated: number;
  fromVersion?: string;
  operation: "install" | "uninstall" | "update" | string;
  platform?: string;
  status: "installed" | "unchanged" | "uninstalled" | "updated" | string;
  toVersion?: string;
  version: string;
}

export interface OpenDockChangeSummary {
  created: string[];
  deleted: string[];
  reviewRequired: string[];
  unchanged: string[];
  updated: string[];
}

export interface OpenDockFileChanges {
  created: string[];
  deleted: string[];
  reviewRequired: string[];
  updated: string[];
}

export interface AuthSession {
  loggedIn: boolean;
  email: string | null;
  provider: string | null;
  raw: OpenDockCommandResult;
}

export interface AppLog {
  time: string;
  level: string;
  color: string;
  message: string;
}

export const TEXT = {
  ko: {
    projects: "프로젝트",
    explore: "탐색",
    installed: "설치됨",
    logs: "로그",
    heroTitle: "프로젝트에 맞는 dock 찾기",
    heroSub: "검토된 셋업을 둘러보고, Mac과 Windows 버전을 확인한 뒤 필요한 dock을 설치하세요.",
    search: "Dock 검색",
    installedSearch: "설치된 dock 검색",
    sortDownloads: "다운로드 많은 순",
    sortStars: "Star 많은 순",
    sortRecent: "최근 업데이트 순",
    sortName: "이름순",
    noDocksTitle: "검색과 일치하는 dock이 없습니다",
    noDocksSub: "검색어를 바꾸거나 Registry를 다시 새로고침하세요.",
    noVersionsTitle: "이 dock에서 확인할 수 있는 버전이 없습니다",
    noVersionsSub: "검토된 버전이 생기면 여기에 표시됩니다.",
    explorePagination: "Dock 카탈로그 페이지",
    firstPage: "첫 페이지",
    previousPage: "이전 페이지",
    nextPage: "다음 페이지",
    lastPage: "마지막 페이지",
    by: "게시자",
    downloads: "다운로드",
    stars: "Stars",
    pageCount: "{page} / {pages}",
    starAction: "이 dock star하기",
    unstarAction: "Star 제거",
    signInToStar: "로그인하고 star하기",
    accountProfile: "계정",
    logout: "로그아웃",
    back: "뒤로",
    readme: "Readme",
    versions: "Versions",
    updated: "업데이트",
    provides: "추가되는 내용",
    packageDetails: "Dock 정보",
    latestRelease: "최신 버전",
    publisher: "게시자",
    tags: "태그",
    supportedPlatforms: "지원 플랫폼",
    installAction: "설치",
    deleteAction: "삭제",
    forceDeleteAction: "강제 삭제",
    forceRetryLog: "강제 옵션으로 다시 실행",
    forceRetryWarning: "직접 수정한 파일을 덮어쓰거나 제거할 수 있습니다.",
    forceUpdateAction: "강제 업데이트",
    updateAvailable: "업데이트 가능",
    updateAvailableCount: "업데이트 {count}개",
    updateAllAction: "전체 업데이트",
    updatingAction: "업데이트 중",
    resultAdded: "추가됨",
    resultChanged: "수정됨",
    resultDeleted: "삭제됨",
    resultNoChanges: "변경 없음",
    resultReviewRequired: "확인 필요",
    installedTitle: "설치된 dock",
    installedSub: "현재 프로젝트에 추가된 dock과 업데이트 상태를 확인합니다.",
    dock: "Dock",
    version: "버전",
    status: "상태",
    action: "작업",
    ready: "준비됨",
    openDetail: "상세 보기",
    noInstalledTitle: "설치된 dock이 없습니다",
    noInstalledSub: "탐색에서 필요한 dock을 설치하면 여기에 표시됩니다.",
    noInstalledSearchTitle: "검색 결과가 없습니다",
    noInstalledSearchSub: "검색어를 바꾸면 설치된 dock을 다시 볼 수 있습니다.",
    starredDocks: "Starred docks",
    noStarredDocks: "아직 star한 dock이 없습니다.",
    myDocks: "내 Docks",
    submittedDocks: "제출한 docks",
    approved: "승인됨",
    pending: "승인 대기",
    rejected: "반려됨",
    unavailable: "사용 불가",
    hidden: "숨김",
    all: "전체",
    noSubmittedDocks: "아직 제출한 dock이 없습니다.",
    logsTitle: "프로젝트 로그",
    logsSub: "설치, 업데이트, 제거, 상태 확인 기록을 시간순으로 봅니다.",
    liveTail: "실시간 로그",
    taskInstalling: "설치 진행 중",
    taskUpdating: "업데이트 진행 중",
    taskDeleting: "삭제 진행 중",
    taskDoctor: "상태 확인 중",
    taskWaiting: "대기 중",
    taskWorking: "작업 중",
    taskCancelling: "취소 중",
    taskCompleted: "완료",
    taskFailed: "실패",
    taskCancelled: "취소됨",
    noUpdatesAvailable: "업데이트할 dock이 없습니다.",
    operationLog: "작업 로그",
    memberSignIn: "로그인",
    signInTitle: "로그인",
    signInSub: "Google 또는 GitHub로 로그인해 계속하세요.",
    signInWaiting: "브라우저에서 로그인을 완료하세요.",
    signInFailed: "로그인에 실패했습니다.",
    continueGmail: "Google로 계속",
    continueGitHub: "GitHub로 계속",
    githubAccount: "GitHub 계정",
    toggleTheme: "테마 전환",
    minimizeWindow: "창 최소화",
    maximizeWindow: "창 최대화",
    closeWindow: "창 닫기",
    noProjectPath: "프로젝트 없음",
    loadingWorkspace: "프로젝트 불러오는 중",
    noProjectKicker: "시작하기",
    noProjectTitle: "프로젝트를 선택하세요",
    createProjectAction: "새 프로젝트 만들기",
    createProjectSub: "빈 프로젝트를 만듭니다.",
    continueWithoutProjectAction: "기존 프로젝트 추가",
    continueWithoutProjectSub: "로컬 폴더를 선택해 등록합니다.",
    addProjectTitle: "프로젝트 추가",
    addProjectSub: "새 프로젝트를 만들거나 기존 폴더를 연결하세요.",
    newProjectAction: "새 프로젝트 만들기",
    newProjectSub: "빈 프로젝트를 만듭니다.",
    existingProjectAction: "기존 프로젝트 추가",
    existingProjectSub: "폴더를 선택해 프로젝트 목록에 추가합니다.",
    renameProjectTitle: "프로젝트 이름 변경",
    renameProjectSub: "표시 이름만 바뀌고 폴더명과 경로는 유지됩니다.",
    deleteProjectTitle: "프로젝트 삭제",
    deleteProjectConfirmTitle: "정말로 삭제하시겠습니까?",
    deleteProjectConfirmSub: "프로젝트 목록에서만 제거됩니다. 실제 폴더와 경로는 삭제되지 않습니다.",
    cancel: "취소",
    save: "저장",
    close: "닫기",
    collapseProjects: "프로젝트 사이드바 접기",
    expandProjects: "프로젝트 사이드바 펼치기",
    projectNameLabel: "프로젝트 이름",
    memberWorkspace: "계정",
    accountInfoTitle: "내 계정",
    accountInfoSub: "닉네임을 수정하고 제출한 dock을 확인하세요.",
    backToMain: "메인으로",
    commandPaletteSearch: "명령 검색",
    profile: "프로필",
    email: "이메일",
    nickname: "닉네임",
    saveChanges: "변경사항 저장",
    switchProjectTitle: "프로젝트 전환",
    switchProjectSub: "등록된 프로젝트를 선택하세요.",
    shortcuts: "단축키",
    shortcutsSub: "자주 쓰는 명령을 키보드로 실행합니다. JSON 파일로 가져오거나 내보낼 수 있습니다.",
    importShortcuts: "가져오기",
    exportShortcuts: "내보내기",
    resetShortcuts: "전체 초기화",
    resetShortcut: "기본값으로 되돌리기",
    shortcutUnset: "미지정",
    pressShortcut: "새 단축키 입력",
    shortcutSaved: "단축키를 저장했습니다.",
    shortcutRemoved: "단축키를 제거했습니다.",
    shortcutResetDone: "기본 단축키로 되돌렸습니다.",
    shortcutResetAllDone: "모든 단축키를 기본값으로 되돌렸습니다.",
    shortcutImportDone: "단축키를 가져왔습니다.",
    shortcutExportDone: "단축키를 내보냈습니다.",
    shortcutConflict: "{command}에서 이미 사용하는 단축키입니다.",
    appMenu: "앱 메뉴",
    menuFile: "파일",
    menuEdit: "편집",
    menuView: "보기",
    menuProject: "프로젝트",
    menuDock: "Dock",
    menuWindow: "창",
    menuHelp: "도움말",
    menuCopyProjectPath: "프로젝트 경로 복사",
    menuToggleSidebar: "사이드바 전환",
    menuRunDoctor: "Doctor 실행",
    menuOpenProjectFolder: "프로젝트 폴더 열기",
    menuRevealProjectFolder: "Finder / Explorer에서 보기",
    menuRemoveProject: "OpenDock에서 제거",
    menuRefreshRegistry: "Registry 새로고침",
    menuReloadWindow: "창 새로고침",
    menuDocs: "OpenDock 문서",
    menuCliCommands: "CLI 명령 보기",
    menuTroubleshooting: "문제 해결"
  },
  en: {
    projects: "Projects",
    explore: "Explore",
    installed: "Installed",
    logs: "Logs",
    heroTitle: "Find a dock for your project",
    heroSub: "Browse reviewed setups, check the available Mac and Windows versions, and install the one you need.",
    search: "Search docks",
    installedSearch: "Search installed docks",
    sortDownloads: "Most downloaded",
    sortStars: "Most starred",
    sortRecent: "Recently updated",
    sortName: "Name",
    noDocksTitle: "No docks match this search",
    noDocksSub: "Try a different search or refresh the Registry again.",
    noVersionsTitle: "No versions are available for this dock",
    noVersionsSub: "Reviewed versions will appear here.",
    explorePagination: "Dock catalog pages",
    firstPage: "First page",
    previousPage: "Previous page",
    nextPage: "Next page",
    lastPage: "Last page",
    by: "By",
    downloads: "Downloads",
    stars: "Stars",
    pageCount: "{page} of {pages}",
    starAction: "Star this dock",
    unstarAction: "Unstar",
    signInToStar: "Sign in to star docks.",
    accountProfile: "Account",
    logout: "Logout",
    back: "Back",
    readme: "Readme",
    versions: "Versions",
    updated: "Updated",
    provides: "What it adds",
    packageDetails: "Dock details",
    latestRelease: "Latest version",
    publisher: "Publisher",
    tags: "Tags",
    supportedPlatforms: "Supported platforms",
    installAction: "Install",
    deleteAction: "Delete",
    forceDeleteAction: "Force delete",
    forceRetryLog: "Retrying with force",
    forceRetryWarning: "Files you changed may be overwritten or removed.",
    forceUpdateAction: "Force update",
    updateAvailable: "Update available",
    updateAvailableCount: "{count} updates",
    updateAllAction: "Update all",
    updatingAction: "Updating",
    resultAdded: "Added",
    resultChanged: "Changed",
    resultDeleted: "Deleted",
    resultNoChanges: "No changes",
    resultReviewRequired: "Review required",
    installedTitle: "Installed docks",
    installedSub: "See what has been added to this project and whether updates are available.",
    dock: "Dock",
    version: "Version",
    status: "Status",
    action: "Action",
    ready: "Ready",
    openDetail: "Open detail",
    noInstalledTitle: "No installed docks",
    noInstalledSub: "Install a dock from Explore and it will appear here.",
    noInstalledSearchTitle: "No installed docks match",
    noInstalledSearchSub: "Change the search term to see installed docks again.",
    starredDocks: "Starred docks",
    noStarredDocks: "No starred docks yet.",
    myDocks: "My Docks",
    submittedDocks: "Submitted docks",
    approved: "Approved",
    pending: "Pending",
    rejected: "Rejected",
    unavailable: "Unavailable",
    hidden: "Hidden",
    all: "All",
    noSubmittedDocks: "You have not submitted any docks yet.",
    logsTitle: "Project logs",
    logsSub: "See installs, updates, removals, and project checks in time order.",
    liveTail: "live tail",
    taskInstalling: "Installing",
    taskUpdating: "Updating",
    taskDeleting: "Deleting",
    taskDoctor: "Checking project",
    taskWaiting: "Waiting",
    taskWorking: "Working",
    taskCancelling: "Cancelling",
    taskCompleted: "Completed",
    taskFailed: "Failed",
    taskCancelled: "Cancelled",
    noUpdatesAvailable: "No OpenDock dock updates available.",
    operationLog: "Operation log",
    memberSignIn: "Sign in",
    signInTitle: "Sign in",
    signInSub: "Sign in with Google or GitHub to continue.",
    signInWaiting: "Complete sign-in in your browser.",
    signInFailed: "Sign-in failed.",
    continueGmail: "Continue with Google",
    continueGitHub: "Continue with GitHub",
    githubAccount: "GitHub account",
    toggleTheme: "Toggle theme",
    minimizeWindow: "Minimize window",
    maximizeWindow: "Maximize window",
    closeWindow: "Close window",
    noProjectPath: "No project",
    loadingWorkspace: "Loading project",
    noProjectKicker: "Get started",
    noProjectTitle: "Choose a project",
    createProjectAction: "Create new project",
    createProjectSub: "Creates an empty project.",
    continueWithoutProjectAction: "Add existing project",
    continueWithoutProjectSub: "Select a local folder to register.",
    addProjectTitle: "Add project",
    addProjectSub: "Create a new project or connect an existing folder.",
    newProjectAction: "Create new project",
    newProjectSub: "Creates an empty project.",
    existingProjectAction: "Add existing project",
    existingProjectSub: "Select a folder to add it to the project list.",
    renameProjectTitle: "Rename project",
    renameProjectSub: "Only the display name changes. The folder name and path stay the same.",
    deleteProjectTitle: "Delete project",
    deleteProjectConfirmTitle: "Delete this project?",
    deleteProjectConfirmSub: "This only removes it from the project list. The folder and path stay untouched.",
    cancel: "Cancel",
    save: "Save",
    close: "Close",
    collapseProjects: "Collapse project sidebar",
    expandProjects: "Expand project sidebar",
    projectNameLabel: "Project name",
    memberWorkspace: "Account",
    accountInfoTitle: "Your account",
    accountInfoSub: "Update your nickname and check your submitted docks.",
    backToMain: "Back to main",
    commandPaletteSearch: "Search commands",
    profile: "Profile",
    email: "Email",
    nickname: "Nickname",
    saveChanges: "Save changes",
    switchProjectTitle: "Switch project",
    switchProjectSub: "Choose a registered project.",
    shortcuts: "Shortcuts",
    shortcutsSub: "Run common commands from the keyboard. Import or export them as JSON.",
    importShortcuts: "Import",
    exportShortcuts: "Export",
    resetShortcuts: "Reset all",
    resetShortcut: "Reset shortcut",
    shortcutUnset: "Unset",
    pressShortcut: "Press shortcut",
    shortcutSaved: "Shortcut saved.",
    shortcutRemoved: "Shortcut removed.",
    shortcutResetDone: "Shortcut reset to default.",
    shortcutResetAllDone: "All shortcuts reset to defaults.",
    shortcutImportDone: "Shortcuts imported.",
    shortcutExportDone: "Shortcuts exported.",
    shortcutConflict: "Already used by {command}.",
    appMenu: "App menu",
    menuFile: "File",
    menuEdit: "Edit",
    menuView: "View",
    menuProject: "Project",
    menuDock: "Dock",
    menuWindow: "Window",
    menuHelp: "Help",
    menuCopyProjectPath: "Copy project path",
    menuToggleSidebar: "Toggle sidebar",
    menuRunDoctor: "Run doctor",
    menuOpenProjectFolder: "Open project folder",
    menuRevealProjectFolder: "Reveal in Finder / Explorer",
    menuRemoveProject: "Remove from OpenDock",
    menuRefreshRegistry: "Refresh Registry",
    menuReloadWindow: "Reload window",
    menuDocs: "OpenDock Docs",
    menuCliCommands: "View CLI commands",
    menuTroubleshooting: "Troubleshooting"
  }
} as const;

export const BASE_LOGS: AppLog[] = [];

export function dockFullId(dock: Pick<Dock, "id" | "fullId" | "owner">) {
  return dock.fullId ?? `${dock.owner ?? "opendock"}/${dock.id}`;
}

export function dockShortId(id: string) {
  return id.includes("/") ? id.split("/").at(-1) ?? id : id;
}

export function normalizeRegistryDock(summary: RegistryDockSummary, index = 0): Dock {
  const tags = summary.tags ?? [];
  const logoUrl = summary.logo?.url ?? null;
  return {
    id: summary.name,
    short: summary.name,
    fullId: summary.id,
    owner: summary.owner,
    name: summary.name,
    displayName: summary.displayName,
    grad: dockGradient(index),
    desc: summary.summary,
    tagA: tags[0] ?? "dock",
    tagB: tags[1] ?? "workspace",
    more: String(Math.max(tags.length - 2, 0)),
    dl: String(summary.downloads ?? 0),
    downloads: summary.downloads ?? 0,
    stars: summary.stars ?? 0,
    updatedRank: Math.max(1, 999 - index),
    updatedAt: summary.updatedAt,
    version: summary.latestVersion,
    size: "-",
    checksum: "-",
    readmeTitle: summary.displayName || summary.name,
    readmeIntro: summary.summary,
    logoUrl,
    publisher: summary.publisher?.nickname ?? summary.owner,
    official: summary.official,
    platforms: summary.platforms ?? [],
    tags,
    modes: tags.length > 0 ? tags.slice(0, 5) : ["install"]
  };
}

export function mergeRegistryDockDetail(base: Dock, detail: RegistryDockDetail, versions: DockVersion[] = []): Dock {
  const markdownIntro = firstMarkdownParagraph(detail.readmeMarkdown);
  return {
    ...base,
    desc: detail.description || detail.summary || base.desc,
    readmeTitle: detail.displayName || base.readmeTitle,
    readmeIntro: markdownIntro || detail.summary || base.readmeIntro,
    readmeMarkdown: detail.readmeMarkdown,
    versions,
    version: detail.latestVersion ?? base.version,
    tags: detail.tags ?? base.tags,
    modes: (detail.tags ?? base.tags).slice(0, 5),
    platforms: detail.platforms ?? base.platforms,
    publisher: detail.publisher?.nickname ?? detail.owner ?? base.publisher,
    official: detail.official,
    logoUrl: detail.logo?.url ?? base.logoUrl ?? null,
    updatedAt: detail.updatedAt ?? base.updatedAt,
    downloads: detail.downloads ?? base.downloads,
    stars: detail.stars ?? base.stars ?? 0,
    dl: String(detail.downloads ?? base.downloads ?? base.dl)
  };
}

export function normalizeRegistryVersions(response: RegistryDockVersionsResponse): DockVersion[] {
  const grouped = new Map<string, DockVersion & { platforms?: string[] }>();
  for (const item of response.items ?? []) {
    if (isRegistryDockVersionGroup(item)) {
      const platforms = item.platforms ?? [];
      const status = normalizeVersionStatus(item.status ?? platforms[0]?.status, platforms[0]?.approved);
      const archiveBytes = platforms.reduce((total, platform) => total + (platform.archive?.sizeBytes ?? 0), 0);
      grouped.set(item.version, {
        version: item.version,
        platform: platforms.map((platform) => platform.platform).filter(isNonEmptyString).map(platformLabelForData).join(" · "),
        platforms: platforms.map((platform) => platform.platform).filter(isNonEmptyString),
        size: formatBytes(archiveBytes),
        checksum: platforms[0]?.checksum,
        status,
        approved: platforms.some((platform) => platform.approved),
        publishedAt: item.updatedAt ?? platforms[0]?.publishedAt ?? platforms[0]?.approvedAt ?? null,
        revokedAt: platforms.find((platform) => platform.revokedAt)?.revokedAt ?? null,
        downloadCount: platforms.reduce((total, platform) => total + (platform.downloadCount ?? 0), 0),
        summary: item.summary ?? platforms.find((platform) => platform.metadata?.summary)?.metadata?.summary ?? null
      });
      continue;
    }
    const status = normalizeVersionStatus(item.status, item.approved);
    const existing = grouped.get(item.version);
    if (existing) {
      existing.platforms = [...new Set([...(existing.platforms ?? []), item.platform].filter(Boolean) as string[])];
      existing.downloadCount = (existing.downloadCount ?? 0) + (item.downloadCount ?? 0);
      if (versionStatusPriority(status) < versionStatusPriority(existing.status)) {
        existing.status = status;
        existing.approved = item.approved;
        existing.revokedAt = item.revokedAt ?? null;
      }
      continue;
    }
    grouped.set(item.version, {
      version: item.version,
      platform: item.platform,
      platforms: item.platform ? [item.platform] : [],
      size: formatBytes(item.archive?.sizeBytes),
      checksum: item.checksum,
      status,
      approved: item.approved,
      publishedAt: item.publishedAt ?? item.approvedAt ?? null,
      revokedAt: item.revokedAt ?? null,
      downloadCount: item.downloadCount,
      summary: item.metadata?.summary
    });
  }
  return [...grouped.values()].map(({ platforms, ...version }) => ({
    ...version,
    platform: platforms?.map(platformLabelForData).join(" · ") || version.platform
  }));
}

function isRegistryDockVersionGroup(
  item: RegistryDockVersionItem | RegistryDockVersionGroup,
): item is RegistryDockVersionGroup {
  return Array.isArray((item as RegistryDockVersionGroup).platforms);
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizeVersionStatus(status?: string, approved?: boolean) {
  if (status?.trim()) return status.trim().toLowerCase();
  if (approved === false) return "unavailable";
  return "approved";
}

function versionStatusPriority(status?: string) {
  switch (status?.toLowerCase()) {
    case "revoked":
    case "suspended":
    case "unavailable":
      return 0;
    case "rejected":
    case "hidden":
      return 1;
    case "pending":
      return 2;
    case "approved":
      return 3;
    default:
      return 2;
  }
}

export function dockFromInstalledRecord(record: InstalledDockRecord, fallbackIndex = 0): Dock {
  const short = dockShortId(record.id);
  return {
    id: short,
    short,
    fullId: record.id,
    owner: record.id.split("/")[0] || "opendock",
    name: short,
    grad: dockGradient(fallbackIndex),
    desc: record.name ?? `${record.id}@${record.version}`,
    tagA: record.platform ?? "dock",
    tagB: "installed",
    more: "0",
    dl: "0",
    downloads: 0,
    stars: 0,
    updatedRank: fallbackIndex,
    version: record.version,
    size: `${record.files?.length ?? 0} files`,
    checksum: record.checksum ?? "-",
    readmeTitle: record.name ?? short,
    readmeIntro: `${record.id} is installed in this project.`,
    publisher: record.id.split("/")[0] || "opendock",
    official: true,
    platforms: record.platform ? [record.platform] : [],
    tags: [record.platform ?? "dock", "installed"],
    modes: ["install"]
  };
}

function dockGradient(index: number) {
  const gradients = [
    "linear-gradient(135deg,var(--dock-creative-a),var(--dock-creative-b) 55%,var(--dock-creative-c))",
    "linear-gradient(135deg,var(--dock-backend-a),var(--dock-backend-b) 55%,var(--dock-backend-c))",
    "linear-gradient(135deg,var(--dock-design-a),var(--dock-design-b) 55%,var(--dock-design-c))",
    "linear-gradient(135deg,var(--dock-frontend-a),var(--dock-frontend-b) 55%,var(--dock-frontend-c))"
  ];
  return gradients[index % gradients.length];
}

function firstMarkdownParagraph(markdown?: string | null) {
  if (!markdown) return "";
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.replace(/^#+\s*/, "").trim())
    .find((block) => block.length > 0 && !block.startsWith("```")) ?? "";
}

function formatBytes(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  return `${new Intl.NumberFormat("en-US").format(value)} bytes`;
}

function platformLabelForData(platform: string) {
  if (platform === "macos") return "macOS";
  if (platform === "windows") return "Windows";
  if (platform === "linux") return "Linux";
  if (platform === "any") return "Any";
  return platform;
}
