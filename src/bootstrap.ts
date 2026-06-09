import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface } from "node:readline/promises";

const HOMEBREW_INSTALL_URL = "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh";
const HOMEBREW_INSTALL_COMMAND = `/bin/bash -c "$(curl -fsSL ${HOMEBREW_INSTALL_URL})"`;

const homebrewInstallProgram = "/bin/bash";
const homebrewInstallArgs = ["-c", `$(curl -fsSL ${HOMEBREW_INSTALL_URL})`];
const commonBrewPaths = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

export interface BootstrapMacOptions {
  assumeYes?: boolean;
  commandAvailable?: (command: string) => boolean;
  confirm?: (message: string) => Promise<boolean>;
  pathExists?: (path: string) => boolean;
  platform?: NodeJS.Platform;
  runInstall?: () => number;
  write?: (message: string) => void;
}

type BootstrapMacStatus = "ready" | "installed" | "path-missing" | "skipped";

export interface BootstrapMacReport {
  status: BootstrapMacStatus;
  brewPath?: string;
}

export async function bootstrapMac(options: BootstrapMacOptions = {}): Promise<BootstrapMacReport> {
  const platform = options.platform ?? process.platform;
  const write = options.write ?? console.log;
  const commandAvailable = options.commandAvailable ?? defaultCommandAvailable;
  const pathExists = options.pathExists ?? existsSync;

  if (platform !== "darwin") {
    throw new Error("`opendock bootstrap mac` is only supported on macOS");
  }

  if (commandAvailable("brew")) {
    write("Homebrew is already installed and available on PATH.");
    return { status: "ready" };
  }

  const brewPath = commonBrewPaths.find((path) => pathExists(path));
  if (brewPath) {
    write(`Homebrew is installed at ${brewPath}, but brew is not available on PATH.`);
    write("Add Homebrew to your shell PATH, then re-run OpenDock.");
    write('Apple Silicon: eval "$(/opt/homebrew/bin/brew shellenv)"');
    write('Intel Mac: eval "$(/usr/local/bin/brew shellenv)"');
    return { status: "path-missing", brewPath };
  }

  write("Homebrew is required for docks that install macOS developer tools.");
  write(`Official Homebrew installer: ${HOMEBREW_INSTALL_COMMAND}`);

  const approved =
    options.assumeYes === true
      ? true
      : await (options.confirm ?? defaultConfirm)("Install Homebrew now? [y/N] ");
  if (!approved) {
    write("Skipped Homebrew installation.");
    return { status: "skipped" };
  }

  const exitCode = (options.runInstall ?? defaultRunInstall)();
  if (exitCode !== 0) {
    throw new Error(`Homebrew installer exited with status ${exitCode}`);
  }

  write("Homebrew installation finished.");
  return { status: "installed" };
}

function defaultCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0;
}

function defaultRunInstall(): number {
  const result = spawnSync(homebrewInstallProgram, homebrewInstallArgs, {
    env: process.env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

async function defaultConfirm(message: string): Promise<boolean> {
  if (!defaultInput.isTTY || !defaultOutput.isTTY) {
    return false;
  }

  const readline = createInterface({ input: defaultInput, output: defaultOutput });
  try {
    const answer = (await readline.question(message)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    readline.close();
  }
}
