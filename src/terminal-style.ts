interface TerminalStream {
  isTTY?: boolean;
}

type StyleName = "bold" | "cyan" | "dim" | "green" | "red" | "yellow";

const styles: Record<StyleName, readonly [open: string, close: string]> = {
  bold: ["\x1b[1m", "\x1b[22m"],
  cyan: ["\x1b[36m", "\x1b[39m"],
  dim: ["\x1b[2m", "\x1b[22m"],
  green: ["\x1b[32m", "\x1b[39m"],
  red: ["\x1b[31m", "\x1b[39m"],
  yellow: ["\x1b[33m", "\x1b[39m"],
};

export function supportsTerminalColor(stream: TerminalStream = process.stdout): boolean {
  return stream.isTTY === true && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
}

export function paint(style: StyleName, value: string, stream?: TerminalStream): string {
  if (!supportsTerminalColor(stream)) {
    return value;
  }
  const [open, close] = styles[style];
  return `${open}${value}${close}`;
}

export const terminalStyle = {
  bold: (value: string) => paint("bold", value),
  created: (value: string) => paint("green", value),
  deleted: (value: string) => paint("red", value),
  dim: (value: string) => paint("dim", value),
  error: (value: string) => paint("red", value),
  info: (value: string) => paint("cyan", value),
  review: (value: string) => paint("yellow", value),
  stderrError: (value: string) => paint("red", value, process.stderr),
  success: (value: string) => paint("green", value),
  updated: (value: string) => paint("cyan", value),
  warning: (value: string) => paint("yellow", value),
};

export function formatDockVersion(id: string, version: string): string {
  return `${terminalStyle.bold(id)}${terminalStyle.dim(`@${version}`)}`;
}

export function formatListPlatform(platform: string): string {
  return terminalStyle.dim(`[${platform}]`);
}

export function formatPlatformName(platform: string): string {
  return terminalStyle.dim(platform);
}

export function formatStatus(status: string): string {
  switch (status.toLowerCase()) {
    case "ready":
    case "success":
    case "ran":
    case "installed":
      return terminalStyle.success(status);
    case "failure":
    case "failed":
    case "error":
      return terminalStyle.error(status);
    case "skipped":
    case "not installed":
      return terminalStyle.warning(status);
    default:
      return terminalStyle.dim(status);
  }
}

export function formatStepSymbol(symbol: "!" | "+" | "-" | "->" | "✓" | "~"): string {
  switch (symbol) {
    case "✓":
    case "+":
      return terminalStyle.success(symbol);
    case "~":
    case "->":
      return terminalStyle.info(symbol);
    case "-":
      return terminalStyle.deleted(symbol);
    case "!":
      return terminalStyle.warning(symbol);
  }
}
