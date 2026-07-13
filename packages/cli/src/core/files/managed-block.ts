import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { textChecksum } from "./checksum.js";

export interface ManagedBlock {
  startIndex: number;
  endIndex: number;
  content: string;
}

function markerIndices(content: string, marker: string): number[] {
  const indices: number[] = [];
  let offset = 0;
  while (offset <= content.length - marker.length) {
    const index = content.indexOf(marker, offset);
    if (index < 0) break;
    indices.push(index);
    offset = index + marker.length;
  }
  return indices;
}

export class ManagedBlockCodec {
  constructor(
    private readonly dockId: string,
    private readonly markerId: string,
    private readonly path: string,
  ) {}

  marker(): { start: string; end: string } {
    return {
      start: `<!-- OPENDOCK:START id=${this.markerId} dock=${this.dockId} path=${this.path} -->`,
      end: `<!-- OPENDOCK:END id=${this.markerId} dock=${this.dockId} path=${this.path} -->`,
    };
  }

  blockFor(content: string): string {
    assertNoOpenDockMarker(content, this.path);
    const { start, end } = this.marker();
    return `${start}\n${content.trimEnd()}\n${end}\n`;
  }

  extract(content: string): ManagedBlock | undefined {
    const { start, end } = this.marker();
    const startIndices = markerIndices(content, start);
    const endIndices = markerIndices(content, end);
    const startIndex = startIndices[0];
    const endIndex = endIndices[0];
    if (startIndices.length === 0 && endIndices.length === 0) {
      return undefined;
    }

    if (
      startIndices.length !== 1 ||
      endIndices.length !== 1 ||
      startIndex === undefined ||
      endIndex === undefined ||
      endIndex < startIndex + start.length
    ) {
      throw new Error(
        `invalid managed block structure for ${this.path}: expected exactly one matching marker pair`,
      );
    }

    const bodyStart = startIndex + start.length;
    const body = content.slice(bodyStart, endIndex).replace(/^\n|\n$/g, "");
    assertNoOpenDockMarker(body, this.path);
    let blockEnd = endIndex + end.length;
    if (content.slice(blockEnd, blockEnd + 2) === "\r\n") {
      blockEnd += 2;
    } else if (content[blockEnd] === "\n") {
      blockEnd += 1;
    }
    return {
      startIndex,
      endIndex: blockEnd,
      content: body,
    };
  }

  currentChecksum(path: string): string | undefined {
    if (!existsSync(path)) {
      return undefined;
    }
    const block = this.extract(readFileSync(path, "utf8"));
    return block ? textChecksum(block.content.trimEnd()) : undefined;
  }

  upsert(path: string, content: string): number | undefined {
    const block = this.blockFor(content);
    if (!existsSync(path)) {
      writeFileSync(path, block);
      return 0;
    }

    const current = readFileSync(path, "utf8");
    const existing = this.extract(current);
    if (existing) {
      const next = `${current.slice(0, existing.startIndex)}${block}${current.slice(
        existing.endIndex,
      )}`;
      writeFileSync(path, next);
      return undefined;
    }

    if (current === "") {
      writeFileSync(path, block);
      return 0;
    }
    const separator = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(path, `${current}${separator}${block}`);
    return separator.length;
  }

  remove(path: string, prefixNewlines?: number): "deleted" | "missing" | "updated" {
    if (!existsSync(path)) {
      return "missing";
    }
    const current = readFileSync(path, "utf8");
    const existing = this.extract(current);
    if (!existing) {
      return "missing";
    }

    let removalStart = existing.startIndex;
    if (prefixNewlines !== undefined) {
      if (!Number.isInteger(prefixNewlines) || prefixNewlines < 0 || prefixNewlines > 2) {
        throw new Error(`invalid managed block prefix record for ${this.path}`);
      }
      const prefix = "\n".repeat(prefixNewlines);
      if (current.slice(removalStart - prefix.length, removalStart) !== prefix) {
        throw new Error(`managed block prefix mismatch: ${this.path}`);
      }
      removalStart -= prefix.length;
    }
    const next = `${current.slice(0, removalStart)}${current.slice(existing.endIndex)}`;
    if (next === "" || (prefixNewlines === undefined && next.trim() === "")) {
      rmSync(path);
      return "deleted";
    }
    writeFileSync(path, next);
    return "updated";
  }
}

export function assertNoOpenDockMarker(content: string, path: string): void {
  if (content.includes("<!-- OPENDOCK:START") || content.includes("<!-- OPENDOCK:END")) {
    throw new Error(`managed block content cannot contain OpenDock markers: ${path}`);
  }
}
