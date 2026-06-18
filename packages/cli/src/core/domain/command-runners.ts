export const commandRunnerNames = ["bun", "node", "powershell", "python", "python3", "sh"] as const;

export type CommandRunnerName = (typeof commandRunnerNames)[number];

const commandRunnerNameSet = new Set<string>(commandRunnerNames);

export const commandRunnerExtensions: Record<CommandRunnerName, string[]> = {
  bun: [".cjs", ".js", ".mjs", ".ts"],
  node: [".cjs", ".js", ".mjs"],
  powershell: [".ps1"],
  python: [".py"],
  python3: [".py"],
  sh: [".sh"],
};

export function isCommandRunnerName(value: string): value is CommandRunnerName {
  return commandRunnerNameSet.has(value);
}
