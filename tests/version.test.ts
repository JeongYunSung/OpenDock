import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/constants.js";

interface PackageJson {
  version?: string;
}

describe("OpenDock version metadata", () => {
  it("keeps the CLI version aligned with package.json", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(VERSION).toBe(packageJson.version);
  });
});
