import { useEffect, useMemo, useRef, useState } from "react";
import {
  dockFromInstalledRecord,
  dockFullId,
  mergeRegistryDockDetail,
  normalizeRegistryDock,
  type Dock,
  type InstalledDockRecord,
} from "./data";
import { findDockByKey } from "./display";
import { requestDockDetail } from "./registry-client";

const INSTALLED_METADATA_RETRY_MS = 60_000;

interface InstalledDockMetadataOptions {
  appendLog: (level: string, color: string, message: string) => void;
  catalogDocks: Dock[];
  installedRecords: InstalledDockRecord[];
}

export function useInstalledDockMetadata(options: InstalledDockMetadataOptions) {
  const [metadataById, setMetadataById] = useState<Record<string, Dock>>({});
  const appendLogRef = useRef(options.appendLog);
  const failedIdsRef = useRef(new Map<string, number>());
  const inFlightIdsRef = useRef(new Set<string>());
  appendLogRef.current = options.appendLog;

  useEffect(() => {
    const installedIds = new Set(options.installedRecords.map((record) => record.id));
    failedIdsRef.current = new Map([...failedIdsRef.current].filter(([id]) => installedIds.has(id)));

    setMetadataById((current) => {
      let changed = false;
      const next: Record<string, Dock> = {};

      for (const [id, dock] of Object.entries(current)) {
        if (!installedIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = dock;
      }

      for (const record of options.installedRecords) {
        const catalogDock = findDockByKey(options.catalogDocks, record.id);
        if (!catalogDock) continue;
        if (next[record.id] !== catalogDock) {
          next[record.id] = catalogDock;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [options.catalogDocks, options.installedRecords]);

  useEffect(() => {
    if (options.installedRecords.length === 0) return;

    let cancelled = false;
    const missingRecords = options.installedRecords.filter((record) => {
      if (metadataById[record.id]) return false;
      if (findDockByKey(options.catalogDocks, record.id)) return false;
      if (inFlightIdsRef.current.has(record.id)) return false;
      const failedAt = failedIdsRef.current.get(record.id);
      if (failedAt && Date.now() - failedAt < INSTALLED_METADATA_RETRY_MS) return false;
      return true;
    });
    if (missingRecords.length === 0) return;

    for (const record of missingRecords) {
      inFlightIdsRef.current.add(record.id);
    }

    void Promise.all(
      missingRecords.map(async (record, index) => {
        try {
          const detail = await requestDockDetail(record.id);
          if (cancelled) return;
          const fallback = dockFromInstalledRecord(record, index);
          const summaryDock = normalizeRegistryDock(detail, index);
          const dock = mergeRegistryDockDetail({ ...fallback, ...summaryDock }, detail);
          setMetadataById((current) => {
            if (current[record.id] && dockFullId(current[record.id]) === dockFullId(dock)) return current;
            return { ...current, [record.id]: dock };
          });
        } catch (error) {
          if (!cancelled) {
            failedIdsRef.current.set(record.id, Date.now());
            appendLogRef.current(
              "WARN",
              "var(--warning)",
              `installed dock metadata unavailable for ${record.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        } finally {
          inFlightIdsRef.current.delete(record.id);
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [metadataById, options.catalogDocks, options.installedRecords]);

  return useMemo(() => Object.values(metadataById), [metadataById]);
}
