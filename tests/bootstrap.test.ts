import { describe, expect, it } from "vitest";
import { bootstrapWindows } from "../src/bootstrap.js";

describe("host bootstrap", () => {
  it("rejects Windows bootstrap on non-Windows hosts", async () => {
    await expect(
      bootstrapWindows({
        platform: "darwin",
        write: () => {},
      }),
    ).rejects.toThrow("only supported on Windows");
  });

  it("reports ready when winget is already available", async () => {
    let opened = false;
    const messages: string[] = [];

    const report = await bootstrapWindows({
      commandAvailable: (command) => command === "winget",
      openInstaller: () => {
        opened = true;
        return 0;
      },
      platform: "win32",
      write: (message) => messages.push(message),
    });

    expect(report.status).toBe("ready");
    expect(opened).toBe(false);
    expect(messages).toEqual(["WinGet is already installed and available on PATH."]);
  });

  it("skips Microsoft App Installer when winget is missing and confirmation is declined", async () => {
    let opened = false;
    const messages: string[] = [];

    const report = await bootstrapWindows({
      commandAvailable: () => false,
      confirm: async () => false,
      openInstaller: () => {
        opened = true;
        return 0;
      },
      platform: "win32",
      write: (message) => messages.push(message),
    });

    expect(report.status).toBe("skipped");
    expect(opened).toBe(false);
    expect(messages).toContain("Skipped Microsoft App Installer.");
  });

  it("opens Microsoft App Installer when winget is missing and --yes is used", async () => {
    let opened = false;

    const report = await bootstrapWindows({
      assumeYes: true,
      commandAvailable: () => false,
      openInstaller: () => {
        opened = true;
        return 0;
      },
      platform: "win32",
      write: () => {},
    });

    expect(report.status).toBe("opened");
    expect(opened).toBe(true);
  });
});
