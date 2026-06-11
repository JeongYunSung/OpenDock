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
    for (const [binary, requirement] of Object.entries(manifest.requires.packages)) {
      reports.push(this.runPackage(binary, requirement, context, platform));
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
    binary: string,
    requirement: PackageRequirement,
    context: RequirementContext,
    platform: OpenDockPlatform,
  ): StepReport {
    const id = `require-package-${binary}`;
    const checkCommand = `${requirement.binary ?? binary} --version`;
    const check = this.evaluate(checkCommand, requirement.version, context.projectDir, platform);
    if (context.phase === "doctor") {
      return check.passed
        ? { id, name: binary, status: "Ready" }
        : failedReport(id, binary, check.message);
    }
    if (context.phase === "install" && check.passed) {
      console.log(`✓ ${id}: ready`);
      return { id, name: binary, status: "Ready" };
    }

    const install = packageInstallCommand(requirement, context.phase);
    console.log(`→ ${id}: ${install}`);
    this.runInstaller(id, install, context, platform);
    const verify = this.evaluate(checkCommand, requirement.version, context.projectDir, platform);
    if (!verify.passed) {
      throw new Error(
        `requirement \`${id}\` did not satisfy its check after install: ${verify.message}`,
      );
    }
    console.log(`✓ ${id}: ran`);
    return { id, name: binary, status: "Ran" };
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
