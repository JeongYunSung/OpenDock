import { API_PREFIX, DEFAULT_REGISTRY_URL } from "./constants.js";

const requestTimeoutMs = 30_000;
const maxDockArchiveBytes = 50 * 1024 * 1024;

export interface DockVersionResponse {
  id: string;
  version: string;
  approved: boolean;
  checksum: string;
  signature: string;
}

export interface LoginResponse {
  token: string;
}

export interface SubmissionRequest {
  dock_name: string;
  manifest: string;
}

export interface SubmissionResponse {
  id: string;
  status: string;
}

export class OpenDockRegistryClient {
  async resolveDockVersion(
    owner: string,
    name: string,
    selector: string,
  ): Promise<DockVersionResponse> {
    const url = `${this.apiBase()}/docks/${owner}/${name}/versions/${encodeURIComponent(selector)}`;
    return this.requestJson<DockVersionResponse>(url);
  }

  async downloadDock(owner: string, name: string, version: string): Promise<Buffer> {
    const url = `${this.apiBase()}/docks/${owner}/${name}/versions/${encodeURIComponent(version)}/download`;
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

  async loginWithToken(token: string): Promise<LoginResponse> {
    const url = `${this.apiBase()}/auth/login`;
    return this.requestJson<LoginResponse>(url, {
      method: "POST",
      body: JSON.stringify({ token }),
      headers: { "content-type": "application/json" },
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
    return `${DEFAULT_REGISTRY_URL}${API_PREFIX}`;
  }

  private async requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchWithTimeout(url, init);
    if (!response.ok) {
      throw new Error(`failed to request ${url}: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
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
