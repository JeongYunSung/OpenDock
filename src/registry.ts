import { API_PREFIX, DEFAULT_REGISTRY_URL } from "./constants.js";
import type { OpenDockPlatform, OpenDockReleasePlatform } from "./platform.js";

const requestTimeoutMs = 30_000;
const maxDockArchiveBytes = 50 * 1024 * 1024;

export interface DockVersionResponse {
  id: string;
  version: string;
  platform?: OpenDockReleasePlatform;
  approved: boolean;
  checksum: string;
  signature: string;
}

export interface CliLoginStartResponse {
  authUrl: string;
  expiresAt: string;
}

export interface CliTokenResponse {
  token: string;
  expiresAt: string;
  user: AuthUserResponse;
}

export interface AuthUserResponse {
  id: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  hostedDomain?: string | null;
}

export interface SubmissionRequest {
  dock_name: string;
  version: string;
  platform: OpenDockReleasePlatform;
  manifest: string;
  archive: SubmissionArchiveRequest;
  readme_markdown?: string;
  logo?: SubmissionLogoRequest;
}

interface SubmissionArchiveRequest {
  filename: string;
  content_type: "application/gzip";
  data_base64: string;
  checksum: string;
}

export interface SubmissionLogoRequest {
  filename: string;
  content_type: "image/png" | "image/jpeg" | "image/webp";
  data_base64: string;
}

export interface SubmissionResponse {
  id: string;
  status: string;
  logo?: SubmissionLogoMetadataResponse | null;
}

interface SubmissionLogoMetadataResponse {
  filename: string;
  storageBackend: string;
  path: string;
  contentType: string;
  sizeBytes: number;
}

export class OpenDockRegistryClient {
  constructor(private readonly registryUrl = DEFAULT_REGISTRY_URL) {}

  async resolveDockVersion(
    owner: string,
    name: string,
    selector: string,
    platform: OpenDockPlatform,
  ): Promise<DockVersionResponse> {
    const url = `${this.apiBase()}/docks/${owner}/${name}/versions/${encodeURIComponent(selector)}?${new URLSearchParams({ platform })}`;
    return this.requestJson<DockVersionResponse>(url);
  }

  async downloadDock(
    owner: string,
    name: string,
    version: string,
    platform: OpenDockPlatform,
  ): Promise<Buffer> {
    const url = `${this.apiBase()}/docks/${owner}/${name}/versions/${encodeURIComponent(version)}/download?${new URLSearchParams({ platform })}`;
    return this.requestBytes(url, maxDockArchiveBytes);
  }

  private async requestBytes(url: string, maxBytes: number): Promise<Buffer> {
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`failed to request ${url}: ${response.status} ${response.statusText}`);
    }
    const expectedLength = parseContentLength(response.headers.get("content-length"));
    if (expectedLength !== undefined && expectedLength > maxBytes) {
      throw new Error(`downloaded dock archive exceeds ${maxBytes} bytes`);
    }
    return readResponseBytes(response, maxBytes);
  }

  async startCliLogin(redirectUri: string): Promise<CliLoginStartResponse> {
    const url = `${this.apiBase()}/auth/cli/start`;
    return this.requestJson<CliLoginStartResponse>(url, {
      method: "POST",
      body: JSON.stringify({ redirectUri }),
      headers: { "content-type": "application/json" },
    });
  }

  async exchangeCliCode(code: string): Promise<CliTokenResponse> {
    const url = `${this.apiBase()}/auth/cli/exchange`;
    return this.requestJson<CliTokenResponse>(url, {
      method: "POST",
      body: JSON.stringify({ code }),
      headers: { "content-type": "application/json" },
    });
  }

  async currentUser(token: string): Promise<AuthUserResponse> {
    const url = `${this.apiBase()}/auth/me`;
    return this.requestJson<AuthUserResponse>(url, {
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async logout(token: string): Promise<void> {
    const url = `${this.apiBase()}/auth/logout`;
    await this.requestJson<void>(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async submitDock(request: SubmissionRequest, token: string): Promise<SubmissionResponse> {
    const url = `${this.apiBase()}/docks/submissions`;
    return this.requestJson<SubmissionResponse>(url, {
      method: "POST",
      body: JSON.stringify(request),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
  }

  private apiBase(): string {
    return `${this.registryUrl}${API_PREFIX}`;
  }

  private async requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchWithTimeout(url, init);
    if (!response.ok) {
      throw await RegistryRequestError.fromResponse(url, response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }

  private async fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    timeout.unref?.();
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error(`request timed out after ${requestTimeoutMs}ms: ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class RegistryRequestError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly statusText: string,
    message: string,
  ) {
    super(message);
    this.name = "RegistryRequestError";
  }

  static async fromResponse(url: string, response: Response): Promise<RegistryRequestError> {
    const body = await response.text();
    let message = body.trim();
    if (body.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(body) as { message?: unknown };
        if (typeof parsed.message === "string" && parsed.message.trim() !== "") {
          message = parsed.message;
        }
      } catch {
        message = body.trim();
      }
    }
    if (message === "") {
      message = `${response.status} ${response.statusText}`;
    }
    return new RegistryRequestError(
      url,
      response.status,
      response.statusText,
      `failed to request ${url}: ${message}`,
    );
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`downloaded dock archive exceeds ${maxBytes} bytes`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(`downloaded dock archive exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}
