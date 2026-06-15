import { detectPlatform, type OpenDockPlatform } from "../../platform.js";
import { formatStepSymbol, terminalStyle } from "../../terminal-style.js";
import type { DockManifest, TaskPhase } from "../domain/manifest.js";
import {
  CommandRunner,
  combinedOutput,
  extractVersion,
  failureMessage,
  satisfiesVersion,
} from "./command-runner.js";
import { type ProgressReporter, reportProgress } from "./progress.js";
import type { StepReport } from "./task-runner.js";

interface RequirementContext {
  dockId?: string;
  live?: boolean;
  phase: TaskPhase;
  platform?: OpenDockPlatform;
  progress?: ProgressReporter;
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
    const runtimes = Object.entries(manifest.requires.runtimes);
    for (const [index, [runtime, version]] of runtimes.entries()) {
      reports.push(
        this.runRuntime(runtime, version, context, platform, index + 1, runtimes.length),
      );
    }
    return reports;
  }

  private runRuntime(
    runtime: string,
    version: string,
    context: RequirementContext,
    platform: OpenDockPlatform,
    current: number,
    total: number,
  ): StepReport {
    const definition = runtimeDefinitions[runtime];
    const id = `require-runtime-${runtime}`;
    if (!definition) {
      throw new Error(`unsupported required runtime \`${runtime}\``);
    }
    this.progress(context, {
      current,
      id,
      message: `Checking ${runtime} ${version}`,
      phase: "requirement-check",
      total,
    });
    const check = this.evaluate(definition.check, version, context.projectDir, platform);
    if (context.phase === "doctor") {
      return check.passed
        ? { id, name: runtime, status: "Ready" }
        : failedReport(id, runtime, check.message);
    }
    if (check.passed) {
      console.log(`${formatStepSymbol("✓")} ${terminalStyle.bold(id)}: ready`);
      this.progress(context, {
        current,
        id,
        level: "OK",
        message: `${runtime} is ready`,
        phase: "requirement-ready",
        total,
      });
      return { id, name: runtime, status: "Ready" };
    }

    const install = definition.install?.[platform];
    if (!install) {
      throw new Error(
        `required runtime \`${runtime}\` is missing or does not satisfy ${version}, and OpenDock has no ${platform} installer for it`,
      );
    }
    console.log(
      `${formatStepSymbol("->")} ${terminalStyle.bold(id)}: ${terminalStyle.dim(install)}`,
    );
    this.progress(context, {
      current,
      id,
      message: `Installing ${runtime}`,
      phase: "requirement-install",
      total,
    });
    this.runInstaller(id, install, context, platform);
    const verify = this.evaluate(definition.check, version, context.projectDir, platform);
    if (!verify.passed) {
      this.progress(context, {
        current,
        id,
        level: "ERR",
        message: `${runtime} requirement failed`,
        phase: "requirement-failed",
        total,
      });
      throw new Error(
        `requirement \`${id}\` did not satisfy its check after install: ${verify.message}`,
      );
    }
    console.log(`${formatStepSymbol("✓")} ${terminalStyle.bold(id)}: ran`);
    this.progress(context, {
      current,
      id,
      level: "OK",
      message: `${runtime} installed`,
      phase: "requirement-ran",
      total,
    });
    return { id, name: runtime, status: "Ran" };
  }

  private progress(
    context: RequirementContext,
    event: {
      current: number;
      id: string;
      level?: "ERR" | "OK" | "RUN";
      message: string;
      phase: string;
      total: number;
    },
  ): void {
    reportProgress(context.progress, {
      current: event.current,
      level: event.level ?? "RUN",
      message: event.message,
      percent: stepProgressPercent(event.current, event.total, event.level === "OK" ? 0.9 : 0.2),
      phase: event.phase,
      stepId: event.id,
      total: event.total,
      ...(context.dockId === undefined ? {} : { dockId: context.dockId }),
    });
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

function failedReport(id: string, name: string, message: string): StepReport {
  return {
    id,
    name,
    status: "Failed",
    message,
  };
}

function stepProgressPercent(current: number, total: number, offset: number): number {
  const slotCount = Math.max(total, 1);
  const slotSize = 100 / slotCount;
  return Math.min(98, Math.round(slotSize * (current - 1 + offset)));
}
