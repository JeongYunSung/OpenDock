import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = process.cwd();
const repoRoot = resolve(packageDir, "../..");
const outputDir = join(repoRoot, "dist", "publish", "github");
const githubRepository =
  process.env.OPENDOCK_GITHUB_REPOSITORY ??
  process.env.GITHUB_REPOSITORY ??
  "JeongYunSung/OpenDock";
const packageOwner = githubRepository.split("/")[0]?.toLowerCase() ?? "opendock";
const repositoryUrl = `git+https://github.com/${githubRepository}.git`;
const cliPackage = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
  description?: string;
  engines?: Record<string, string>;
  license?: string;
  name?: string;
  packageManager?: string;
  version?: string;
};
const rootPackageName = cliPackage.name?.toLowerCase() ?? "opendock";
const packageName = process.env.OPENDOCK_GITHUB_PACKAGE ?? `@${packageOwner}/${rootPackageName}`;

if (!cliPackage.version) {
  throw new Error("package.json must define a version before preparing a GitHub package");
}

if (packageName !== packageName.toLowerCase()) {
  throw new Error(`GitHub Packages npm package name must be lowercase: ${packageName}`);
}

rmSync(outputDir, { force: true, recursive: true });
mkdirSync(join(outputDir, "bin"), { recursive: true });
mkdirSync(join(outputDir, "assets"), { recursive: true });

cpSync(
  join(packageDir, "assets", "opendock-logo-96.png"),
  join(outputDir, "assets", "opendock-logo-96.png"),
);
cpSync(join(packageDir, "bin", "opendock"), join(outputDir, "bin", "opendock"));
cpSync(join(packageDir, "docs"), join(outputDir, "docs"), { recursive: true });
cpSync(join(packageDir, "examples"), join(outputDir, "examples"), { recursive: true });
cpSync(join(repoRoot, "CHANGELOG.md"), join(outputDir, "CHANGELOG.md"));
cpSync(join(packageDir, "LICENSE"), join(outputDir, "LICENSE"));
cpSync(join(packageDir, "THIRD_PARTY_NOTICES.md"), join(outputDir, "THIRD_PARTY_NOTICES.md"));

for (const file of readdirSync(packageDir)) {
  if (file === "README.md" || /^README\.[a-z]{2}\.md$/.test(file)) {
    cpSync(join(packageDir, file), join(outputDir, file));
  }
}

const publishPackage = {
  name: packageName,
  version: cliPackage.version,
  description: cliPackage.description ?? "Simple AI setup for every workspace.",
  type: "module",
  license: cliPackage.license ?? "MIT",
  bin: {
    opendock: "bin/opendock",
  },
  files: [
    "bin",
    "assets/opendock-logo-96.png",
    "docs",
    "examples",
    "CHANGELOG.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "README.md",
    "README.*.md",
  ],
  engines: cliPackage.engines,
  packageManager: cliPackage.packageManager,
  repository: {
    type: "git",
    url: repositoryUrl,
  },
  publishConfig: {
    registry: "https://npm.pkg.github.com",
  },
};

writeFileSync(join(outputDir, "package.json"), `${JSON.stringify(publishPackage, null, 2)}\n`);

console.log(`Prepared ${packageName}@${cliPackage.version} in ${outputDir}`);
