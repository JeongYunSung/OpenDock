import { useEffect, useState } from "react";

const DEFAULT_CATALOG_PAGE_LIMIT = 12;
const DEFAULT_VERSION_PAGE_LIMIT = 6;

interface ResponsivePageSizes {
  catalog: number;
  versions: number;
}

export function useResponsivePageSizes() {
  const [sizes, setSizes] = useState<ResponsivePageSizes>(() => readResponsivePageSizes());

  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = readResponsivePageSizes();
        setSizes((current) =>
          current.catalog === next.catalog && current.versions === next.versions ? current : next,
        );
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, []);

  return sizes;
}

function readResponsivePageSizes(): ResponsivePageSizes {
  if (typeof window === "undefined") {
    return { catalog: DEFAULT_CATALOG_PAGE_LIMIT, versions: DEFAULT_VERSION_PAGE_LIMIT };
  }
  return {
    catalog: catalogPageLimitForViewport(window.innerWidth, window.innerHeight),
    versions: versionPageLimitForViewport(window.innerWidth, window.innerHeight),
  };
}

function catalogPageLimitForViewport(width: number, height: number) {
  const columns = catalogColumnsForViewport(width);
  const baseRows = width <= 520 ? 5 : 3;
  const extraRows = Math.max(0, Math.floor((height - 980) / 420));
  return Math.min(24, columns * Math.min(8, baseRows + extraRows));
}

function catalogColumnsForViewport(width: number) {
  if (width <= 520) return 1;
  if (width <= 980) return 2;
  if (width >= 1600) return 4;
  return 3;
}

function versionPageLimitForViewport(width: number, height: number) {
  const baseRows = width <= 980 ? 5 : 6;
  const extraRows = Math.max(0, Math.floor((height - 900) / 180));
  return Math.min(18, baseRows + extraRows);
}
