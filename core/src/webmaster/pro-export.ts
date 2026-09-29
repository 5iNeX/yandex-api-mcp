import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerProExportTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_pro_regions",
    "Get available regions for enhanced search query export",
    {
      host_id: z.string().describe("Host ID"),
      filter: z.string().optional().describe("Filter regions by name substring"),
      limit: z.number().optional().describe("Max results to return"),
    },
    async ({ host_id, filter, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/pro/regions", {
        hostId: host_id,
        params: { filter, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_pro_limits",
    "Check enhanced export API request quotas and remaining limits",
    {
      host_id: z.string().describe("Host ID"),
    },
    async ({ host_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/pro/limits", {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_pro_dates",
    "Get available dates for search query export (up to 550 days back)",
    {
      host_id: z.string().describe("Host ID"),
    },
    async ({ host_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/pro/serp/dates", {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_pro_export_start",
    "Start async enhanced search query export. Processing takes 20min-2h. Use export_status to poll.",
    {
      host_id: z.string().describe("Host ID"),
      dates: z.array(z.string()).describe("Dates to export (YYYY-MM-DD format)"),
      paths: z.array(z.string()).optional().describe("URL path filters"),
      region_ids: z.array(z.number()).optional().describe("Region IDs to include"),
      use_pro_tariff: z.enum(["true", "false"]).optional().describe("Use PRO tariff quota"),
    },
    async ({ host_id, dates, paths, region_ids, use_pro_tariff }) => {
      const client = getClient();
      const data = await client.webmasterRequest("POST", "/hosts/{host_id}/pro/serp/queries/download/", {
        hostId: host_id,
        body: { dates, paths, region_ids, use_pro_tariff },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_pro_export_status",
    "Check export task status. Returns SUCCESS (with download url), IN_PROGRESS, or FAILED.",
    {
      host_id: z.string().describe("Host ID"),
      task_id: z.string().describe("Export task ID from export_start"),
    },
    async ({ host_id, task_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", `/hosts/{host_id}/pro/serp/queries/download/${task_id}`, {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
