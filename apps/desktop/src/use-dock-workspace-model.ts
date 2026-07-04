import { useMemo } from "react";
import { dockFullId, type Dock, type InstalledDockRecord, type Lang, type OpenDockOutdatedReport, type SortMode } from "./data";
import { findDockByKey } from "./display";
import {
  buildInstalledFallbackDocks,
  installedDockRows,
  installedDockStateMap,
  matchesInstalledSearch,
  sortCatalogDocks,
} from "./dock-workspace-model";

interface DockWorkspaceModelOptions {
  catalogDocks: Dock[];
  detailId: string;
  installedDocks: Record<string, boolean>;
  installedMetadataDocks: Dock[];
  installedRecords: InstalledDockRecord[];
  installedSearchQuery: string;
  lang: Lang;
  outdatedReportsById: Record<string, OpenDockOutdatedReport>;
  projectStateLoaded: boolean;
  sortMode: SortMode;
}

export function useDockWorkspaceModel(options: DockWorkspaceModelOptions) {
  const registryDocks = options.catalogDocks;
  const installedFallbackDocks = useMemo(
    () => buildInstalledFallbackDocks(options.installedRecords),
    [options.installedRecords],
  );
  const allKnownDocks = useMemo(
    () => [
      ...registryDocks,
      ...options.installedMetadataDocks.filter((dock) => !findDockByKey(registryDocks, dockFullId(dock))),
      ...installedFallbackDocks.filter((dock) =>
        !findDockByKey([...registryDocks, ...options.installedMetadataDocks], dockFullId(dock))
      ),
    ],
    [registryDocks, options.installedMetadataDocks, installedFallbackDocks],
  );
  const baseDetail = useMemo(
    () => findDockByKey(allKnownDocks, options.detailId) ?? allKnownDocks[0] ?? null,
    [allKnownDocks, options.detailId],
  );
  const detailKey = baseDetail ? dockFullId(baseDetail) : "";
  const activeInstalledDocks = useMemo(
    () => installedDockStateMap(options.projectStateLoaded, options.installedRecords, options.installedDocks),
    [options.projectStateLoaded, options.installedRecords, options.installedDocks],
  );
  const sortedDocks = useMemo(
    () => sortCatalogDocks(registryDocks, options.sortMode),
    [registryDocks, options.sortMode],
  );
  const installedRows = useMemo(
    () =>
      installedDockRows({
        activeInstalledDocks,
        allKnownDocks,
        installedRecords: options.installedRecords,
        lang: options.lang,
        outdatedReportsById: options.outdatedReportsById,
        projectStateLoaded: options.projectStateLoaded,
        registryDocks,
      }),
    [
      activeInstalledDocks,
      allKnownDocks,
      options.installedRecords,
      options.lang,
      options.outdatedReportsById,
      options.projectStateLoaded,
      registryDocks,
    ],
  );
  const updateAvailableCount = useMemo(
    () => installedRows.filter((row) => row.updateAvailable).length,
    [installedRows],
  );
  const filteredInstalledRows = useMemo(
    () => installedRows.filter((row) => matchesInstalledSearch(row, options.installedSearchQuery)),
    [installedRows, options.installedSearchQuery],
  );

  return {
    activeInstalledDocks,
    allKnownDocks,
    baseDetail,
    detailKey,
    filteredInstalledRows,
    installedRows,
    sortedDocks,
    updateAvailableCount,
  };
}
