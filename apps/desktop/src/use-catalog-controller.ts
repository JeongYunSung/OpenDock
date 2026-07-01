import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  const [loadedCatalogRequestKey, setLoadedCatalogRequestKey] = useState<string | null>(null);
  const [failedCatalogRequestKey, setFailedCatalogRequestKey] = useState<string | null>(null);
  const [pendingCatalogRequestKey, setPendingCatalogRequestKey] = useState<string | null>(null);
  const currentCatalogRequestKey = catalogRequestKey(options);
  const currentCatalogRequestKeyRef = useRef(currentCatalogRequestKey);
  const loadedCatalogRequestKeyRef = useRef<string | null>(null);
  currentCatalogRequestKeyRef.current = currentCatalogRequestKey;
  const catalogLoading =
    pendingCatalogRequestKey === currentCatalogRequestKey ||
    (loadedCatalogRequestKey !== currentCatalogRequestKey && failedCatalogRequestKey !== currentCatalogRequestKey);

  useEffect(() => {
    let cancelled = false;
    const requestKey = currentCatalogRequestKey;
    setPendingCatalogRequestKey(requestKey);
    setFailedCatalogRequestKey((current) => (current === requestKey ? null : current));
    void requestCatalog(options.sortMode, options.searchQuery, options.catalogPage, options.catalogPageSize)
      .then((response) => {
        if (cancelled || currentCatalogRequestKeyRef.current !== requestKey) return;
        const nextDocks = response.items.map((item, index) => normalizeRegistryDock(item, index));
        loadedCatalogRequestKeyRef.current = requestKey;
        setLoadedCatalogRequestKey(requestKey);
        setFailedCatalogRequestKey(null);
        setPendingCatalogRequestKey(null);
        setCatalogDocks(nextDocks);
        setCatalogTotal(response.total ?? nextDocks.length);
      })
      .catch((error) => {
        if (!cancelled) {
          if (currentCatalogRequestKeyRef.current !== requestKey) return;
          const message = error instanceof Error ? error.message : String(error);
          setFailedCatalogRequestKey(requestKey);
          setPendingCatalogRequestKey(null);
          if (loadedCatalogRequestKeyRef.current !== requestKey) {
            setCatalogDocks([]);
            setCatalogTotal(0);
          }
          options.appendLog("WARN", "var(--warning)", message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [options.searchQuery, options.sortMode, options.catalogPage, options.catalogPageSize]);

  async function refreshCatalogFromRegistry() {
    const requestKey = currentCatalogRequestKey;
    setPendingCatalogRequestKey(requestKey);
    setFailedCatalogRequestKey((current) => (current === requestKey ? null : current));
    try {
      const response = await requestCatalog(options.sortMode, options.searchQuery, options.catalogPage, options.catalogPageSize);
      if (currentCatalogRequestKeyRef.current !== requestKey) return;
      const nextDocks = response.items.map((item, index) => normalizeRegistryDock(item, index));
      loadedCatalogRequestKeyRef.current = requestKey;
      setLoadedCatalogRequestKey(requestKey);
      setFailedCatalogRequestKey(null);
      setPendingCatalogRequestKey(null);
      setCatalogDocks(nextDocks);
      setCatalogTotal(response.total ?? nextDocks.length);
      options.appendLog("OK", "var(--success)", "registry refreshed · registry.opendock.app");
    } catch (error) {
      if (currentCatalogRequestKeyRef.current !== requestKey) return;
      const message = error instanceof Error ? error.message : String(error);
      setFailedCatalogRequestKey(requestKey);
      setPendingCatalogRequestKey(null);
      if (loadedCatalogRequestKeyRef.current !== requestKey) {
        setCatalogDocks([]);
        setCatalogTotal(0);
      }
      options.appendLog("WARN", "var(--warning)", message);
    }
  }

  return {
    catalogDocks,
    catalogLoading,
    catalogTotal,
    refreshCatalogFromRegistry,
    setCatalogDocks,
  };
}

function catalogRequestKey(options: CatalogControllerOptions) {
  return JSON.stringify({
    limit: options.catalogPageSize,
    page: options.catalogPage,
    query: options.searchQuery.trim(),
    sort: options.sortMode,
  });
}

export function useDockDetailController(options: DetailControllerOptions) {
  const [dockDetails, setDockDetails] = useState<Record<string, Dock>>({});
  const [versionTotal, setVersionTotal] = useState(0);
  const [loadedDetailRequestKey, setLoadedDetailRequestKey] = useState<string | null>(null);
  const [failedDetailRequestKey, setFailedDetailRequestKey] = useState<string | null>(null);
  const [pendingDetailRequestKey, setPendingDetailRequestKey] = useState<string | null>(null);
  const currentDetailRequestKey = detailRequestKey(options);
  const currentDetailRequestKeyRef = useRef(currentDetailRequestKey);
  const activeDetailKeyRef = useRef(options.dockView === "detail" ? options.detailKey : "");
  currentDetailRequestKeyRef.current = currentDetailRequestKey;
  activeDetailKeyRef.current = options.dockView === "detail" ? options.detailKey : "";
  const detailLoading = Boolean(
    currentDetailRequestKey &&
      (pendingDetailRequestKey === currentDetailRequestKey ||
        (loadedDetailRequestKey !== currentDetailRequestKey && failedDetailRequestKey !== currentDetailRequestKey)),
  );

  useEffect(() => {
    if (!options.baseDetail || options.dockView !== "detail") return;
    let cancelled = false;
    const requestKey = currentDetailRequestKey;
    setPendingDetailRequestKey(requestKey);
    setFailedDetailRequestKey((current) => (current === requestKey ? null : current));
    const load = async () => {
      try {
        const [detailResponse, versionsResponse] = await Promise.all([
          requestDockDetail(dockFullId(options.baseDetail!)),
          requestDockVersions(dockFullId(options.baseDetail!), options.versionPage, options.versionPageSize),
        ]);
        if (cancelled || currentDetailRequestKeyRef.current !== requestKey) return;
        const versions = normalizeRegistryVersions(versionsResponse);
        setVersionTotal(versionsResponse.total ?? versions.length);
        setLoadedDetailRequestKey(requestKey);
        setFailedDetailRequestKey(null);
        setPendingDetailRequestKey(null);
        setDockDetails((current) => ({
          ...current,
          [options.detailKey]: mergeRegistryDockDetail(options.baseDetail!, detailResponse, versions),
        }));
      } catch (error) {
        if (!cancelled && currentDetailRequestKeyRef.current === requestKey) {
          setFailedDetailRequestKey(requestKey);
          setPendingDetailRequestKey(null);
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
    if (activeDetailKeyRef.current === dockId) {
      setVersionTotal(versionsResponse.total ?? versions.length);
    }
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
    detailLoading,
    dockDetails,
    refreshDockDetail,
    setDockDetails,
    setVersionTotal,
    versionTotal,
  };
}

function detailRequestKey(options: DetailControllerOptions) {
  if (!options.baseDetail || options.dockView !== "detail" || !options.detailKey) return "";
  return JSON.stringify({
    dock: options.detailKey,
    limit: options.versionPageSize,
    page: options.versionPage,
  });
}
