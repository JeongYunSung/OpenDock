import { useEffect, useState, type ReactNode } from "react";
import { type Dock, type Lang, dockFullId } from "./data";
import { platformLabel } from "./platform-label";
import { loadRegistryAssetUrl } from "./registry-client";

export const logoSrc = "/opendock-logo.png";
export const badgeSrc = "/official-badge.png";

type VersionStatusClass = "approved" | "pending" | "rejected" | "revoked" | "hidden" | "suspended" | "unavailable";

export function versionStatusClass(status?: string): VersionStatusClass {
  const normalized = status?.toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "rejected") return "rejected";
  if (normalized === "revoked") return "revoked";
  if (normalized === "hidden") return "hidden";
  if (normalized === "suspended") return "suspended";
  if (normalized === "unavailable") return "unavailable";
  return "pending";
}

export function versionStatusLabel(status?: string) {
  const key = versionStatusClass(status);
  if (key === "approved") return "Approved";
  if (key === "rejected") return "Rejected";
  if (key === "revoked") return "Revoked";
  if (key === "hidden") return "Hidden";
  if (key === "suspended") return "Suspended";
  if (key === "unavailable") return "Unavailable";
  return "Pending review";
}

export function findDockByKey(docks: Dock[], key: string) {
  return docks.find((dock) => dockFullId(dock) === key || dock.id === key || dock.name === key);
}

export function formatDateLabel(value?: string | null) {
  if (!value) return "Jun 14, 2026";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export { platformLabel };

export function installedAtLabel(lang: Lang) {
  return lang === "ko" ? "설치됨" : "Installed";
}

export function KeyboardButton(props: {
  children: ReactNode;
  className?: string;
  ariaLabel: string;
  onOpen: () => void;
}) {
  return (
    <div
      aria-label={props.ariaLabel}
      className={props.className}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        props.onOpen();
      }}
      role="button"
      tabIndex={0}
    >
      {props.children}
    </div>
  );
}

export function IconButton(props: {
  label: string;
  children: ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button aria-label={props.label} className={`icon-button ${props.className ?? ""}`} onClick={props.onClick} type="button">
      {props.children}
    </button>
  );
}

export function DockIcon(props: { dock: Dock; size?: "small" | "large" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const sourceLogoUrl = props.dock.logoUrl ?? null;

  useEffect(() => {
    let cancelled = false;
    setImageFailed(false);
    setLogoUrl(null);
    void loadRegistryAssetUrl(sourceLogoUrl).then((nextLogoUrl) => {
      if (!cancelled) setLogoUrl(nextLogoUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceLogoUrl]);

  const hasRegistryLogo = Boolean(logoUrl && !imageFailed);
  const imageUrl = hasRegistryLogo ? logoUrl : logoSrc;
  const className = ["dock-icon", props.size, "has-logo", hasRegistryLogo ? "" : "fallback-logo"].filter(Boolean).join(" ");
  const label = props.dock.displayName ?? props.dock.short ?? props.dock.id;

  return (
    <div className={className} style={{ background: props.dock.gradient }}>
      <img
        alt={hasRegistryLogo ? `${label} logo` : "OpenDock logo"}
        src={imageUrl ?? logoSrc}
        onError={hasRegistryLogo ? () => setImageFailed(true) : undefined}
      />
    </div>
  );
}
