import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { detectPlatform, type OpenDockPlatform } from "../../platform.js";
import type { DockManifest, LifecyclePhase, PackageRequirement } from "../domain/manifest.js";
import {
  CommandRunner,
  combinedOutput,
  extractVersion,
  failureMessage,
  satisfiesVersion,
} from "./command-runner.js";
import type { StepReport } from "./lifecycle-runner.js";

interface RequirementContext {
  live?: boolean;
  phase: LifecyclePhase;
  platform?: OpenDockPlatform;
  projectDir: string;
}

interface RuntimeDefinition {
  check: string;
  install?: Partial<Record<OpenDockPlatform, string>>;
}

interface PackageVersionResult {
  message?: string;
  version?: string;
}

const runtimeDefinitions: Record<string, RuntimeDefinition> = {
  bun: {
    check: "bun --version",
    install: {
      macos: "brew install bun",
      windows: "npm install --global bun",
    },
  },
  git: {
    check: "git --version",
    install: {
      macos: "brew install git",
      windows:
        "winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements",
    },
  },
  node: {
    check: "node --version",
    install: {
      macos: "brew install node",
      windows:
        "winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements",
    },
  },
  npm: {
    check: "npm --version",
  },
  pip: {
    check: "pip --version",
  },
  pip3: {
    check: "pip3 --version",
  },
  python: {
    check: "python --version",
    install: {
      macos: "brew install python",
      windows:
        "winget install --id Python.Python.3.12 --exact --accept-package-agreements --accept-source-agreements",
    },
  },
  python3: {
    check: "python3 --version",
    install: {
      macos: "brew install python",
      windows:
        "winget install --id Python.Python.3.12 --exact --accept-package-agreements --accept-source-agreements",
    },
  },
};

export class RequirementRunner {
  constructor(private readonly commandRunner = new CommandRunner()) {}

  run(manifest: DockManifest, context: RequirementContext): StepReport[] {
    const platform = context.platform ?? detectPlatform();
    const reports: StepReport[] = [];
    for (const [runtime, version] of Object.entries(manifest.requires.runtimes)) {
      reports.push(this.runRuntime(runtime, version, context, platform));
    }
    for (const [packageKey, requirement] of Object.entries(manifest.requires.packages)) {
      reports.push(this.runPackage(packageKey, requirement, context, platform));
    }
    return reports;
  }

  private runRuntime(
    runtime: string,
    version: string,
    context: RequirementContext,
    platform: OpenDockPlatform,
  ): StepReport {
    const definition = runtimeDefinitions[runtime];
    const id = `require-runtime-${runtime}`;
    if (!definition) {
      throw new Error(`unsupported required runtime \`${runtime}\``);
    }
    const check = this.evaluate(definition.check, version, context.projectDir, platform);
    if (context.phase === "doctor") {
      return check.passed
        ? { id, name: runtime, status: "Ready" }
        : failedReport(id, runtime, check.message);
    }
    if (check.passed) {
      console.log(`✓ ${id}: ready`);
      return { id, name: runtime, status: "Ready" };
    }

    const install = definition.install?.[platform];
    if (!install) {
      throw new Error(
        `required runtime \`${runtime}\` is missing or does not satisfy ${version}, and OpenDock has no ${platform} installer for it`,
      );
    }
    console.log(`→ ${id}: ${install}`);
    this.runInstaller(id, install, context, platform);
    const verify = this.evaluate(definition.check, version, context.projectDir, platform);
    if (!verify.passed) {
      throw new Error(
        `requirement \`${id}\` did not satisfy its check after install: ${verify.message}`,
      );
    }
    console.log(`✓ ${id}: ran`);
    return { id, name: runtime, status: "Ran" };
  }

  private runPackage(
    packageKey: string,
    requirement: PackageRequirement,
    context: RequirementContext,
    platform: OpenDockPlatform,
  ): StepReport {
    const id = `require-package-${packageKey}`;
    const check = this.evaluatePackage(requirement, context.projectDir, platform);
    if (context.phase === "doctor") {
      return check.passed
        ? { id, name: packageKey, status: "Ready" }
        : failedReport(id, packageKey, check.message);
    }
    if (context.phase === "install" && check.passed) {
      console.log(`✓ ${id}: ready`);
      return { id, name: packageKey, status: "Ready" };
    }

    const install = packageInstallCommand(requirement, context.phase);
    console.log(`→ ${id}: ${install}`);
    this.runInstaller(id, install, context, platform);
    const verify = this.evaluatePackage(requirement, context.projectDir, platform);
    if (!verify.passed) {
      throw new Error(
        `requirement \`${id}\` did not satisfy its check after install: ${verify.message}`,
      );
    }
    console.log(`✓ ${id}: ran`);
    return { id, name: packageKey, status: "Ran" };
  }

  private runInstaller(
    id: string,
    command: string,
    context: RequirementContext,
    platform: OpenDockPlatform,
  ): void {
    const result = this.commandRunner.run(command, {
      cwd: context.projectDir,
      live: context.live ?? true,
      platform,
    });
    if (!result.success) {
      const message = failureMessage(result);
      const suffix = message ? `: ${message}` : "";
      throw new Error(`requirement \`${id}\` installer exited with non-zero status${suffix}`);
    }
  }

  private evaluate(
    command: string,
    version: string,
    projectDir: string,
    platform: OpenDockPlatform,
  ): { passed: boolean; message: string } {
    const result = this.commandRunner.run(command, {
      cwd: projectDir,
      missingAsFailure: true,
      platform,
    });
    if (!result.success) {
      return { passed: false, message: failureMessage(result) ?? `${command} failed` };
    }
    const actual = extractVersion(combinedOutput(result));
    if (!actual) {
      return { passed: false, message: `could not read version from ${command}` };
    }
    if (!satisfiesVersion(actual, version)) {
      return { passed: false, message: `${actual} does not satisfy ${version}` };
    }
    return { passed: true, message: `${actual} satisfies ${version}` };
  }

  private evaluatePackage(
    requirement: PackageRequirement,
    projectDir: string,
    platform: OpenDockPlatform,
  ): { passed: boolean; message: string } {
    const result = this.installedPackageVersion(requirement, projectDir, platform);
    if (!result.version) {
      return {
        passed: false,
        message: result.message ?? `${requirement.name} is not installed`,
      };
    }
    const actual = extractVersion(result.version);
    if (!actual) {
      return {
        passed: false,
        message: `could not read package version for ${requirement.name}`,
      };
    }
    if (!satisfiesVersion(actual, requirement.version)) {
      return {
        passed: false,
        message: `${requirement.name} ${actual} does not satisfy ${requirement.version}`,
      };
    }
    return {
      passed: true,
      message: `${requirement.name} ${actual} satisfies ${requirement.version}`,
    };
  }

  private installedPackageVersion(
    requirement: PackageRequirement,
    projectDir: string,
    platform: OpenDockPlatform,
  ): PackageVersionResult {
    if (requirement.manager === "bun") {
      return readBunGlobalPackageVersion(requirement.name);
    }
    if (requirement.manager === "npm" || requirement.manager === "pnpm") {
      return this.readNodePackageManagerVersion(requirement, projectDir, platform);
    }
    if (requirement.manager === "pip" || requirement.manager === "pip3") {
      return this.readPipPackageVersion(requirement, projectDir, platform);
    }
    if (requirement.manager === "pipx") {
      return this.readPipxPackageVersion(requirement, projectDir, platform);
    }
    return this.readUvToolVersion(requirement, projectDir, platform);
  }

  private readNodePackageManagerVersion(
    requirement: PackageRequirement,
    projectDir: string,
    platform: OpenDockPlatform,
  ): PackageVersionResult {
    const result = this.commandRunner.run(
      `${requirement.manager} list --global --json --depth=0 ${requirement.name}`,
      {
        cwd: projectDir,
        missingAsFailure: true,
        platform,
      },
    );
    if (!result.success) {
      return { message: failureMessage(result) ?? `${requirement.name} is not installed` };
    }
    const json = parseJson(result.stdout);
    if (!json.ok) {
      return { message: `could not read package metadata for ${requirement.name}` };
    }
    const version = findPackageVersion(json.value, requirement.name);
    return version ? { version } : { message: `${requirement.name} is not installed` };
  }

  private readPipPackageVersion(
    requirement: PackageRequirement,
    projectDir: string,
    platform: OpenDockPlatform,
  ): PackageVersionResult {
    const result = this.commandRunner.run(`${requirement.manager} show ${requirement.name}`, {
      cwd: projectDir,
      missingAsFailure: true,
      platform,
    });
    if (!result.success) {
      return { message: failureMessage(result) ?? `${requirement.name} is not installed` };
    }
    const version = result.stdout.match(/^Version:\s*(.+)$/m)?.[1]?.trim();
    return version ? { version } : { message: `${requirement.name} is not installed` };
  }

  private readPipxPackageVersion(
    requirement: PackageRequirement,
    projectDir: string,
    platform: OpenDockPlatform,
  ): PackageVersionResult {
    const result = this.commandRunner.run("pipx list --json", {
      cwd: projectDir,
      missingAsFailure: true,
      platform,
    });
    if (!result.success) {
      return { message: failureMessage(result) ?? `${requirement.name} is not installed` };
    }
    const json = parseJson(result.stdout);
    if (!json.ok) {
      return { message: `could not read package metadata for ${requirement.name}` };
    }
    const version = findPackageVersion(json.value, requirement.name);
    return version ? { version } : { message: `${requirement.name} is not installed` };
  }

  private readUvToolVersion(
    requirement: PackageRequirement,
    projectDir: string,
    platform: OpenDockPlatform,
  ): PackageVersionResult {
    const result = this.commandRunner.run("uv tool list", {
      cwd: projectDir,
      missingAsFailure: true,
      platform,
    });
    if (!result.success) {
      return { message: failureMessage(result) ?? `${requirement.name} is not installed` };
    }
    const escapedName = requirement.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = result.stdout.match(
      new RegExp(`(?:^|\\n)${escapedName}\\s+v?(\\d+\\.\\d+\\.\\d+[^\\s]*)`),
    );
    return match?.[1] ? { version: match[1] } : { message: `${requirement.name} is not installed` };
  }
}

function readBunGlobalPackageVersion(name: string): PackageVersionResult {
  const packageJsonPath = join(bunGlobalNodeModulesDir(), ...name.split("/"), "package.json");
  if (!existsSync(packageJsonPath)) {
    return { message: `${name} is not installed` };
  }
  const json = parseJson(readFileSync(packageJsonPath, "utf8"));
  if (!json.ok) {
    return { message: `could not read package metadata for ${name}` };
  }
  const version =
    isRecord(json.value) && typeof json.value.version === "string" ? json.value.version : undefined;
  return version ? { version } : { message: `could not read package version for ${name}` };
}

function bunGlobalNodeModulesDir(): string {
  const bunInstall =
    process.env.BUN_INSTALL ??
    (process.env.HOME ? join(process.env.HOME, ".bun") : join(homedir(), ".bun"));
  return join(bunInstall, "install", "global", "node_modules");
}

function findPackageVersion(value: unknown, packageName: string): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const version = findPackageVersion(item, packageName);
      if (version) {
        return version;
      }
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.name === packageName && typeof value.version === "string") {
    return value.version;
  }
  const dependencies = value.dependencies;
  if (isRecord(dependencies)) {
    const direct = dependencies[packageName];
    if (isRecord(direct) && typeof direct.version === "string") {
      return direct.version;
    }
    for (const dependency of Object.values(dependencies)) {
      const version = findPackageVersion(dependency, packageName);
      if (version) {
        return version;
      }
    }
  }
  const metadata = value.metadata;
  if (isRecord(metadata)) {
    const version = findPackageVersion(metadata, packageName);
    if (version) {
      return version;
    }
  }
  const mainPackage = value.main_package;
  if (isRecord(mainPackage)) {
    if (
      (mainPackage.package === packageName || mainPackage.package_or_url === packageName) &&
      typeof mainPackage.package_version === "string"
    ) {
      return mainPackage.package_version;
    }
    const version = findPackageVersion(mainPackage, packageName);
    if (version) {
      return version;
    }
  }
  for (const key of ["version", "package_version"]) {
    if (value.package === packageName && typeof value[key] === "string") {
      return value[key];
    }
  }
  for (const child of Object.values(value)) {
    const version = findPackageVersion(child, packageName);
    if (version) {
      return version;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function packageInstallCommand(requirement: PackageRequirement, phase: LifecyclePhase): string {
  const name = versionedPackageName(requirement.name);
  if (requirement.manager === "bun") {
    return `bun install --global ${name}`;
  }
  if (requirement.manager === "npm") {
    return `npm install --global ${name}`;
  }
  if (requirement.manager === "pnpm") {
    return `pnpm add --global ${name}`;
  }
  if (requirement.manager === "pip" || requirement.manager === "pip3") {
    return `${requirement.manager} install --user --upgrade ${requirement.name}`;
  }
  if (requirement.manager === "pipx") {
    return `${requirement.manager} ${phase === "update" ? "upgrade" : "install"} ${requirement.name}`;
  }
  return `uv tool ${phase === "update" ? "upgrade" : "install"} ${requirement.name}`;
}

function versionedPackageName(name: string): string {
  return `${name}@latest`;
}

function failedReport(id: string, name: string, message: string): StepReport {
  return {
    id,
    name,
    status: "Failed",
    message,
  };
}
