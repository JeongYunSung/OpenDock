import { VERSION } from "./constants.js";

export const PRODUCT_RELEASE_OWNER = "JeongYunSung";
export const PRODUCT_RELEASE_REPO = "OpenDock";
export const PRODUCT_RELEASE_LATEST_URL = `https://api.github.com/repos/${PRODUCT_RELEASE_OWNER}/${PRODUCT_RELEASE_REPO}/releases/latest`;

export interface ProductUpdateCheck {
  currentVersion: string;
  latestVersion: string;
  name: string | null;
  publishedAt: string | null;
  releaseUrl: string;
  updateAvailable: boolean;
}

interface GitHubRelease {
  htmlUrl: string;
  name: string | null;
  publishedAt: string | null;
  tagName: string;
}

export async function checkProductUpdate(
  options: { currentVersion?: string; fetchImpl?: typeof fetch } = {},
): Promise<ProductUpdateCheck> {
  const currentVersion = normalizeReleaseVersion(options.currentVersion ?? VERSION);
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": `OpenDock/${currentVersion}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token =
    process.env.OPENDOCK_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetchImpl(PRODUCT_RELEASE_LATEST_URL, {
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `failed to check latest OpenDock release: ${response.status} ${response.statusText}`,
    );
  }

  const release = parseGitHubRelease(await response.json());
  const latestVersion = normalizeReleaseVersion(release.tagName);
  return {
    currentVersion,
    latestVersion,
    name: release.name,
    publishedAt: release.publishedAt,
    releaseUrl: release.htmlUrl,
    updateAvailable: isVersionNewer(latestVersion, currentVersion),
  };
}

export function normalizeReleaseVersion(value: string): string {
  return value.trim().replace(/^v/i, "");
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const comparison = compareVersionIdentifiers(candidate, current);
  return comparison === null
    ? normalizeReleaseVersion(candidate) !== normalizeReleaseVersion(current)
    : comparison > 0;
}

export function compareVersionIdentifiers(left: string, right: string): number | null {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  if (leftParts === null || rightParts === null) {
    return null;
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }
  return 0;
}

function parseVersionParts(value: string): [number, number, number] | null {
  const normalized = normalizeReleaseVersion(value);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseGitHubRelease(value: unknown): GitHubRelease {
  if (!isRecord(value)) {
    throw new Error("GitHub release response must be an object");
  }
  const tagName = value.tag_name;
  const htmlUrl = value.html_url;
  if (typeof tagName !== "string" || tagName.trim() === "") {
    throw new Error("GitHub release response is missing tag_name");
  }
  if (typeof htmlUrl !== "string" || htmlUrl.trim() === "") {
    throw new Error("GitHub release response is missing html_url");
  }
  return {
    htmlUrl,
    name: typeof value.name === "string" ? value.name : null,
    publishedAt: typeof value.published_at === "string" ? value.published_at : null,
    tagName,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
