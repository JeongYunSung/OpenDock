const supportedRuntimeNames = [
  "bun",
  "git",
  "node",
  "npm",
  "pip",
  "pip3",
  "python",
  "python3",
] as const;

export type SupportedRuntimeName = (typeof supportedRuntimeNames)[number];

const supportedRuntimeNameSet = new Set<string>(supportedRuntimeNames);

export function isSupportedRuntimeName(value: string): value is SupportedRuntimeName {
  return supportedRuntimeNameSet.has(value);
}
