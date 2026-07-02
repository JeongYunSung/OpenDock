import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { textChecksum } from "./checksum.js";

export interface ManagedBlock {
  startIndex: number;
  endIndex: number;
  content: string;
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
    const startIndex = content.indexOf(start);
    if (startIndex < 0) {
      return undefined;
    }
    const endRelativeIndex = content.slice(startIndex).indexOf(end);
    if (endRelativeIndex < 0) {
      return undefined;
    }
    const bodyStart = startIndex + start.length;
    const endIndex = startIndex + endRelativeIndex;
    return {
      startIndex,
      endIndex: endIndex + end.length,
      content: content.slice(bodyStart, endIndex).replace(/^\n|\n$/g, ""),
    };
  }

  currentChecksum(path: string): string | undefined {
    if (!existsSync(path)) {
      return undefined;
    }
    const block = this.extract(readFileSync(path, "utf8"));
    return block ? textChecksum(block.content.trimEnd()) : undefined;
  }

  upsert(path: string, content: string): void {
    const block = this.blockFor(content);
    if (!existsSync(path)) {
      writeFileSync(path, block);
      return;
    }

    const current = readFileSync(path, "utf8");
    const existing = this.extract(current);
    if (existing) {
      const next = `${current.slice(0, existing.startIndex)}${block.trimEnd()}${current.slice(
        existing.endIndex,
      )}`;
      writeFileSync(path, next.endsWith("\n") ? next : `${next}\n`);
      return;
    }

    const prefix = current.trimEnd();
    writeFileSync(path, prefix === "" ? block : `${prefix}\n\n${block}`);
  }

  remove(path: string): "deleted" | "missing" | "updated" {
    if (!existsSync(path)) {
      return "missing";
    }
    const current = readFileSync(path, "utf8");
    const existing = this.extract(current);
    if (!existing) {
      return "missing";
    }

    const next = `${current.slice(0, existing.startIndex)}${current.slice(existing.endIndex)}`
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (next === "") {
      rmSync(path);
      return "deleted";
    }
    writeFileSync(path, `${next}\n`);
    return "updated";
  }
}

export function assertNoOpenDockMarker(content: string, path: string): void {
  if (content.includes("<!-- OPENDOCK:START") || content.includes("<!-- OPENDOCK:END")) {
    throw new Error(`managed block content cannot contain OpenDock markers: ${path}`);
  }
}
