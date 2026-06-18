import {
  dockFromInstalledRecord,
  dockFullId,
  type Dock,
  type InstalledDockRecord,
  type Lang,
  type OpenDockOutdatedReport,
  type Project,
  type SortMode,
} from "./data";
import { findDockByKey, installedAtLabel } from "./display";

export type InstalledDockRow = Dock & {
  installedAt: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  updatePlatform?: string;
};

export function resolveActiveProjectId(projects: Project[], activeProjectId: string) {
  if (projects.some((project) => project.id === activeProjectId)) return activeProjectId;
  return projects[0]?.id ?? "";
}

export function installedDockStateMap(
  projectStateLoaded: boolean,
  installedRecords: InstalledDockRecord[],
  installedDocks: Record<string, boolean>,
) {
  if (!projectStateLoaded) return installedDocks;
  return Object.fromEntries(installedRecords.map((record) => [record.id, true]));
}

export function buildInstalledFallbackDocks(installedRecords: InstalledDockRecord[]) {
  return installedRecords.map((record, index) => dockFromInstalledRecord(record, index));
}

export function sortCatalogDocks(docks: Dock[], sortMode: SortMode) {
  return [...docks].sort((a, b) => {
    if (sortMode === "name") return a.short.localeCompare(b.short);
    if (sortMode === "stars") return (b.stars ?? 0) - (a.stars ?? 0) || a.short.localeCompare(b.short);
    if (sortMode === "recent") {
      const byDate = new Date(b.updatedAt ?? "").getTime() - new Date(a.updatedAt ?? "").getTime();
      return Number.isNaN(byDate) || byDate === 0 ? b.fallbackSortRank - a.fallbackSortRank : byDate;
    }
    return (b.downloads ?? Number(b.downloadLabel)) - (a.downloads ?? Number(a.downloadLabel));
  });
}

export function installedDockRows(input: {
  activeInstalledDocks: Record<string, boolean>;
  allKnownDocks: Dock[];
  installedRecords: InstalledDockRecord[];
  lang: Lang;
  outdatedReportsById: Record<string, OpenDockOutdatedReport>;
  projectStateLoaded: boolean;
  registryDocks: Dock[];
}): InstalledDockRow[] {
  if (input.projectStateLoaded) {
    return input.installedRecords.map((record, index) => ({
      ...(findDockByKey(input.allKnownDocks, record.id) ?? dockFromInstalledRecord(record, index)),
      version: record.version,
      checksum: record.checksum ?? findDockByKey(input.registryDocks, record.id)?.checksum ?? "-",
      installedAt: installedAtLabel(input.lang),
      latestVersion: input.outdatedReportsById[record.id]?.latestVersion,
      updateAvailable: input.outdatedReportsById[record.id]?.status === "outdated",
      updatePlatform: input.outdatedReportsById[record.id]?.platform,
    }));
  }

  return input.registryDocks
    .filter((dock) => input.activeInstalledDocks[dockFullId(dock)] || input.activeInstalledDocks[dock.id])
    .map((dock) => ({
      ...dock,
      installedAt: installedAtLabel(input.lang),
      updateAvailable: false,
    }));
}

export function matchesInstalledSearch(dock: InstalledDockRow, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    dockFullId(dock),
    dock.short,
    dock.displayName,
    dock.owner,
    dock.publisher,
    dock.desc,
    dock.version,
    dock.latestVersion,
    ...dock.tags,
    ...dock.searchTerms,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}
