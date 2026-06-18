import { type Dock, type Lang, type MyDock, type MyDocksCounts, TEXT } from "./data";

export type MyDockReviewGroup = "approved" | "pending" | "rejected" | "unavailable";

export function accountStatsFor(counts: MyDocksCounts, stars: number) {
  return {
    submitted: counts.all,
    approved: counts.approved,
    pending: counts.pending,
    rejected: counts.rejected,
    unavailable: counts.unavailable,
    hidden: counts.hidden,
    stars,
  };
}

export function myDockReviewGroup(dock: MyDock): MyDockReviewGroup {
  const status = myDockStatus(dock);
  if (status === "approved") return "approved";
  if (status === "pending") return "pending";
  if (status === "rejected") return "rejected";
  return "unavailable";
}

export function myDockStatusLabel(status: MyDockReviewGroup, t: (typeof TEXT)[Lang]) {
  if (status === "approved") return t.approved;
  if (status === "pending") return t.pending;
  if (status === "rejected") return t.rejected;
  return t.unavailable;
}

export function dockFromMyDock(dock: MyDock): Dock {
  const reviewGroup = myDockReviewGroup(dock);
  return {
    id: dock.name,
    short: dock.name,
    fullId: dock.id,
    owner: dock.owner ?? dock.id.split("/")[0] ?? "opendock",
    name: dock.name,
    displayName: dock.displayName ?? dock.name,
    gradient: "linear-gradient(135deg,var(--dock-backend-a),var(--dock-backend-b) 55%,var(--dock-backend-c))",
    desc: dock.summary ?? dock.displayName ?? dock.name,
    primaryTag: reviewGroup,
    secondaryTag: dock.hidden ? "hidden" : "submitted",
    extraTagCount: "0",
    downloadLabel: "0",
    downloads: 0,
    stars: 0,
    fallbackSortRank: 0,
    updatedAt: dock.updatedAt ?? dock.submittedAt ?? undefined,
    version: dock.latestApprovedVersion ?? dock.version ?? "-",
    size: "-",
    checksum: "-",
    readmeTitle: dock.displayName ?? dock.name,
    readmeIntro: dock.summary ?? "",
    logoUrl: dock.logo?.url ?? null,
    publisher: dock.owner ?? "opendock",
    official: dock.official,
    platforms: dock.versions?.map((version) => version.platform).filter(Boolean) ?? [],
    tags: [reviewGroup, dock.hidden ? "hidden" : "submitted"],
    searchTerms: ["submitted"],
  };
}

function myDockStatus(dock: MyDock) {
  if (dock.suspended) return "suspended";
  if (dock.hidden) return primaryMyDockVersion(dock)?.status?.toLowerCase() ?? "hidden";
  return dock.status?.toLowerCase() || primaryMyDockVersion(dock)?.status?.toLowerCase() || "pending";
}

function primaryMyDockVersion(dock: MyDock) {
  return dock.versions?.find((version) => version.version === dock.version) ?? dock.versions?.[0] ?? null;
}
