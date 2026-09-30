import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerLinksTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_links_external_samples",
    "Get external backlink samples pointing to this site",
    {
      host_id: z.string().describe("Host ID"),
      offset: z.number().optional().describe("Pagination offset"),
      limit: z.number().optional().describe("Results per page"),
    },
    async ({ host_id, offset, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/links/external/samples", {
        hostId: host_id,
        params: { offset, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_links_external_history",
    "Get external backlinks count history over time",
    {
      host_id: z.string().describe("Host ID"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
    },
    async ({ host_id, date_from, date_to }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/links/external/history", {
        hostId: host_id,
        params: { date_from, date_to },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_links_internal_samples",
    "Get broken internal link samples",
    {
      host_id: z.string().describe("Host ID"),
      offset: z.number().optional().describe("Pagination offset"),
      limit: z.number().optional().describe("Results per page"),
    },
    async ({ host_id, offset, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/links/internal/broken/samples", {
        hostId: host_id,
        params: { offset, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_links_internal_history",
    "Get internal links count history over time",
    {
      host_id: z.string().describe("Host ID"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
    },
    async ({ host_id, date_from, date_to }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/links/internal/broken/history", {
        hostId: host_id,
        params: { date_from, date_to },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
