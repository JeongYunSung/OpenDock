import type { TokenStore } from "./auth.js";
import { performBrowserLogin } from "./browser-auth.js";
import {
  type OpenDockRegistryClient,
  RegistryRequestError,
  type SubmissionRequest,
  type SubmissionResponse,
} from "./registry.js";

export async function submitDockWithLogin(
  client: OpenDockRegistryClient,
  tokenStore: TokenStore,
  request: SubmissionRequest,
): Promise<SubmissionResponse> {
  let token = await loadOrLoginToken(client, tokenStore);
  try {
    return await client.submitDock(request, token);
  } catch (error) {
    if (!(error instanceof RegistryRequestError && error.status === 401)) {
      throw error;
    }
    tokenStore.clearToken();
    token = (await performBrowserLogin({ client, tokenStore })).token;
    return client.submitDock(request, token);
  }
}

async function loadOrLoginToken(
  client: OpenDockRegistryClient,
  tokenStore: TokenStore,
): Promise<string> {
  const token = tokenStore.loadToken();
  if (token) {
    return token;
  }
  return (await performBrowserLogin({ client, tokenStore })).token;
}
