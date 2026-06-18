const blockedShellTokens = ["|", "&&", "||", ";", "`", "$(", ">", "<"];
const commandSeparatorTokens = ["&&", "||", "|", ";"];

export function includesShellOperator(value: string): boolean {
  return blockedShellTokens.some((token) => value.includes(token));
}

export function isShellCommandSeparator(value: string): boolean {
  return commandSeparatorTokens.includes(value);
}
