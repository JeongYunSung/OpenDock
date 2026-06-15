import { afterEach, describe, expect, it } from "vitest";
import { paint, supportsTerminalColor } from "../src/terminal-style.js";

const previousNoColor = process.env.NO_COLOR;
const previousTerm = process.env.TERM;

afterEach(() => {
  restoreEnv("NO_COLOR", previousNoColor);
  restoreEnv("TERM", previousTerm);
});

describe("terminal color output", () => {
  it("colors only when the output stream supports TTY color", () => {
    delete process.env.NO_COLOR;
    delete process.env.TERM;

    expect(supportsTerminalColor({ isTTY: true })).toBe(true);
    expect(paint("green", "ready", { isTTY: true })).toBe("\x1b[32mready\x1b[39m");
  });

  it("does not color non-TTY output", () => {
    delete process.env.NO_COLOR;
    delete process.env.TERM;

    expect(supportsTerminalColor({ isTTY: false })).toBe(false);
    expect(paint("green", "ready", { isTTY: false })).toBe("ready");
  });

  it("respects NO_COLOR and dumb terminals", () => {
    process.env.NO_COLOR = "1";
    expect(supportsTerminalColor({ isTTY: true })).toBe(false);
    expect(paint("red", "error", { isTTY: true })).toBe("error");

    delete process.env.NO_COLOR;
    process.env.TERM = "dumb";
    expect(supportsTerminalColor({ isTTY: true })).toBe(false);
    expect(paint("red", "error", { isTTY: true })).toBe("error");
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
