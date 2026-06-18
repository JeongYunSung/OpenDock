import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  dockFullId,
  normalizeRegistryDock,
  type Dock,
  type DockStarResponse,
  type MyDock,
  type MyDocksCounts,
} from "./data";
import {
  emptyMyDocksCounts,
  requestMyDocks,
  requestMyStars,
  requestSetDockStar,
  requestStarStatus,
} from "./registry-client";

interface AccountDocksControllerOptions {
  appendLog: (level: string, color: string, message: string) => void;
  catalogDocks: Dock[];
  detailKey: string;
  loggedIn: boolean;
  pageSize: number;
  setCatalogDocks: Dispatch<SetStateAction<Dock[]>>;
  setDockDetails: Dispatch<SetStateAction<Record<string, Dock>>>;
  signInToStar: string;
}

export function useAccountDocksController(options: AccountDocksControllerOptions) {
  const [starredDockIds, setStarredDockIds] = useState<Record<string, boolean>>({});
  const [starUpdatingId, setStarUpdatingId] = useState("");
  const [myDocks, setMyDocks] = useState<MyDock[]>([]);
  const [myDocksPage, setMyDocksPage] = useState(1);
  const [myDocksTotal, setMyDocksTotal] = useState(0);
  const [myDocksCounts, setMyDocksCounts] = useState<MyDocksCounts>(() => emptyMyDocksCounts());
  const [myStarredDocks, setMyStarredDocks] = useState<Dock[]>([]);

  useEffect(() => {
    if (!options.loggedIn) {
      setStarredDockIds({});
      setMyStarredDocks([]);
      setMyDocks([]);
      return;
    }
    let cancelled = false;
    const ids = [
      ...options.catalogDocks.map((dock) => dockFullId(dock)),
      ...(options.detailKey ? [options.detailKey] : []),
    ].filter((id, index, values) => id && values.indexOf(id) === index);
    void requestStarStatus(ids)
      .then((response) => {
        if (cancelled) return;
        setStarredDockIds((current) => {
          const next = { ...current };
          for (const item of response.items ?? []) next[item.id] = item.starred;
          return next;
        });
      })
      .catch((error) => {
        if (!cancelled) options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [options.loggedIn, options.catalogDocks, options.detailKey]);

  useEffect(() => {
    if (!options.loggedIn) {
      resetAccountDocks();
      return;
    }
    void refreshMyStars();
  }, [options.loggedIn]);

  useEffect(() => {
    if (!options.loggedIn) return;
    void refreshMyDocks(myDocksPage);
  }, [options.loggedIn, myDocksPage]);

  async function refreshMyStars() {
    try {
      const response = await requestMyStars();
      const docks = (response.items ?? []).map((item, index) => normalizeRegistryDock(item.dock, index));
      setMyStarredDocks(docks);
      setStarredDockIds((current) => ({
        ...current,
        ...Object.fromEntries(docks.map((dock) => [dockFullId(dock), true])),
      }));
    } catch (error) {
      options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshMyDocks(page: number) {
    try {
      const response = await requestMyDocks(page, options.pageSize);
      setMyDocks(response.items ?? []);
      setMyDocksTotal(response.total ?? response.items?.length ?? 0);
      setMyDocksCounts(response.counts ?? emptyMyDocksCounts());
      if (response.page && response.page !== page) setMyDocksPage(response.page);
    } catch (error) {
      options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    }
  }

  async function toggleDockStar(dock: Dock) {
    const dockId = dockFullId(dock);
    if (starUpdatingId) return;
    if (!options.loggedIn) {
      options.appendLog("WARN", "var(--warning)", options.signInToStar);
      return;
    }
    const nextStarred = !starredDockIds[dockId];
    setStarUpdatingId(dockId);
    try {
      const response = await requestSetDockStar(dockId, nextStarred);
      applyDockStarResponse(response);
      await refreshMyStars();
    } catch (error) {
      options.appendLog("WARN", "var(--warning)", error instanceof Error ? error.message : String(error));
    } finally {
      setStarUpdatingId("");
    }
  }

  function applyDockStarResponse(response: DockStarResponse) {
    const updateDock = (dock: Dock) =>
      dockFullId(dock) === response.id ? { ...dock, stars: response.stars } : dock;
    setStarredDockIds((current) => ({ ...current, [response.id]: response.starred }));
    options.setCatalogDocks((current) => current.map(updateDock));
    options.setDockDetails((current) =>
      Object.fromEntries(Object.entries(current).map(([key, dock]) => [key, updateDock(dock)])),
    );
    setMyStarredDocks((current) => {
      if (!response.starred) return current.filter((dock) => dockFullId(dock) !== response.id);
      return current.map(updateDock);
    });
  }

  function resetAccountDocks() {
    setStarredDockIds({});
    setMyDocks([]);
    setMyDocksPage(1);
    setMyDocksTotal(0);
    setMyDocksCounts(emptyMyDocksCounts());
    setMyStarredDocks([]);
  }

  return {
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
  };
}
