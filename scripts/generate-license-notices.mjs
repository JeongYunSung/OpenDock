import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRoot = createRequire(join(repoRoot, "package.json"));
const cliRoot = join(repoRoot, "packages", "cli");
const desktopRoot = join(repoRoot, "apps", "desktop");
const licensePath = join(repoRoot, "LICENSE");
const cliRuntimeRoots = ["commander", "tar", "yaml", "zod"];
const desktopWebRuntimeRoots = ["@tauri-apps/api", "lucide-react", "react", "react-dom"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function packageJsonFor(packageName, baseDir) {
  const entry = requireFromRoot.resolve(packageName, { paths: [baseDir] });
  let dir = dirname(entry);
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "package.json");
    try {
      const pkg = readJson(candidate);
      if (pkg.name === packageName) {
        return { path: candidate, pkg };
      }
    } catch {
      // Keep walking upward.
    }
    dir = dirname(dir);
  }
  throw new Error(`Could not locate package.json for ${packageName}`);
}

function collectJsRuntimeDependencies(roots, baseDir) {
  const seen = new Map();
  const queue = roots.map((name) => ({ name, baseDir }));

  while (queue.length > 0) {
    const item = queue.shift();
    const name = item?.name;
    if (!name || seen.has(name)) continue;

    const { path, pkg } = packageJsonFor(name, item.baseDir);
    seen.set(name, {
      name: pkg.name,
      version: pkg.version ?? "",
      license: normalizeLicense(pkg.license ?? pkg.licenses),
      repository: repositoryUrl(pkg.repository),
      homepage: pkg.homepage ?? "",
      source: relative(repoRoot, path),
    });

    const dependencies = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    };
    for (const dependency of Object.keys(dependencies).sort()) {
      queue.push({ name: dependency, baseDir: dirname(path) });
    }
  }

  return sortPackages([...seen.values()]);
}

function collectRustRuntimeDependencies() {
  const metadata = spawnSync(
    "cargo",
    ["metadata", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", "--format-version", "1", "--quiet"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    },
  );

  if (metadata.status !== 0) {
    throw new Error(metadata.stderr || "cargo metadata failed");
  }

  const parsed = JSON.parse(metadata.stdout);
  const packagesById = new Map(parsed.packages.map((pkg) => [pkg.id, pkg]));
  const nodesById = new Map(parsed.resolve.nodes.map((node) => [node.id, node]));
  const rootId = parsed.resolve.root;
  const seen = new Set();
  const queue = [rootId];

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const node = nodesById.get(id);
    if (!node) continue;
    for (const dep of node.deps ?? []) {
      const isRuntimeDependency = dep.dep_kinds?.some((kind) => kind.kind === null);
      if (isRuntimeDependency) {
        queue.push(dep.pkg);
      }
    }
  }

  seen.delete(rootId);

  return sortPackages(
    [...seen].map((id) => {
      const pkg = packagesById.get(id);
      return {
        name: pkg.name,
        version: pkg.version,
        license: normalizeLicense(pkg.license ?? pkg.license_file),
        repository: pkg.repository ?? pkg.homepage ?? "",
        homepage: pkg.homepage ?? "",
        source: "crates.io",
      };
    }),
  );
}

function normalizeLicense(value) {
  if (!value) return "UNKNOWN";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function repositoryUrl(repository) {
  if (!repository) return "";
  if (typeof repository === "string") return repository;
  if (typeof repository.url === "string") return repository.url;
  return "";
}

function sortPackages(packages) {
  return packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

function markdownTable(packages) {
  if (packages.length === 0) return "_No runtime dependencies._\n";
  const lines = ["| Package | License | Source |", "| --- | --- | --- |"];
  for (const pkg of packages) {
    const label = `${pkg.name}@${pkg.version}`;
    const source = pkg.repository || pkg.homepage || pkg.source || "";
    lines.push(`| ${escapeCell(label)} | ${escapeCell(pkg.license)} | ${escapeCell(source)} |`);
  }
  return `${lines.join("\n")}\n`;
}

function escapeCell(value) {
  return String(value || "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function noticeDocument({ title, components, sections }) {
  return `# ${title}

OpenDock is licensed under the MIT License. See \`LICENSE\` for the OpenDock
license text.

This file lists third-party runtime components distributed with OpenDock
packages and desktop bundles. Build-only and test-only tools are intentionally
excluded unless they are bundled into a distributed artifact.

## OpenDock

| Component | License |
| --- | --- |
${components.map((component) => `| ${component} | MIT |`).join("\n")}

${sections
  .map(
    (section) => `## ${section.title}

${markdownTable(section.packages)}`,
  )
  .join("\n")}
`;
}

const cliPackages = collectJsRuntimeDependencies(cliRuntimeRoots, cliRoot);
const desktopWebPackages = collectJsRuntimeDependencies(desktopWebRuntimeRoots, desktopRoot);
const desktopRustPackages = collectRustRuntimeDependencies();

const cliNotice = noticeDocument({
  title: "OpenDock CLI Third-Party Notices",
  components: ["OpenDock CLI"],
  sections: [{ title: "CLI JavaScript Runtime Dependencies", packages: cliPackages }],
});

const desktopNotice = noticeDocument({
  title: "OpenDock Desktop Third-Party Notices",
  components: ["OpenDock Desktop", "Bundled OpenDock CLI"],
  sections: [
    { title: "Bundled CLI JavaScript Runtime Dependencies", packages: cliPackages },
    { title: "Desktop Web Runtime Dependencies", packages: desktopWebPackages },
    { title: "Desktop Rust Runtime Dependencies", packages: desktopRustPackages },
  ],
});

const rootNotice = noticeDocument({
  title: "OpenDock Third-Party Notices",
  components: ["OpenDock CLI", "OpenDock Desktop"],
  sections: [
    { title: "CLI JavaScript Runtime Dependencies", packages: cliPackages },
    { title: "Desktop Web Runtime Dependencies", packages: desktopWebPackages },
    { title: "Desktop Rust Runtime Dependencies", packages: desktopRustPackages },
  ],
});

mkdirSync(cliRoot, { recursive: true });
mkdirSync(desktopRoot, { recursive: true });

writeFileSync(join(repoRoot, "THIRD_PARTY_NOTICES.md"), rootNotice);
writeFileSync(join(cliRoot, "THIRD_PARTY_NOTICES.md"), cliNotice);
writeFileSync(join(desktopRoot, "THIRD_PARTY_NOTICES.md"), desktopNotice);
copyFileSync(licensePath, join(cliRoot, "LICENSE"));
copyFileSync(licensePath, join(desktopRoot, "LICENSE"));

console.log("Generated OpenDock license notices.");
