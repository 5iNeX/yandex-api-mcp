const WEBMASTER_BASE_URL = "https://api.webmaster.yandex.net";
const METRIKA_BASE_URL = "https://api-metrika.yandex.net";
const DIRECT_BASE_URL = "https://api.direct.yandex.com/json/v5";
const DIRECT_SANDBOX_BASE_URL = "https://api-sandbox.direct.yandex.com/json/v5";

export type AuthScheme = "OAuth" | "Bearer";

export function buildAuthHeader(scheme: AuthScheme, token: string): string {
  return `${scheme} ${token}`;
}

export function directBaseUrl(sandbox: boolean): string {
  return sandbox ? DIRECT_SANDBOX_BASE_URL : DIRECT_BASE_URL;
}

export function buildDirectPayload(method: string, params: unknown): string {
  return JSON.stringify({ method, params });
}

import { Project, ProjectRegistry, loadProjectsFromEnv } from "./projects.js";
import { accessToken } from "./oauth.js";
import { assertWriteAllowed } from "./policy.js";

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

interface YandexErrorResponse {
  error_code?: string;
  error_message?: string;
  message?: string;
}

interface DirectApiError {
  request_id?: string;
  error_code?: number;
  error_string?: string;
  error_detail?: string;
}

interface RequestOptions {
  params?: Record<string, string | number | undefined>;
  body?: unknown;
  baseUrl?: string;
  authScheme?: AuthScheme;
  extraHeaders?: Record<string, string>;
  service?: "webmaster";
  retryable?: boolean;
}

interface WebmasterRequestOptions extends RequestOptions {
  hostId?: string;
  apiVersion?: string;
}

class YandexClient {
  private project: Project;
  private userId: string | null = null;
  public lastUnits: string | null = null;

  constructor(project: Project) {
    this.project = project;
  }

  private async token(forceRefresh = false, service?: "webmaster"): Promise<string> {
    if (service === "webmaster" && process.env.YANDEX_WEBMASTER_TOKEN_DISTINCT === "true" && process.env.YANDEX_WEBMASTER_TOKEN) {
      return process.env.YANDEX_WEBMASTER_TOKEN;
    }
    if (this.project.token) return this.project.token;
    return accessToken(forceRefresh);
  }

  async getUserId(): Promise<string> {
    if (this.userId) return this.userId;
    const data = await this.request<{ user_id: number }>("GET", "/v4/user", { service: "webmaster" });
    this.userId = String(data.user_id);
    return this.userId;
  }

  async request<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
    const url = new URL(path, options?.baseUrl ?? WEBMASTER_BASE_URL);

    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: buildAuthHeader(options?.authScheme ?? "OAuth", await this.token(false, options?.service)),
      Accept: "application/json",
      ...(options?.extraHeaders ?? {}),
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (options?.body !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(options.body);
    }

    let lastError: Error | null = null;
    const mayRetry = method.toUpperCase() === "GET" || options?.retryable === true;

    let refreshed = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      let response: Response;
      try {
        response = await fetch(url.toString(), { ...fetchOptions, signal: AbortSignal.timeout(30000) });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (mayRetry && attempt < MAX_RETRIES) continue;
        throw lastError;
      }

      const units = response.headers.get("Units");
      if (units) this.lastUnits = units;

      if (response.status === 401 && !refreshed && !this.project.token && !(options?.service === "webmaster" && process.env.YANDEX_WEBMASTER_TOKEN_DISTINCT === "true")) {
        headers.Authorization = buildAuthHeader(options?.authScheme ?? "OAuth", await this.token(true, options?.service));
        refreshed = true;
        attempt -= 1;
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        const requestId = response.headers.get("RequestId") || response.headers.get("X-Request-Id");
        lastError = new Error(`HTTP ${response.status} on ${method} ${path}${requestId ? ` (RequestId ${requestId})` : ""}; retry after backoff`);
        if (mayRetry && attempt < MAX_RETRIES) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          if (Number.isFinite(retryAfter) && retryAfter > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter * 1000, 60000)));
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const requestId = response.headers.get("RequestId") || response.headers.get("X-Request-Id");
        let detail = "Request failed";
        try {
          const errorBody = (await response.json()) as YandexErrorResponse;
          if (errorBody.error_code || errorBody.error_message) {
            detail = `${errorBody.error_code ?? "UNKNOWN"}: ${errorBody.error_message ?? errorBody.message ?? "No message"}`;
          } else if (errorBody.message) {
            detail = errorBody.message;
          }
        } catch {
          // Response body was not JSON, use default error message
        }
        throw new Error(`HTTP ${response.status} on ${method} ${path}${requestId ? ` (RequestId ${requestId})` : ""}: ${detail}`);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      const data = (await response.json()) as T;
      return data;
    }

    throw lastError ?? new Error(`Request failed after ${MAX_RETRIES} retries`);
  }

  async webmasterRequest<T>(
    method: string,
    path: string,
    options?: WebmasterRequestOptions
  ): Promise<T> {
    if (method.toUpperCase() !== "GET" && !(method.toUpperCase() === "POST" && path.endsWith("/query-analytics/list"))) {
      assertWriteAllowed(`Webmaster ${method} ${path}`);
    }
    const userId = await this.getUserId();
    const version = options?.apiVersion ?? "v4";
    let fullPath = `/${version}/user/${userId}${path}`;

    if (options?.hostId) {
      fullPath = fullPath.replace("{host_id}", options.hostId);
    }

    return this.request<T>(method, fullPath, {
      params: options?.params,
      body: options?.body,
      service: "webmaster",
    });
  }

  async metrikaRequest<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
    if (method.toUpperCase() !== "GET" && !(method.toUpperCase() === "POST" && path.endsWith("/logrequests/evaluate"))) {
      assertWriteAllowed(`Metrika ${method} ${path}`);
    }
    return this.request<T>(method, path, { ...options, baseUrl: METRIKA_BASE_URL });
  }

  // Metrika uploads (offline conversions, expenses) are multipart/form-data,
  // unlike every other JSON call — hence a dedicated fetch path.
  async metrikaUpload<T>(
    path: string,
    params: Record<string, string | number | undefined>,
    fileContent: string,
    fileName = "data.csv"
  ): Promise<T> {
    assertWriteAllowed(`Metrika upload ${path}`);
    const url = new URL(path, METRIKA_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const form = new FormData();
    form.append("file", new Blob([fileContent], { type: "text/csv" }), fileName);
    let response = await fetch(url.toString(), {
      method: "POST",
      headers: { Authorization: buildAuthHeader("OAuth", await this.token()) },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (response.status === 401 && !this.project.token) {
      response = await fetch(url.toString(), {
        method: "POST", headers: { Authorization: buildAuthHeader("OAuth", await this.token(true)) },
        body: form, signal: AbortSignal.timeout(60000)
      });
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} on POST ${path}; verify Metrika scope, counter access and CSV format`);
    }
    return (await response.json()) as T;
  }

  // Logs API part download returns raw TSV, not JSON.
  async metrikaDownload(path: string): Promise<string> {
    const url = new URL(path, METRIKA_BASE_URL);
    let response = await fetch(url.toString(), {
      headers: { Authorization: buildAuthHeader("OAuth", await this.token()) }, signal: AbortSignal.timeout(60000)
    });
    if (response.status === 401 && !this.project.token) {
      response = await fetch(url.toString(), {
        headers: { Authorization: buildAuthHeader("OAuth", await this.token(true)) }, signal: AbortSignal.timeout(60000)
      });
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} on GET ${path}; verify Metrika scope and counter access`);
    }
    return response.text();
  }

  async directRequest<T>(service: string, method: string, params: unknown): Promise<T> {
    if (!["get", "check", "checkDirty", "hasSearchVolume", "deduplicate"].includes(method)) {
      assertWriteAllowed(`Direct ${service}.${method}`);
    }
    const url = `${directBaseUrl(this.project.direct.sandbox)}/${service}`;
    const extraHeaders: Record<string, string> = { "Accept-Language": "ru" };
    if (this.project.direct.client_login) extraHeaders["Client-Login"] = this.project.direct.client_login;
    const data = await this.request<T>("POST", url, {
      body: { method, params },
      authScheme: "Bearer",
      extraHeaders,
      retryable: ["get", "check", "checkDirty", "hasSearchVolume", "deduplicate"].includes(method),
    });
    // Direct reports request-level errors in the body ({"error": {...}}),
    // possibly with a successful HTTP status — response.ok alone is not enough.
    const err = (data as { error?: DirectApiError } | null)?.error;
    if (err) {
      throw new Error(
        `Direct API error ${err.error_code}: ${err.error_string ?? ""}` +
          (err.error_detail ? ` — ${err.error_detail}` : "") +
          (err.request_id ? ` (RequestId ${err.request_id})` : "")
      );
    }
    return data;
  }

  async directReport(body: unknown): Promise<{ status: number; text: string; retryIn: number | null }> {
    const url = `${directBaseUrl(this.project.direct.sandbox)}/reports`;
    const headers: Record<string, string> = {
      Authorization: buildAuthHeader("Bearer", await this.token()),
      "Accept-Language": "ru",
      "Content-Type": "application/json",
      processingMode: "auto",
      returnMoneyInMicros: "false",
      skipReportHeader: "true",
      skipReportSummary: "true",
    };
    if (this.project.direct.client_login) headers["Client-Login"] = this.project.direct.client_login;
    let res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (res.status === 401 && !this.project.token) {
      headers.Authorization = buildAuthHeader("Bearer", await this.token(true));
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    }
    const units = res.headers.get("Units");
    if (units) this.lastUnits = units;
    const retryHeader = res.headers.get("retryIn");
    return { status: res.status, text: await res.text(), retryIn: retryHeader ? Number(retryHeader) : null };
  }
}

let registry: ProjectRegistry | null = null;
const clientCache = new Map<string, YandexClient>();

export function initRegistry(): void {
  registry = new ProjectRegistry(loadProjectsFromEnv());
  clientCache.clear();
}

export function getRegistry(): ProjectRegistry {
  if (!registry) throw new Error("Registry not initialized.");
  return registry;
}

export function getProject(projectId?: string): Project {
  return getRegistry().resolve(projectId);
}

export function getClient(projectId?: string): YandexClient {
  const project = getProject(projectId);
  let c = clientCache.get(project.id);
  if (!c) {
    c = new YandexClient(project);
    clientCache.set(project.id, c);
  }
  return c;
}
