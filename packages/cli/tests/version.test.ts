import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/constants.js";
import {
  checkProductUpdate,
  compareVersionIdentifiers,
  isVersionNewer,
  normalizeReleaseVersion,
  PRODUCT_RELEASE_LATEST_URL,
} from "../src/product-update.js";

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
    expect(packageJson.files).toContain("CHANGELOG.md");
    expect(buildScript).toContain('const bundlePath = join(binDir, "opendock")');
    expect(buildScript).not.toContain("wrapperPath");
    expect(prepareScript).toContain('join(packageDir, "bin", "opendock")');
    expect(prepareScript).toContain('join(repoRoot, "CHANGELOG.md")');
    expect(prepareScript).not.toContain("opendock.js");
  });

  it("normalizes and compares GitHub release versions", () => {
    expect(normalizeReleaseVersion("v0.1.34")).toBe("0.1.34");
    expect(compareVersionIdentifiers("0.1.35", "0.1.34")).toBe(1);
    expect(compareVersionIdentifiers("0.2.0", "0.1.99")).toBe(1);
    expect(compareVersionIdentifiers("0.1.34", "0.1.34")).toBe(0);
    expect(compareVersionIdentifiers("0.1.33", "0.1.34")).toBe(-1);
    expect(compareVersionIdentifiers("build-a", "0.1.34")).toBeNull();
    expect(isVersionNewer("0.1.35", "0.1.34")).toBe(true);
    expect(isVersionNewer("0.1.34", "0.1.34")).toBe(false);
  });

  it("checks the latest OpenDock release from GitHub metadata", async () => {
    const requests: string[] = [];
    const update = await checkProductUpdate({
      currentVersion: "0.1.34",
      fetchImpl: async (url) => {
        requests.push(String(url));
        return new Response(
          JSON.stringify({
            html_url: "https://github.com/JeongYunSung/OpenDock/releases/tag/v0.1.35",
            name: "OpenDock 0.1.35",
            published_at: "2026-06-19T00:00:00Z",
            tag_name: "v0.1.35",
          }),
          { status: 200 },
        );
      },
    });

    expect(requests).toEqual([PRODUCT_RELEASE_LATEST_URL]);
    expect(update).toEqual({
      currentVersion: "0.1.34",
      latestVersion: "0.1.35",
      name: "OpenDock 0.1.35",
      publishedAt: "2026-06-19T00:00:00Z",
      releaseUrl: "https://github.com/JeongYunSung/OpenDock/releases/tag/v0.1.35",
      updateAvailable: true,
    });
  });
});
