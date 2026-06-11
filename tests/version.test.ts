import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/constants.js";

interface PackageJson {
  bin?: Record<string, string>;
  files?: string[];
  version?: string;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as PackageJson;
}

describe("OpenDock version metadata", () => {
  it("keeps the CLI version aligned with package.json", () => {
    const packageJson = readPackageJson();

    expect(VERSION).toBe(packageJson.version);
  });

  it("publishes a single executable bin for global installs", () => {
    const packageJson = readPackageJson();
    const buildScript = readFileSync(join(process.cwd(), "scripts", "build.ts"), "utf8");
    const prepareScript = readFileSync(
      join(process.cwd(), "scripts", "prepare-github-package.ts"),
      "utf8",
    );

    expect(packageJson.bin).toEqual({ opendock: "bin/opendock" });
    expect(packageJson.files).toContain("bin");
    expect(buildScript).toContain('const bundlePath = join(binDir, "opendock")');
    expect(buildScript).not.toContain("wrapperPath");
    expect(prepareScript).toContain('join(rootDir, "bin", "opendock")');
    expect(prepareScript).not.toContain("opendock.js");
  });
});
