import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerSummaryTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_summary_get",
    "Get site statistics summary (SQI, searchable pages, excluded pages, problems)",
    {
      host_id: z.string().describe("Host ID"),
    },
    async ({ host_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/summary", {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_summary_sqi_history",
    "Get SQI (Site Quality Index) history over time",
    {
      host_id: z.string().describe("Host ID"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
    },
    async ({ host_id, date_from, date_to }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/sqi-history", {
        hostId: host_id,
        params: { date_from, date_to },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
