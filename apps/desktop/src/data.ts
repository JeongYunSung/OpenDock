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
  gradient: string;
  desc: string;
  primaryTag: string;
  secondaryTag: string;
  extraTagCount: string;
  downloadLabel: string;
  downloads?: number;
  stars?: number;
  fallbackSortRank: number;
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
  searchTerms: string[];
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

export interface ProductUpdateCheck {
  autoUpdateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  name?: string | null;
  publishedAt?: string | null;
  releaseUrl: string;
  updateAvailable: boolean;
}

export interface ProductUpdateState {
  check: ProductUpdateCheck | null;
  status: "available" | "checking" | "current" | "failed" | "idle" | "installing";
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
    failed?: string[];
    outdated: string[];
  };
  updatesAvailable: boolean;
}

export interface OpenDockOutdatedReport {
  currentVersion: string;
  dockId: string;
  latestVersion?: string;
  message?: string;
  platform?: string;
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

interface OpenDockChangeSummary {
  created: string[];
  deleted: string[];
  reviewRequired: string[];
  unchanged: string[];
  updated: string[];
}

interface OpenDockFileChanges {
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

export { TEXT } from "./desktop-text";

export const BASE_LOGS: AppLog[] = [];

export { dockFromInstalledRecord, dockFullId, mergeRegistryDockDetail, normalizeRegistryDock, normalizeRegistryVersions } from "./dock-data";
