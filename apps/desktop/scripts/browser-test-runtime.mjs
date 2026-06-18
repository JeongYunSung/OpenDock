import { existsSync } from "node:fs";

export async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForReachable(url, server) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (await isReachable(url)) return;
    if (server?.exitCode !== null) {
      throw new Error(`dev server exited before ${url} was reachable`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

export function resolveChromeExecutable() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export async function terminateServer(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    child.kill("SIGTERM");
    await new Promise((resolveStop) => setTimeout(resolveStop, 300));
    child.kill("SIGKILL");
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The process group may already be gone.
  }
  await new Promise((resolveStop) => setTimeout(resolveStop, 300));
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Already stopped.
  }
}
