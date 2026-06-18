import type { OpenDockPlatform } from "../../platform.js";
import type { SupportedRuntimeName } from "../domain/runtime-names.js";

export interface RuntimeDefinition {
  check: string;
  install?: Partial<Record<OpenDockPlatform, string>>;
}

export const runtimeDefinitions: Record<SupportedRuntimeName, RuntimeDefinition> = {
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
