import type {
  Dock,
  DockVersion,
  InstalledDockRecord,
  RegistryDockDetail,
  RegistryDockSummary,
  RegistryDockVersionGroup,
  RegistryDockVersionItem,
  RegistryDockVersionsResponse,
} from "./data";
import { platformLabel } from "./platform-label";

export function dockFullId(dock: Pick<Dock, "id" | "fullId" | "owner">) {
  if (dock.fullId) return dock.fullId;
  return dock.owner ? `${dock.owner}/${dock.id}` : dock.id;
}

export function dockOwnerFromId(id?: string | null) {
  if (!id?.includes("/")) return undefined;
  return id.split("/")[0] || undefined;
}

export function dockPublisherLabel(dock: Pick<Dock, "id" | "fullId" | "owner" | "publisher">) {
  return dock.publisher ?? dock.owner ?? dockOwnerFromId(dock.fullId) ?? dockOwnerFromId(dock.id);
}

function dockShortId(id: string) {
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
    gradient: dockGradient(index),
    desc: summary.summary,
    primaryTag: tags[0] ?? "dock",
    secondaryTag: tags[1] ?? "workspace",
    extraTagCount: String(Math.max(tags.length - 2, 0)),
    downloadLabel: String(summary.downloads ?? 0),
    downloads: summary.downloads ?? 0,
    stars: summary.stars ?? 0,
    fallbackSortRank: Math.max(1, 999 - index),
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
    searchTerms: tags.length > 0 ? tags.slice(0, 5) : ["install"]
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
    searchTerms: (detail.tags ?? base.tags).slice(0, 5),
    platforms: detail.platforms ?? base.platforms,
    publisher: detail.publisher?.nickname ?? detail.owner ?? base.publisher,
    official: detail.official,
    logoUrl: detail.logo?.url ?? base.logoUrl ?? null,
    updatedAt: detail.updatedAt ?? base.updatedAt,
    downloads: detail.downloads ?? base.downloads,
    stars: detail.stars ?? base.stars ?? 0,
    downloadLabel: String(detail.downloads ?? base.downloads ?? base.downloadLabel)
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
        platform: platforms.map((platform) => platform.platform).filter(isNonEmptyString).map(platformLabel).join(" · "),
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
    platform: platforms?.map(platformLabel).join(" · ") || version.platform
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
  const owner = dockOwnerFromId(record.id);
  return {
    id: short,
    short,
    fullId: record.id,
    owner,
    name: short,
    gradient: dockGradient(fallbackIndex),
    desc: record.name ?? `${record.id}@${record.version}`,
    primaryTag: record.platform ?? "dock",
    secondaryTag: "installed",
    extraTagCount: "0",
    downloadLabel: "0",
    downloads: 0,
    stars: 0,
    fallbackSortRank: fallbackIndex,
    version: record.version,
    size: `${record.files?.length ?? 0} files`,
    checksum: record.checksum ?? "-",
    readmeTitle: record.name ?? short,
    readmeIntro: `${record.id} is installed in this workspace.`,
    publisher: owner,
    official: false,
    platforms: record.platform ? [record.platform] : [],
    tags: [record.platform ?? "dock", "installed"],
    searchTerms: ["install"]
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
