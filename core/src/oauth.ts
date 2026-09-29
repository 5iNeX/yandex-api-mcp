import { readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";

type OAuthState = {
  access_token?: string; refresh_token?: string; client_id?: string; client_secret?: string;
  issued_at?: number; expires_in?: number; scope?: string;
};

let refreshPromise: Promise<string> | null = null;

function readState(): OAuthState {
  const file = process.env.YANDEX_OAUTH_FILE;
  if (!file) return {
    access_token: process.env.YANDEX_OAUTH_TOKEN,
    refresh_token: process.env.YANDEX_REFRESH_TOKEN,
    client_id: process.env.YANDEX_CLIENT_ID,
    client_secret: process.env.YANDEX_CLIENT_SECRET
  };
  const state = JSON.parse(readFileSync(file, "utf8")) as OAuthState;
  if (process.env.YANDEX_OAUTH_APP_FILE) {
    const app = JSON.parse(readFileSync(process.env.YANDEX_OAUTH_APP_FILE, "utf8")) as OAuthState;
    state.client_id ||= app.client_id;
    state.client_secret ||= app.client_secret;
  }
  return state;
}

function saveState(state: OAuthState): void {
  const file = process.env.YANDEX_OAUTH_FILE;
  if (!file) return;
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}

export async function accessToken(forceRefresh = false): Promise<string> {
  const state = readState();
  const expiry = state.issued_at && state.expires_in ? state.issued_at + state.expires_in : 0;
  const expired = expiry > 0 && expiry < Date.now() / 1000 + 120;
  if (!forceRefresh && state.access_token && !expired) return state.access_token;
  if (!state.refresh_token || !state.client_id || !state.client_secret) {
    if (state.access_token && !forceRefresh && !expired) return state.access_token;
    throw new Error("OAuth refresh unavailable: configure refresh_token, client_id and client_secret");
  }
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const response = await fetch("https://oauth.yandex.ru/token", {
      method: "POST", signal: AbortSignal.timeout(30000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: state.refresh_token!,
        client_id: state.client_id!, client_secret: state.client_secret! })
    });
    if (!response.ok) throw new Error(`OAuth refresh failed (HTTP ${response.status}); verify application credentials and refresh token`);
    const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!token.access_token) throw new Error("OAuth refresh returned no access token");
    const updated: OAuthState = { ...state, access_token: token.access_token,
      refresh_token: token.refresh_token || state.refresh_token,
      issued_at: Math.floor(Date.now() / 1000), expires_in: token.expires_in,
      scope: token.scope || state.scope };
    if (process.env.YANDEX_OAUTH_APP_FILE) delete updated.client_secret;
    saveState(updated);
    process.env.YANDEX_OAUTH_TOKEN = token.access_token;
    return token.access_token;
  })();
  try { return await refreshPromise; } finally { refreshPromise = null; }
}
