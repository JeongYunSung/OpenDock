import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface } from "node:readline";
import { TokenStore } from "./auth.js";
import { type AuthProvider, type CliTokenResponse, OpenDockRegistryClient } from "./registry.js";

const loginTimeoutMs = 5 * 60 * 1000;
const callbackHost = "127.0.0.1";

export interface BrowserLoginOptions {
  client?: BrowserLoginClient;
  tokenStore?: TokenStore;
  openBrowser?: (url: string) => Promise<void>;
  timeoutMs?: number;
  write?: (message: string) => void;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  provider?: AuthProvider;
}

interface BrowserLoginClient {
  startCliLogin(
    redirectUri: string,
    provider?: AuthProvider,
  ): Promise<{ authUrl: string; expiresAt: string }>;
  exchangeCliCode(code: string): Promise<CliTokenResponse>;
}

export async function performBrowserLogin(
  options: BrowserLoginOptions = {},
): Promise<CliTokenResponse> {
  const client = options.client ?? new OpenDockRegistryClient();
  const tokenStore = options.tokenStore ?? new TokenStore();
  const write = options.write ?? ((message: string) => console.log(message));
  const openBrowser = options.openBrowser ?? openSystemBrowser;
  const provider = options.provider ?? "google";
  const { server, redirectUri, waitForCode, cleanup } = await startCallbackServer(
    options.timeoutMs,
  );
  const readline = maybeCreateReadline(
    options.input ?? defaultInput,
    options.output ?? defaultOutput,
    write,
  );

  try {
    const login = await client.startCliLogin(redirectUri, provider);
    write("Opening browser for OpenDock login.");
    write(`Open this URL if the browser does not open: ${login.authUrl}`);
    write("Waiting for login... press Enter to check again.");
    try {
      await openBrowser(login.authUrl);
    } catch {
      write("Browser did not open automatically. Continue with the URL above.");
    }
    const code = await waitForCode;
    const token = await client.exchangeCliCode(code);
    await tokenStore.saveToken(token.token);
    write(`Logged in as ${token.user.email}.`);
    return token;
  } finally {
    cleanup();
    readline?.close();
    await closeServer(server);
  }
}

async function openSystemBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args =
    process.platform === "darwin"
      ? [url]
      : process.platform === "win32"
        ? ["/c", "start", "", url]
        : [url];

  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  await once(child, "spawn");
  child.unref();
}

async function startCallbackServer(timeoutMs = loginTimeoutMs): Promise<{
  server: Server;
  redirectUri: string;
  waitForCode: Promise<string>;
  cleanup: () => void;
}> {
  let settle:
    | {
        resolve: (code: string) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  const waitForCode = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const timeout = setTimeout(() => {
    settle?.reject(new Error("timed out waiting for browser login"));
  }, timeoutMs);
  timeout.unref?.();

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? callbackHost}`);
    if (url.pathname !== "/callback") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (error) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(callbackHtml("OpenDock login failed. Return to the terminal."));
      settle?.reject(new Error(`OpenDock login failed: ${error}`));
      return;
    }
    if (!code) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Missing code");
      settle?.reject(new Error("OpenDock login did not return a code"));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(callbackHtml("OpenDock login complete. Return to the terminal."));
    settle?.resolve(code);
  });

  server.listen(0, callbackHost);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to start login callback server");
  }
  waitForCode.finally(() => clearTimeout(timeout)).catch(() => undefined);
  return {
    server,
    redirectUri: `http://${callbackHost}:${address.port}/callback`,
    waitForCode,
    cleanup: () => clearTimeout(timeout),
  };
}

function maybeCreateReadline(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  write: (message: string) => void,
): ReturnType<typeof createInterface> | undefined {
  const readable = input as NodeJS.ReadableStream & { isTTY?: boolean };
  const writable = output as NodeJS.WritableStream & { isTTY?: boolean };
  if (!readable.isTTY || !writable.isTTY) {
    return undefined;
  }
  const readline = createInterface({ input, output });
  readline.on("line", () => {
    write("Still waiting for browser login...");
  });
  return readline;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function callbackHtml(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>OpenDock Login</title><body><p>${message}</p></body>`;
}
