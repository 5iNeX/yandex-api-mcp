import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

function asText(data: unknown, units: string | null) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ units, result: data }, null, 2) }] };
}

const DICTIONARY_TTL_MS = 24 * 60 * 60 * 1000;
const dictionaryCache = new Map<string, { ts: number; data: unknown }>();

interface DirectGetConfig {
  name: string;
  service: string;
  description: string;
}

function registerDirectGet(server: McpServer, cfg: DirectGetConfig): void {
  server.tool(
    cfg.name,
    cfg.description,
    {
      project: z.string().optional().describe("Project id (defaults to the active project)"),
      field_names: z.array(z.string()).describe("FieldNames to return, e.g. ['Id','Name','Status']"),
      selection_criteria: z.record(z.string(), z.any()).optional().describe("Direct SelectionCriteria object. For adgroups, ads and keywords provide CampaignIds or another supported filter; an empty criterion is rejected by Yandex."),
      page: z
        .object({ Limit: z.number().optional(), Offset: z.number().optional() })
        .optional()
        .describe("Paging: { Limit, Offset }"),
      extra_params: z.record(z.string(), z.any()).optional().describe("Extra params merged into the request body"),
    },
    async ({ project, field_names, selection_criteria, page, extra_params }) => {
      const client = getClient(project);
      const params: Record<string, unknown> = {
        SelectionCriteria: selection_criteria ?? {},
        FieldNames: field_names,
        ...(page ? { Page: page } : {}),
        ...(extra_params ?? {}),
      };
      const data = await client.directRequest(cfg.service, "get", params);
      return asText(data, client.lastUnits);
    }
  );
}

export function registerDirectReadTools(server: McpServer): void {
  registerDirectGet(server, { name: "yandex_direct_campaigns_get", service: "campaigns", description: "Get Direct campaigns." });
  registerDirectGet(server, { name: "yandex_direct_adgroups_get", service: "adgroups", description: "Get Direct ad groups." });
  registerDirectGet(server, { name: "yandex_direct_ads_get", service: "ads", description: "Get Direct ads." });
  registerDirectGet(server, { name: "yandex_direct_keywords_get", service: "keywords", description: "Get Direct keywords." });
  registerDirectGet(server, { name: "yandex_direct_bids_get", service: "keywordbids", description: "Get Direct keyword bids." });
  registerDirectGet(server, { name: "yandex_direct_bidmodifiers_get", service: "bidmodifiers", description: "Get Direct bid modifiers (demographics, geo, device adjustments)." });
  registerDirectGet(server, { name: "yandex_direct_sitelinks_get", service: "sitelinks", description: "Get Direct sitelink sets." });
  registerDirectGet(server, { name: "yandex_direct_adextensions_get", service: "adextensions", description: "Get Direct ad extensions (callouts)." });
  registerDirectGet(server, { name: "yandex_direct_adimages_get", service: "adimages", description: "Get Direct ad images (uploaded creatives)." });
  registerDirectGet(server, { name: "yandex_direct_retargetinglists_get", service: "retargetinglists", description: "Get Direct retargeting lists / audience conditions." });
  registerDirectGet(server, { name: "yandex_direct_audiencetargets_get", service: "audiencetargets", description: "Get Direct audience targets (retargeting bindings to ad groups)." });
  registerDirectGet(server, { name: "yandex_direct_feeds_get", service: "feeds", description: "Get Direct product feeds (for smart banners and dynamic ads)." });
  registerDirectGet(server, { name: "yandex_direct_creatives_get", service: "creatives", description: "Get Direct creatives (smart banners, video; created in the Creative Constructor)." });
  registerDirectGet(server, { name: "yandex_direct_smartadtargets_get", service: "smartadtargets", description: "Get Direct smart banner filters (SmartAdTargets)." });
  registerDirectGet(server, { name: "yandex_direct_dynamictextadtargets_get", service: "dynamictextadtargets", description: "Get Direct dynamic text ad targeting conditions (webpages)." });
  registerDirectGet(server, { name: "yandex_direct_negativekeywordsharedsets_get", service: "negativekeywordsharedsets", description: "Get Direct shared negative keyword sets." });
  registerDirectGet(server, { name: "yandex_direct_vcards_get", service: "vcards", description: "Get Direct virtual business cards (vCards)." });
  registerDirectGet(server, { name: "yandex_direct_leads_get", service: "leads", description: "Get leads submitted via Direct turbo page forms." });
  registerDirectGet(server, { name: "yandex_direct_turbopages_get", service: "turbopages", description: "Get Direct turbo pages." });
  registerDirectGet(server, { name: "yandex_direct_businesses_get", service: "businesses", description: "Get Yandex Business profiles linked to the Direct account." });
  registerDirectGet(server, { name: "yandex_direct_agencyclients_get", service: "agencyclients", description: "Get agency clients (agency accounts only)." });
  registerDirectGet(server, { name: "yandex_direct_advideos_get", service: "advideos", description: "Get Direct ad videos (for video extensions)." });

  server.tool(
    "yandex_direct_dictionaries_get",
    "Get Direct reference dictionaries (regions, currencies, time zones, etc.). Responses are cached in-memory for 24h — dictionaries rarely change and GeoRegions is large.",
    {
      project: z.string().optional().describe("Project id (defaults to the active project)"),
      dictionary_names: z.array(z.string()).describe("DictionaryNames, e.g. ['GeoRegions','Currencies']"),
    },
    async ({ project, dictionary_names }) => {
      const client = getClient(project);
      const key = `${project ?? ""}:${[...dictionary_names].sort().join(",")}`;
      const cached = dictionaryCache.get(key);
      if (cached && Date.now() - cached.ts < DICTIONARY_TTL_MS) {
        return asText(cached.data, "cached");
      }
      const data = await client.directRequest("dictionaries", "get", { DictionaryNames: dictionary_names });
      dictionaryCache.set(key, { ts: Date.now(), data });
      return asText(data, client.lastUnits);
    }
  );

  server.tool(
    "yandex_direct_units",
    "Show the Direct API points quota from the last response per project (spent/available/daily limit).",
    { project: z.string().optional().describe("Project id (defaults to the active project)") },
    async ({ project }) => {
      const client = getClient(project);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                units: client.lastUnits,
                format: "spent_in_last_call/available/daily_limit",
                note: client.lastUnits ? undefined : "No Direct call made yet in this session.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "yandex_direct_clients_get",
    "Get info about the advertiser account (clients).",
    {
      project: z.string().optional().describe("Project id (defaults to the active project)"),
      field_names: z.array(z.string()).describe("FieldNames, e.g. ['ClientId','Login','Currency']"),
    },
    async ({ project, field_names }) => {
      const client = getClient(project);
      const data = await client.directRequest("clients", "get", { FieldNames: field_names });
      return asText(data, client.lastUnits);
    }
  );

  server.tool(
    "yandex_direct_keywords_research",
    "Keyword research: deduplicate a keyword list or check search volume (KeywordsResearch service). Useful to diagnose narrow niches before choosing autotargeting vs manual keywords.",
    {
      project: z.string().optional().describe("Project id (defaults to the active project)"),
      method: z
        .enum(["deduplicate", "hasSearchVolume"])
        .describe("deduplicate: merge duplicates/normalize; hasSearchVolume: check impressions availability by device"),
      params: z
        .record(z.string(), z.any())
        .describe(
          "Params: deduplicate → { Keywords: [{Keyword, Weight?}], Operation? }; hasSearchVolume → { SelectionCriteria: {Keywords, RegionIds}, FieldNames }"
        ),
    },
    async ({ project, method, params }) => {
      const client = getClient(project);
      const data = await client.directRequest("keywordsresearch", method, params);
      return asText(data, client.lastUnits);
    }
  );

  server.tool(
    "yandex_direct_changes_check",
    "Check which Direct objects changed since a timestamp (Changes service).",
    {
      project: z.string().optional().describe("Project id (defaults to the active project)"),
      params: z.record(z.string(), z.any()).describe("Params for Changes.check / checkDirty, e.g. { Timestamp, FieldNames }"),
      method: z.enum(["check", "checkDirty"]).optional().describe("Changes method (default 'check')"),
    },
    async ({ project, params, method }) => {
      const client = getClient(project);
      const data = await client.directRequest("changes", method ?? "check", params);
      return asText(data, client.lastUnits);
    }
  );
}
