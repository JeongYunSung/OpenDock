import { dockFullId, type Dock, type OpenDockChangeResult } from "./data";
import type { InstalledDockRow } from "./dock-workspace-model";

export function previewChangeResult(
  operation: "install" | "uninstall" | "update",
  target: string,
  installedRows: InstalledDockRow[],
  dock?: Dock,
): OpenDockChangeResult {
  const version = dock?.version ?? "preview";
  const dockId = dock ? dockFullId(dock) : target;
  if (operation === "uninstall") {
    return {
      operation,
      reports: [
        {
          dockId,
          fileChanges: {
            created: [],
            deleted: ["AGENTS.md"],
            reviewRequired: [],
            updated: [".opendock/dock.lock.yml"],
          },
          filesCreated: 0,
          filesDeleted: 1,
          filesReviewRequired: 0,
          filesUpdated: 1,
          operation,
          status: "uninstalled",
          version,
        },
      ],
      success: true,
      summary: {
        created: [],
        deleted: ["AGENTS.md"],
        reviewRequired: [],
        unchanged: [],
        updated: [".opendock/dock.lock.yml"],
      },
    };
  }
  if (operation === "update") {
    return {
      operation,
      reports: installedRows.map((row) => ({
        dockId: dockFullId(row),
        fileChanges: { created: [], deleted: [], reviewRequired: [], updated: ["AGENTS.md"] },
        filesCreated: 0,
        filesDeleted: 0,
        filesReviewRequired: 0,
        filesUpdated: 1,
        fromVersion: row.version,
        operation,
        status: "updated",
        toVersion: row.version,
        version: row.version,
      })),
      success: true,
      summary: {
        created: [],
        deleted: [],
        reviewRequired: [],
        unchanged: [],
        updated: installedRows.length > 0 ? ["AGENTS.md"] : [],
      },
    };
  }
  return {
    operation,
    reports: [
      {
        dockId,
        fileChanges: { created: ["AGENTS.md", "DESIGN.md"], deleted: [], reviewRequired: [], updated: [] },
        filesCreated: 2,
        filesDeleted: 0,
        filesReviewRequired: 0,
        filesUpdated: 0,
        operation,
        status: "installed",
        toVersion: version,
        version,
      },
    ],
    success: true,
    summary: {
      created: ["AGENTS.md", "DESIGN.md"],
      deleted: [],
      reviewRequired: [],
      unchanged: [],
      updated: [],
    },
  };
}
