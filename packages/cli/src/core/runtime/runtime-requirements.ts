import type { SupportedRuntimeName } from "../domain/runtime-names.js";

export interface RuntimeDefinition {
  check: string;
}

export const runtimeDefinitions: Record<SupportedRuntimeName, RuntimeDefinition> = {
  bun: {
    check: "bun --version",
  },
  git: {
    check: "git --version",
  },
  node: {
    check: "node --version",
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
  },
  python3: {
    check: "python3 --version",
  },
};
