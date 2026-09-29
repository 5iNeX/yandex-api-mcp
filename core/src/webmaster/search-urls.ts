import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerSearchUrlsTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_search_urls_in_search_history",
    "Get history of pages appearing in Yandex search results over time",
    {
      host_id: z.string().describe("Host ID"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
    },
    async ({ host_id, date_from, date_to }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/search-urls/in-search/history", {
        hostId: host_id,
        params: { date_from, date_to },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_search_urls_in_search_samples",
    "Get pages currently in Yandex search results (up to 50,000 URLs)",
    {
      host_id: z.string().describe("Host ID"),
      offset: z.number().optional().describe("Pagination offset"),
      limit: z.number().min(1).max(100).optional().describe("Results per page (1-100)"),
    },
    async ({ host_id, offset, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/search-urls/in-search/samples", {
        hostId: host_id,
        params: { offset, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_search_urls_events_history",
    "Get history of search result events (pages added/removed from search)",
    {
      host_id: z.string().describe("Host ID"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
    },
    async ({ host_id, date_from, date_to }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/search-urls/events/history", {
        hostId: host_id,
        params: { date_from, date_to },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_search_urls_events_samples",
    "Get sample pages recently added/removed from Yandex search results",
    {
      host_id: z.string().describe("Host ID"),
      offset: z.number().optional().describe("Pagination offset"),
      limit: z.number().min(1).max(100).optional().describe("Results per page (1-100)"),
    },
    async ({ host_id, offset, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/search-urls/events/samples", {
        hostId: host_id,
        params: { offset, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
