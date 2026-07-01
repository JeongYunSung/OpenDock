import { invoke } from "@tauri-apps/api/core";
import type {
  AccountProfile,
  DockStarResponse,
  DockStarStatusResponse,
  MyDocksCounts,
  MyDocksResponse,
  MyStarsResponse,
  RegistryDockDetail,
  RegistryDockSearchResponse,
  RegistryDockVersionsResponse,
  SortMode,
} from "./data";
import { isTauriRuntime } from "./tauri-runtime";

const REGISTRY_ORIGIN = "https://registry.opendock.app";
const REGISTRY_REQUEST_TIMEOUT_MS = 20_000;
const registryAssetCache = new Map<string, string | null>();
const registryAssetRequests = new Map<string, Promise<string | null>>();

export async function requestCatalog(
  sortMode: SortMode,
  query: string,
  page: number,
  limit: number,
) {
  const sort = registrySortMode(sortMode);
  const trimmedQuery = query.trim();
  if (isTauriRuntime()) {
    return invoke<RegistryDockSearchResponse>("opendock_catalog", {
      page,
      limit,
      sort,
      query: trimmedQuery || null,
    });
  }
  return requestRegistryJson<RegistryDockSearchResponse>("/v1/docks", {
    sort,
    page: String(page),
    limit: String(limit),
    ...(trimmedQuery ? { query: trimmedQuery } : {}),
  });
}

export async function requestDockDetail(dockId: string) {
  if (isTauriRuntime()) return invoke<RegistryDockDetail>("opendock_dock_detail", { dockId });
  return requestRegistryJson<RegistryDockDetail>(`/v1/docks/${dockId}`);
}

export async function requestDockVersions(dockId: string, page: number, limit: number) {
  if (isTauriRuntime()) {
    return invoke<RegistryDockVersionsResponse>("opendock_dock_versions", { dockId, page, limit });
  }
  return requestRegistryJson<RegistryDockVersionsResponse>(`/v1/docks/${dockId}/versions`, {
    page: String(page),
    limit: String(limit),
  });
}

export async function requestStarStatus(ids: string[]) {
  if (ids.length === 0) return { items: [] } satisfies DockStarStatusResponse;
  if (!isTauriRuntime()) {
    return { items: ids.map((id) => ({ id, starred: false })) } satisfies DockStarStatusResponse;
  }
  return invoke<DockStarStatusResponse>("opendock_star_status", { ids });
}

export async function requestMyStars() {
  if (!isTauriRuntime()) return { items: [] } satisfies MyStarsResponse;
  return invoke<MyStarsResponse>("opendock_my_stars");
}

export async function requestMyDocks(page: number, limit: number) {
  if (!isTauriRuntime()) {
    return {
      counts: emptyMyDocksCounts(),
      items: [],
      limit,
      page,
      total: 0,
    } satisfies MyDocksResponse;
  }
  return invoke<MyDocksResponse>("opendock_my_docks", { page, limit });
}

export async function requestAccountProfile() {
  if (!isTauriRuntime()) return null;
  return invoke<AccountProfile>("opendock_account_profile");
}

export async function requestUpdateAccountProfile(nickname: string) {
  const normalized = nickname.trim();
  if (!isTauriRuntime()) {
    return {
      id: "browser-demo",
      email: "hello@opendock.app",
      displayName: null,
      nickname: normalized,
      official: false,
      avatarUrl: null,
      hostedDomain: null,
    } satisfies AccountProfile;
  }
  return invoke<AccountProfile>("opendock_update_account_profile", { nickname: normalized });
}

export async function requestSetDockStar(dockId: string, starred: boolean) {
  if (!isTauriRuntime()) {
    return { id: dockId, starred, stars: starred ? 1 : 0 } satisfies DockStarResponse;
  }
  return invoke<DockStarResponse>(starred ? "opendock_star_dock" : "opendock_unstar_dock", {
    dockId,
  });
}

export async function loadRegistryAssetUrl(url?: string | null) {
  if (!url) return null;
  if (registryAssetCache.has(url)) return registryAssetCache.get(url) ?? null;
  const existing = registryAssetRequests.get(url);
  if (existing) return existing;
  const request = (async () => {
    try {
      const value = isTauriRuntime()
        ? await invoke<string>("opendock_registry_asset_data_url", { url })
        : resolveRegistryAssetUrl(url);
      registryAssetCache.set(url, value);
      return value;
    } catch {
      const fallback = resolveRegistryAssetUrl(url);
      registryAssetCache.set(url, fallback);
      return fallback;
    } finally {
      registryAssetRequests.delete(url);
    }
  })();
  registryAssetRequests.set(url, request);
  return request;
}

export function emptyMyDocksCounts(): MyDocksCounts {
  return {
    all: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    unavailable: 0,
    hidden: 0,
  };
}

function registrySortMode(mode: SortMode) {
  return mode === "recent" ? "updated" : mode;
}

async function requestRegistryJson<T>(path: string, params: Record<string, string> = {}) {
  const url = new URL(`/registry${path}`, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetchRegistryJson(url);
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(`registry returned ${response.status} for ${url.pathname}${detail ? `: ${detail}` : ""}`);
  }
  return response.json() as Promise<T>;
}

async function fetchRegistryJson(url: URL) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REGISTRY_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json", "cache-control": "no-cache" },
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`registry request timed out after ${REGISTRY_REQUEST_TIMEOUT_MS}ms for ${url.pathname}`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function resolveRegistryAssetUrl(url?: string | null) {
  if (!url || typeof window === "undefined") return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== REGISTRY_ORIGIN) return null;
    const canUseDevProxy = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (canUseDevProxy) {
      return `/registry${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
