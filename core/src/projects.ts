import { readFileSync, existsSync } from "node:fs";

export interface DirectLimits {
  max_budget_change_pct: number;
  max_bid_change_pct: number;
}

export interface DirectConfig {
  sandbox: boolean;
  client_login: string | null;
  limits: DirectLimits;
}

export interface Project {
  id: string;
  name?: string;
  token?: string;
  default_host?: string;
  default_counter?: number;
  webmaster_hosts?: string[];
  metrica_counter_ids?: number[];
  audience?: Record<string, unknown>;
  search?: Record<string, unknown>;
  direct: DirectConfig;
}

const DEFAULT_LIMITS: DirectLimits = { max_budget_change_pct: 30, max_bid_change_pct: 50 };
const DEFAULT_DIRECT: DirectConfig = { sandbox: false, client_login: null, limits: DEFAULT_LIMITS };

export function parseRegistry(raw: unknown, envToken?: string): Project[] {
  const projects: Project[] = [];
  const source = raw as { projects?: unknown; accounts?: unknown } | null;
  const entries = source?.projects ?? source?.accounts;
  if (Array.isArray(entries)) {
    for (const p of entries) {
      if (!p || typeof p.id !== "string" || !p.id.trim() || (p.token !== undefined && typeof p.token !== "string")) {
        throw new Error("Invalid project entry: each project needs a non-empty string 'id'");
      }
      projects.push({
        id: p.id,
        token: p.token,
        name: p.name,
        default_host: p.default_host ?? p.webmaster_hosts?.[0],
        default_counter: p.default_counter ?? (Number(p.metrica_counter_ids?.[0] ?? p.metricaCounterIds?.[0]) || undefined),
        webmaster_hosts: p.webmaster_hosts,
        metrica_counter_ids: p.metrica_counter_ids ?? p.metricaCounterIds,
        audience: p.audience,
        search: p.search,
        direct: {
          sandbox: p.direct?.sandbox ?? p.direct_sandbox ?? DEFAULT_DIRECT.sandbox,
          client_login: p.direct?.client_login ?? p.direct_client_login ?? p.directClientLogin ?? DEFAULT_DIRECT.client_login,
          limits: {
            max_budget_change_pct:
              p.direct?.limits?.max_budget_change_pct ?? DEFAULT_LIMITS.max_budget_change_pct,
            max_bid_change_pct:
              p.direct?.limits?.max_bid_change_pct ?? DEFAULT_LIMITS.max_bid_change_pct,
          },
        },
      });
    }
  }
  if (projects.length === 0 && envToken) {
    projects.push({ id: "default", token: process.env.YANDEX_OAUTH_FILE ? undefined : envToken,
      direct: { ...DEFAULT_DIRECT, limits: { ...DEFAULT_LIMITS } } });
  }
  if (projects.length === 0 && process.env.YANDEX_OAUTH_FILE) {
    projects.push({ id: "default", direct: { ...DEFAULT_DIRECT, limits: { ...DEFAULT_LIMITS } } });
  }
  if (projects.length === 0) {
    throw new Error("No projects configured. Provide YANDEX_PROJECTS_CONFIG file or YANDEX_OAUTH_TOKEN.");
  }
  const ids = new Set<string>();
  for (const p of projects) {
    if (ids.has(p.id)) throw new Error(`Duplicate project id: ${p.id}`);
    ids.add(p.id);
  }
  return projects;
}

export function loadProjectsFromEnv(): Project[] {
  const configPath = process.env.YANDEX_PROJECTS_CONFIG ?? "./projects.json";
  const envToken = process.env.YANDEX_OAUTH_TOKEN;
  let raw: unknown = null;
  if (existsSync(configPath)) {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  }
  return parseRegistry(raw, envToken);
}

export class ProjectRegistry {
  private projects: Map<string, Project>;
  private order: string[];
  private activeId: string;

  constructor(projects: Project[]) {
    if (projects.length === 0) throw new Error("ProjectRegistry requires at least one project");
    this.projects = new Map(projects.map((p) => [p.id, p]));
    this.order = projects.map((p) => p.id);
    this.activeId = projects[0].id;
  }

  list(): { id: string; name?: string; sandbox: boolean; direct_client_login: string | null; metrica_counter_ids?: number[]; webmaster_hosts?: string[] }[] {
    // `order` and `projects` are built from the same array in the constructor and never mutated, so get() is always defined.
    return this.order.map((id) => {
      const p = this.projects.get(id)!;
      return { id, name: p.name, sandbox: p.direct.sandbox, direct_client_login: p.direct.client_login,
        metrica_counter_ids: p.metrica_counter_ids, webmaster_hosts: p.webmaster_hosts };
    });
  }

  get active(): string {
    return this.activeId;
  }

  setActive(id: string): void {
    if (!this.projects.has(id)) throw new Error(`Unknown project: ${id}`);
    this.activeId = id;
  }

  resolve(id?: string): Project {
    const target = id ?? this.activeId;
    const p = this.projects.get(target);
    if (!p) throw new Error(`Unknown project: ${target}`);
    return p;
  }
}
