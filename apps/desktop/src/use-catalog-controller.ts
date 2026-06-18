import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  dockFullId,
  mergeRegistryDockDetail,
  normalizeRegistryDock,
  normalizeRegistryVersions,
  type Dock,
  type DockView,
  type SortMode,
} from "./data";
import { findDockByKey } from "./display";
import { requestCatalog, requestDockDetail, requestDockVersions } from "./registry-client";

interface CatalogControllerOptions {
  appendLog: (level: string, color: string, message: string) => void;
  catalogPage: number;
  catalogPageSize: number;
  searchQuery: string;
  sortMode: SortMode;
}

interface DetailControllerOptions {
  appendLog: (level: string, color: string, message: string) => void;
  baseDetail: Dock | null;
  catalogDocks: Dock[];
  detailKey: string;
  dockView: DockView;
  setCatalogDocks: Dispatch<SetStateAction<Dock[]>>;
  versionPage: number;
  versionPageSize: number;
}

export function useCatalogController(options: CatalogControllerOptions) {
  const [catalogDocks, setCatalogDocks] = useState<Dock[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void requestCatalog(options.sortMode, options.searchQuery, options.catalogPage, options.catalogPageSize)
      .then((response) => {
        if (cancelled) return;
        const nextDocks = response.items.map((item, index) => normalizeRegistryDock(item, index));
        setCatalogDocks(nextDocks);
        setCatalogTotal(response.total ?? nextDocks.length);
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setCatalogDocks([]);
          setCatalogTotal(0);
          options.appendLog("WARN", "var(--warning)", message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [options.searchQuery, options.sortMode, options.catalogPage, options.catalogPageSize]);

  async function refreshCatalogFromRegistry() {
    try {
      const response = await requestCatalog(options.sortMode, options.searchQuery, options.catalogPage, options.catalogPageSize);
      const nextDocks = response.items.map((item, index) => normalizeRegistryDock(item, index));
      setCatalogDocks(nextDocks);
      setCatalogTotal(response.total ?? nextDocks.length);
      options.appendLog("OK", "var(--success)", "registry refreshed · registry.opendock.app");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCatalogDocks([]);
      setCatalogTotal(0);
      options.appendLog("WARN", "var(--warning)", message);
    }
  }

  return {
    catalogDocks,
    catalogTotal,
    refreshCatalogFromRegistry,
    setCatalogDocks,
  };
}

export function useDockDetailController(options: DetailControllerOptions) {
  const [dockDetails, setDockDetails] = useState<Record<string, Dock>>({});
  const [versionTotal, setVersionTotal] = useState(0);

  useEffect(() => {
    if (!options.baseDetail || options.dockView !== "detail") return;
    let cancelled = false;
    const load = async () => {
      try {
        const [detailResponse, versionsResponse] = await Promise.all([
          requestDockDetail(dockFullId(options.baseDetail!)),
          requestDockVersions(dockFullId(options.baseDetail!), options.versionPage, options.versionPageSize),
        ]);
        if (cancelled) return;
        const versions = normalizeRegistryVersions(versionsResponse);
        setVersionTotal(versionsResponse.total ?? versions.length);
        setDockDetails((current) => ({
          ...current,
          [options.detailKey]: mergeRegistryDockDetail(options.baseDetail!, detailResponse, versions),
        }));
      } catch (error) {
        if (!cancelled) {
          options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [options.detailKey, options.dockView, options.versionPage, options.versionPageSize]);

  async function refreshDockDetail(dock: Dock) {
    const dockId = dockFullId(dock);
    const base = findDockByKey([...options.catalogDocks, dock], dockId) ?? dock;
    const [detailResponse, versionsResponse] = await Promise.all([
      requestDockDetail(dockId),
      requestDockVersions(dockId, 1, options.versionPageSize),
    ]);
    const versions = normalizeRegistryVersions(versionsResponse);
    setVersionTotal(versionsResponse.total ?? versions.length);
    const freshDock = mergeRegistryDockDetail(base, detailResponse, versions);
    setDockDetails((current) => ({
      ...current,
      [dockId]: freshDock,
    }));
    options.setCatalogDocks((current) =>
      current.map((item) => (dockFullId(item) === dockId ? mergeRegistryDockDetail(item, detailResponse, versions) : item)),
    );
    return freshDock;
  }

  return {
    dockDetails,
    refreshDockDetail,
    setDockDetails,
    setVersionTotal,
    versionTotal,
  };
}
