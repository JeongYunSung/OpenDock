import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkdirSeeder } from "../src/core/files/workdir-seeder.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("WorkdirSeeder", () => {
  it("copies declared files into the dock workdir", () => {
    const sourceRoot = tempDir();
    const workdir = tempDir();
    writeFileSync(join(sourceRoot, "oma-config.yaml"), "model_preset: codex\n");

    new WorkdirSeeder().seed(workdir, [
      {
        sourceRoot,
        from: "oma-config.yaml",
        to: ".agents/oma-config.yaml",
      },
    ]);

    expect(readFileSync(join(workdir, ".agents", "oma-config.yaml"), "utf8")).toContain(
      "model_preset: codex",
    );
  });

  it("rejects symlink sources", () => {
    const sourceRoot = tempDir();
    const workdir = tempDir();
    writeFileSync(join(sourceRoot, "target.txt"), "safe\n");
    symlinkSync("target.txt", join(sourceRoot, "link.txt"));

    expect(() =>
      new WorkdirSeeder().seed(workdir, [
        {
          sourceRoot,
          from: "link.txt",
          to: "link.txt",
        },
      ]),
    ).toThrow("workdir file source cannot be a symlink");
    expect(existsSync(join(workdir, "link.txt"))).toBe(false);
  });

  it("rejects unsafe workdir targets", () => {
    const sourceRoot = tempDir();
    const workdir = tempDir();
    writeFileSync(join(sourceRoot, "input.txt"), "safe\n");

    expect(() =>
      new WorkdirSeeder().seed(workdir, [
        {
          sourceRoot,
          from: "input.txt",
          to: "../outside.txt",
        },
      ]),
    ).toThrow("unsafe workdir file target");
    expect(existsSync(join(workdir, "..", "outside.txt"))).toBe(false);
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opendock-workdir-seeder-test-"));
  tempRoots.push(dir);
  return dir;
}
