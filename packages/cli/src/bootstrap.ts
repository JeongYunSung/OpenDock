import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface } from "node:readline/promises";
import { opendockCommandPath } from "./core/runtime/command-runner.js";

const HOMEBREW_INSTALL_URL = "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh";
const HOMEBREW_INSTALL_COMMAND = `/bin/bash -c "$(curl -fsSL ${HOMEBREW_INSTALL_URL})"`;
const APP_INSTALLER_STORE_URL = "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1";
const APP_INSTALLER_WEB_URL = "https://apps.microsoft.com/detail/9nblggh4nns1";

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

export interface BootstrapWindowsOptions {
  assumeYes?: boolean;
  commandAvailable?: (command: string) => boolean;
  confirm?: (message: string) => Promise<boolean>;
  openInstaller?: () => number;
  platform?: NodeJS.Platform;
  write?: (message: string) => void;
}

type BootstrapWindowsStatus = "ready" | "opened" | "skipped";

export interface BootstrapWindowsReport {
  status: BootstrapWindowsStatus;
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

export async function bootstrapWindows(
  options: BootstrapWindowsOptions = {},
): Promise<BootstrapWindowsReport> {
  const platform = options.platform ?? process.platform;
  const write = options.write ?? console.log;
  const commandAvailable = options.commandAvailable ?? defaultCommandAvailable;

  if (platform !== "win32") {
    throw new Error("`opendock bootstrap windows` is only supported on Windows");
  }

  if (commandAvailable("winget")) {
    write("WinGet is already installed and available on PATH.");
    return { status: "ready" };
  }

  write("WinGet is required for docks that install Windows developer tools.");
  write("WinGet is provided by Microsoft App Installer on supported Windows versions.");
  write("Install or update Microsoft App Installer, then re-run OpenDock.");
  write(`Microsoft Store: ${APP_INSTALLER_STORE_URL}`);
  write(`Web page: ${APP_INSTALLER_WEB_URL}`);

  const approved =
    options.assumeYes === true
      ? true
      : await (options.confirm ?? defaultConfirm)("Open Microsoft App Installer now? [y/N] ");
  if (!approved) {
    write("Skipped Microsoft App Installer.");
    return { status: "skipped" };
  }

  const exitCode = (options.openInstaller ?? defaultOpenWindowsInstaller)();
  if (exitCode !== 0) {
    throw new Error(`Microsoft App Installer opener exited with status ${exitCode}`);
  }

  write("Microsoft App Installer page opened. Install or update it, then re-run OpenDock.");
  return { status: "opened" };
}

function defaultCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    env: { ...process.env, PATH: opendockCommandPath() },
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

function defaultOpenWindowsInstaller(): number {
  const result = spawnSync("cmd", ["/c", "start", "", APP_INSTALLER_STORE_URL], {
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
