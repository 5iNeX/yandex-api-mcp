import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient, getProject } from "../client.js";
import { checkLimits, MoneyDelta, summarizeResults, weekendWarning } from "./safety.js";

const moneyDeltaSchema = z.object({
  field: z.string(),
  kind: z.enum(["budget", "bid"]),
  current: z.number(),
  proposed: z.number(),
});

function asText(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

interface DirectWriteConfig {
  name: string;
  service: string;
  description: string;
  methods: [string, ...string[]];
}

function registerDirectWrite(server: McpServer, cfg: DirectWriteConfig): void {
  server.tool(
    cfg.name,
    `${cfg.description} Mutating: previews a request unless confirm:true; enforces project limits. Response includes a per-item summary — check partial_failure, failed items must not be retried as-is.`,
    {
      project: z.string().optional().describe("Project id (defaults to the active project)"),
      method: z.enum(cfg.methods).describe(`Operation: one of ${cfg.methods.join(", ")}`),
      params: z.record(z.string(), z.any()).describe("Params object for the Direct method"),
      money_deltas: z
        .array(moneyDeltaSchema)
        .optional()
        .describe("Budget/bid changes for limit checks: [{field,kind,current,proposed}]"),
      confirm: z.boolean().optional().describe("Must be true to actually execute (default false = preview only)"),
      force: z.boolean().optional().describe("Override limit violations (default false)"),
    },
    async ({ project, method, params, money_deltas, confirm, force }) => {
      const proj = getProject(project);
      const client = getClient(project);
      const deltas: MoneyDelta[] = money_deltas ?? [];
      const violations = checkLimits(deltas, proj.direct.limits);
      const hasBudgetDelta = deltas.some((d) => d.kind === "budget");
      const weekend = hasBudgetDelta ? weekendWarning(new Date()) : null;

      if (!confirm) {
        return asText({
          preview: true,
          sandbox: proj.direct.sandbox,
          request: { service: cfg.service, method, params },
          money_deltas: deltas,
          violations,
          ...(weekend ? { weekend_warning: weekend } : {}),
          note: "Not executed. Re-run with confirm:true to apply.",
        });
      }
      if (violations.length && !force) {
        return asText({
          blocked: true,
          violations,
          note: "Change exceeds configured limits. Pass force:true to override.",
        });
      }
      if (weekend && !force) {
        return asText({
          blocked: true,
          weekend_warning: weekend,
          note: "Budget change blocked by the weekend rule (playbook M3). Pass force:true to override.",
        });
      }
      const data = await client.directRequest(cfg.service, method, params);
      // HTTP success does not mean all items succeeded: failed items carry
      // per-item Errors in Results[]. A failed operation must not be retried.
      const summary = summarizeResults(data);
      return asText({
        executed: true,
        partial_failure: (summary?.failed ?? 0) > 0,
        summary,
        sandbox: proj.direct.sandbox,
        units: client.lastUnits,
        result: data,
      });
    }
  );
}

export function registerDirectWriteTools(server: McpServer): void {
  registerDirectWrite(server, {
    name: "yandex_direct_campaigns_manage",
    service: "campaigns",
    description: "Manage campaigns (incl. bidding strategy / auto-strategies and budget).",
    methods: ["add", "update", "suspend", "resume", "archive", "unarchive", "delete"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_adgroups_manage",
    service: "adgroups",
    description: "Manage ad groups.",
    methods: ["add", "update", "delete"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_ads_manage",
    service: "ads",
    description: "Manage ads (incl. moderation, suspend/resume).",
    methods: ["add", "update", "moderate", "suspend", "resume", "archive", "unarchive", "delete"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_keywords_manage",
    service: "keywords",
    description: "Manage keywords.",
    methods: ["add", "update", "delete", "suspend", "resume"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_bids_set",
    service: "keywordbids",
    description: "Set keyword bids or auto-bids.",
    methods: ["set", "setAuto"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_bidmodifiers_manage",
    service: "bidmodifiers",
    description: "Manage bid modifiers (demographics/geo/device adjustments).",
    methods: ["add", "delete", "set", "toggle"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_sitelinks_manage",
    service: "sitelinks",
    description: "Manage sitelink sets (sitelinks are immutable: add new sets, delete old ones).",
    methods: ["add", "delete"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_adextensions_manage",
    service: "adextensions",
    description: "Manage ad extensions (callouts).",
    methods: ["add", "delete"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_adimages_manage",
    service: "adimages",
    description: "Manage ad images (add expects ImageData as base64).",
    methods: ["add", "delete"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_retargetinglists_manage",
    service: "retargetinglists",
    description: "Manage retargeting lists / audience conditions.",
    methods: ["add", "update", "delete"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_audiencetargets_manage",
    service: "audiencetargets",
    description: "Manage audience targets (bind retargeting lists to ad groups, set bids).",
    methods: ["add", "delete", "suspend", "resume", "setBids"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_feeds_manage",
    service: "feeds",
    description: "Manage product feeds for smart banners / dynamic ads.",
    methods: ["add", "update", "delete"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_smartadtargets_manage",
    service: "smartadtargets",
    description: "Manage smart banner filters (SmartAdTargets).",
    methods: ["add", "update", "delete", "suspend", "resume", "setBids"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_dynamictextadtargets_manage",
    service: "dynamictextadtargets",
    description: "Manage dynamic text ad targeting conditions (webpages).",
    methods: ["add", "delete", "suspend", "resume", "setBids"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_negativekeywordsharedsets_manage",
    service: "negativekeywordsharedsets",
    description: "Manage shared negative keyword sets (attach to campaigns via campaigns_manage).",
    methods: ["add", "update", "delete"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_vcards_manage",
    service: "vcards",
    description: "Manage virtual business cards (vCards are immutable: add new, delete old).",
    methods: ["add", "delete"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_advideos_manage",
    service: "advideos",
    description: "Add ad videos (VideoData as base64, or by Url).",
    methods: ["add"],
  });
  registerDirectWrite(server, {
    name: "yandex_direct_clients_manage",
    service: "clients",
    description: "Update advertiser client settings (notifications, settings flags).",
    methods: ["update"],
  });
}
