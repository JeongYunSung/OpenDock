const blockedShellTokens = ["|", "&&", "||", ";", "`", "$(", ">", "<"];

export function includesShellOperator(value: string): boolean {
  return blockedShellTokens.some((token) => value.includes(token));
}
