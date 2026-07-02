import { describe, expect, it } from "vitest";
import type { DockManifest, TaskPhase } from "../src/core/domain/manifest.js";
import { ensureAllowed, splitCommand } from "../src/core/runtime/command-policy.js";
import { validateManifestTaskCommands } from "../src/core/runtime/task-command-validation.js";
import type { OpenDockPlatform } from "../src/platform.js";

type CommandField = "check" | "run";

const shellOperatorCommands = [
  ["pipe", "git status | touch owned"],
  ["and", "git status && touch owned"],
  ["or", "git status || touch owned"],
  ["semicolon", "git status; touch owned"],
  ["backtick", "git status `touch owned`"],
  ["substitution", "git status $(touch owned)"],
  ["redirect-out", "git status > owned"],
  ["redirect-in", "git status < owned"],
] as const;

const shellPermissionCommands = shellOperatorCommands.map(
  ([name, command]) => [name, command.replace("git status", "oma -y install")] as const,
);

describe("command policy attack cases", () => {
  it.each(
    shellOperatorCommands,
  )("rejects shell operator %s in install run commands", (_name, command) => {
    expect(() =>
      validateManifestTaskCommands(manifestWithCommand("install", "run", command), "macos"),
    ).toThrow(/invalid install step `attack` run: shell operators are not allowed/);
  });

  it.each(
    shellOperatorCommands,
  )("rejects shell operator %s in doctor check commands", (_name, command) => {
    expect(() =>
      validateManifestTaskCommands(manifestWithCommand("doctor", "check", command), "macos"),
    ).toThrow(/invalid doctor step `attack` check: shell operators are not allowed/);
  });

  it.each(
    shellPermissionCommands,
  )("rejects shell operator %s inside permission commands", (_name, permission) => {
    expect(() =>
      validateManifestTaskCommands(
        manifestWithCommand("install", "run", "oma -y install", {
          permission: [permission],
          tools: omaTool(),
        }),
        "macos",
      ),
    ).toThrow(/invalid permission `.*`: shell operators are not allowed/);
  });

  it("rejects newline, unicode whitespace, and quote based command-shape bypass attempts", () => {
    const bypasses = [
      "git status\n touch owned",
      "git status\r\n touch owned",
      "git status\u00A0--porcelain",
      "git status\u2028touch owned",
      "git\u200Bstatus",
      'git "status --short"',
      "git 'status --short'",
      'git "status',
    ];

    for (const command of bypasses) {
      expect(
        () => validateManifestTaskCommands(manifestWithCommand("install", "run", command), "macos"),
        command,
      ).toThrow(/not allowed|invalid command/);
    }
  });

  it("rejects shell trampoline programs and environment-prefix execution", () => {
    const macosTrampolines = [
      "sh -c 'touch owned'",
      "bash -c 'touch owned'",
      "zsh -c 'touch owned'",
      "/bin/sh -c 'touch owned'",
      "env FOO=bar git status",
    ];

    for (const command of macosTrampolines) {
      expect(
        () => validateManifestTaskCommands(manifestWithCommand("install", "run", command), "macos"),
        command,
      ).toThrow(/not allowed/);
    }

    for (const command of [
      'powershell -Command "Write-Output owned"',
      'powershell -NoProfile -NonInteractive -Command "Write-Output owned"',
    ]) {
      expect(
        () =>
          validateManifestTaskCommands(manifestWithCommand("doctor", "check", command), "windows"),
        command,
      ).toThrow(/not allowed/);
    }
  });

  it("allows only the narrow safe PowerShell Test-Path shape on Windows", () => {
    expect(() =>
      validateManifestTaskCommands(
        manifestWithCommand(
          "doctor",
          "check",
          'powershell -NoProfile -NonInteractive -Command "if (Test-Path -LiteralPath AGENTS.md) { exit 0 } else { exit 1 }"',
        ),
        "windows",
      ),
    ).not.toThrow();

    expect(() =>
      validateManifestTaskCommands(
        manifestWithCommand(
          "doctor",
          "check",
          'powershell -NoProfile -NonInteractive -Command "if (Test-Path -LiteralPath ../secret) { exit 0 } else { exit 1 }"',
        ),
        "windows",
      ),
    ).toThrow(/not allowed/);
  });

  it("blocks package and system installs or updates in task commands even with exact permissions", () => {
    const blocked: Array<[string, OpenDockPlatform]> = [
      ["npm install left-pad", "macos"],
      ["npm update left-pad", "macos"],
      ["npm add left-pad", "macos"],
      ["bun install", "macos"],
      ["bun add oh-my-agent", "macos"],
      ["bun update oh-my-agent", "macos"],
      ["pnpm add left-pad", "macos"],
      ["pnpm update left-pad", "macos"],
      ["pnpm upgrade left-pad", "macos"],
      ["pip install requests", "macos"],
      ["pip3 install requests", "macos"],
      ["pipx install black", "macos"],
      ["pipx upgrade black", "macos"],
      ["uv tool install ruff", "macos"],
      ["uv tool upgrade ruff", "macos"],
      ["brew install node", "macos"],
      ["brew upgrade node", "macos"],
      ["winget install Git.Git", "windows"],
      ["winget upgrade Git.Git", "windows"],
    ];

    for (const [command, platform] of blocked) {
      expect(
        () =>
          validateManifestTaskCommands(
            manifestWithCommand("install", "run", command, { permission: [command] }),
            platform,
          ),
        command,
      ).toThrow(/package installs|system package installs|not declared/);
    }
  });

  it("rejects package executor shortcuts in task commands", () => {
    for (const command of ["npx cowsay hello", "bunx create-vite app"]) {
      expect(
        () => validateManifestTaskCommands(manifestWithCommand("install", "run", command), "macos"),
        command,
      ).toThrow(/not allowed/);
    }
  });

  it("enforces exact permission shape for declared custom tool commands", () => {
    const allowed = manifestWithCommand("install", "run", "oma -y install", {
      permission: ["oma -y install"],
      tools: omaTool(),
    });
    expect(() => validateManifestTaskCommands(allowed, "macos")).not.toThrow();

    const variants = ["oma install -y", "oma -y install --all", "oma -y update"];
    for (const command of variants) {
      expect(
        () =>
          validateManifestTaskCommands(
            manifestWithCommand("install", "run", command, {
              permission: ["oma -y install"],
              tools: omaTool(),
            }),
            "macos",
          ),
        command,
      ).toThrow(/not allowed/);
    }
  });

  it("does not let exact permissions widen OpenDock default commands into script runners", () => {
    for (const [command, platform] of [
      ['node -e "console.log(1)"', "macos"],
      ['python -c "print(1)"', "macos"],
      ['python3 -c "print(1)"', "macos"],
      ["git config --global user.email test@example.com", "macos"],
      ['powershell -Command "Write-Output owned"', "windows"],
    ] as Array<[string, OpenDockPlatform]>) {
      const [program, ...args] = splitCommand(command);
      if (program === undefined) {
        throw new Error(`failed to parse command: ${command}`);
      }
      expect(() => ensureAllowed(program, args, platform, [command]), command).toThrow(
        /not allowed/,
      );
    }
  });
});

function manifestWithCommand(
  phase: TaskPhase,
  field: CommandField,
  command: string,
  options: Partial<Pick<DockManifest, "permission" | "tools">> = {},
): DockManifest {
  const tasks: DockManifest["tasks"] = { install: [], update: [], doctor: [] };
  tasks[phase] = [{ id: "attack", platforms: {}, [field]: command }];
  return {
    opendock: 1,
    id: "test/attack",
    summary: "",
    tags: [],
    requires: { runtimes: {} },
    files: [],
    tasks,
    permission: options.permission ?? [],
    ...(options.tools === undefined ? {} : { tools: options.tools }),
  };
}

function omaTool(): NonNullable<DockManifest["tools"]> {
  return {
    oma: {
      manager: "bun",
      package: "oh-my-agent",
      version: "8.52.9",
      commands: ["oma"],
    },
  };
}
