import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface, emitKeypressEvents } from "node:readline";
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

interface KeypressInput extends NodeJS.ReadableStream {
  isRaw?: boolean;
  isTTY?: boolean;
  setRawMode?: (this: KeypressInput, mode: boolean) => unknown;
}

interface AuthProviderSelectOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

interface KeypressEvent {
  ctrl?: boolean;
  name?: string;
}

const authProviderChoices: Array<{ label: string; provider: AuthProvider }> = [
  { label: "Google", provider: "google" },
  { label: "GitHub", provider: "github" },
];

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
    const authUrl = safeBrowserUrl(login.authUrl);
    write("Opening browser for OpenDock login.");
    write(`Open this URL if the browser does not open: ${authUrl}`);
    write("Waiting for login... press Enter to check again.");
    try {
      await openBrowser(authUrl);
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

export async function selectAuthProvider(
  options: AuthProviderSelectOptions = {},
): Promise<AuthProvider> {
  const input = (options.input ?? defaultInput) as KeypressInput;
  const output = options.output ?? defaultOutput;
  const writable = output as NodeJS.WritableStream & { isTTY?: boolean };
  const setRawMode = input.setRawMode?.bind(input);
  if (input.isTTY !== true || writable.isTTY !== true || setRawMode === undefined) {
    return "google";
  }

  return new Promise<AuthProvider>((resolve, reject) => {
    let selectedIndex = 0;
    let renderedLines = 0;
    const previousRawMode = input.isRaw;

    const cleanup = () => {
      input.off("keypress", onKeypress);
      setRawMode(previousRawMode === true);
      input.pause();
    };

    const finish = (provider: AuthProvider) => {
      cleanup();
      output.write("\n");
      resolve(provider);
    };

    const cancel = () => {
      cleanup();
      output.write("\n");
      reject(new Error("login cancelled"));
    };

    const render = () => {
      renderedLines = renderAuthProviderPrompt(output, selectedIndex, renderedLines);
    };

    function onKeypress(_value: string, key: KeypressEvent = {}) {
      if (key.ctrl === true && key.name === "c") {
        cancel();
        return;
      }
      if (key.name === "up") {
        selectedIndex =
          (selectedIndex + authProviderChoices.length - 1) % authProviderChoices.length;
        render();
        return;
      }
      if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % authProviderChoices.length;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        finish(authProviderChoices[selectedIndex]?.provider ?? "google");
      }
    }

    emitKeypressEvents(input);
    setRawMode(true);
    input.resume();
    input.on("keypress", onKeypress);
    render();
  });
}

function renderAuthProviderPrompt(
  output: NodeJS.WritableStream,
  selectedIndex: number,
  previousLineCount: number,
): number {
  if (previousLineCount > 0) {
    output.write(`\x1b[${previousLineCount}A\x1b[0J`);
  }
  const lines = [
    "OpenDock Login",
    "",
    "Choose a login method:",
    "",
    ...authProviderChoices.map(
      (choice, index) => `${index === selectedIndex ? "❯" : " "} ${choice.label}`,
    ),
    "",
    "↑/↓ to move, Enter to continue",
  ];
  output.write(`${lines.join("\n")}\n`);
  return lines.length;
}

async function openSystemBrowser(url: string): Promise<void> {
  const authUrl = safeBrowserUrl(url);
  const { command, args } = browserOpenCommand(authUrl);

  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  await once(child, "spawn");
  child.unref();
}

export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "win32") {
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
    };
  }
  return {
    command: platform === "darwin" ? "/usr/bin/open" : "xdg-open",
    args: [url],
  };
}

async function startCallbackServer(timeoutMs = loginTimeoutMs): Promise<{
  server: Server;
  redirectUri: string;
  waitForCode: Promise<string>;
  cleanup: () => void;
}> {
  const state = randomBytes(24).toString("base64url");
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
    if (url.searchParams.get("state") !== state) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Invalid state");
      settle?.reject(new Error("OpenDock login returned an invalid state"));
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
    redirectUri: `http://${callbackHost}:${address.port}/callback?state=${state}`,
    waitForCode,
    cleanup: () => clearTimeout(timeout),
  };
}

function safeBrowserUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Registry returned an invalid browser login URL");
  }
  if (url.protocol === "https:") {
    return url.toString();
  }
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return url.toString();
  }
  if (url.protocol === "http:") {
    throw new Error("Registry returned an insecure browser login URL");
  }
  throw new Error(`Registry returned an unsupported browser login URL scheme: ${url.protocol}`);
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
