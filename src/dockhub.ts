import { API_PREFIX, DEFAULT_REGISTRY_URL } from "./constants.js";

export interface PackVersionResponse {
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
  pack_name: string;
  manifest: string;
}

export interface SubmissionResponse {
  id: string;
  status: string;
}

export class DockHubClient {
  async latestPackVersion(owner: string, name: string): Promise<PackVersionResponse> {
    const url = `${this.apiBase()}/packs/${owner}/${name}/versions/latest`;
    return this.requestJson<PackVersionResponse>(url);
  }

  async downloadPack(owner: string, name: string, version: string): Promise<Buffer> {
    const url = `${this.apiBase()}/packs/${owner}/${name}/versions/${version}/download`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`failed to request ${url}: ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async loginWithToken(token: string): Promise<LoginResponse> {
    const url = `${this.apiBase()}/auth/login`;
    return this.requestJson<LoginResponse>(url, {
      method: "POST",
      body: JSON.stringify({ token }),
      headers: { "content-type": "application/json" },
    });
  }

  async submitPack(request: SubmissionRequest, token: string): Promise<SubmissionResponse> {
    const url = `${this.apiBase()}/packs/submissions`;
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
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`failed to request ${url}: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }
}
