import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = process.cwd();
const outputDir = join(rootDir, "dist", "publish", "github");
const githubRepository =
  process.env.OPENDOCK_GITHUB_REPOSITORY ??
  process.env.GITHUB_REPOSITORY ??
  "JeongYunSung/OpenDock";
const packageOwner = githubRepository.split("/")[0]?.toLowerCase() ?? "opendock";
const repositoryUrl = `https://github.com/${githubRepository}.git`;
const rootPackage = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
  description?: string;
  engines?: Record<string, string>;
  license?: string;
  name?: string;
  packageManager?: string;
  version?: string;
};
const rootPackageName = rootPackage.name?.toLowerCase() ?? "opendock";
const packageName = process.env.OPENDOCK_GITHUB_PACKAGE ?? `@${packageOwner}/${rootPackageName}`;

if (!rootPackage.version) {
  throw new Error("package.json must define a version before preparing a GitHub package");
}

if (packageName !== packageName.toLowerCase()) {
  throw new Error(`GitHub Packages npm package name must be lowercase: ${packageName}`);
}

rmSync(outputDir, { force: true, recursive: true });
mkdirSync(join(outputDir, "bin"), { recursive: true });
mkdirSync(join(outputDir, "assets"), { recursive: true });

cpSync(
  join(rootDir, "assets", "opendock-logo-96.png"),
  join(outputDir, "assets", "opendock-logo-96.png"),
);
cpSync(join(rootDir, "bin", "opendock"), join(outputDir, "bin", "opendock"));
cpSync(join(rootDir, "docs"), join(outputDir, "docs"), { recursive: true });
cpSync(join(rootDir, "examples"), join(outputDir, "examples"), { recursive: true });
cpSync(join(rootDir, "CHANGELOG.md"), join(outputDir, "CHANGELOG.md"));

for (const file of readdirSync(rootDir)) {
  if (file === "README.md" || /^README\.[a-z]{2}\.md$/.test(file)) {
    cpSync(join(rootDir, file), join(outputDir, file));
  }
}

const publishPackage = {
  name: packageName,
  version: rootPackage.version,
  description: rootPackage.description ?? "Simple AI setup for every workspace.",
  type: "module",
  license: rootPackage.license ?? "MIT",
  bin: {
    opendock: "bin/opendock",
  },
  files: [
    "bin",
    "assets/opendock-logo-96.png",
    "docs",
    "examples",
    "CHANGELOG.md",
    "README.md",
    "README.*.md",
  ],
  engines: rootPackage.engines,
  packageManager: rootPackage.packageManager,
  repository: {
    type: "git",
    url: repositoryUrl,
  },
  publishConfig: {
    registry: "https://npm.pkg.github.com",
  },
};

writeFileSync(join(outputDir, "package.json"), `${JSON.stringify(publishPackage, null, 2)}\n`);

console.log(`Prepared ${packageName}@${rootPackage.version} in ${outputDir}`);
