import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerIndexingTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_indexing_history",
    "Get indexing history by HTTP status codes (2xx, 3xx, 4xx, 5xx) over time",
    {
      host_id: z.string().describe("Host ID"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
    },
    async ({ host_id, date_from, date_to }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/indexing/history", {
        hostId: host_id,
        params: { date_from, date_to },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_indexing_samples",
    "Get indexed page samples (up to 50,000 URLs)",
    {
      host_id: z.string().describe("Host ID"),
      offset: z.number().optional().describe("Pagination offset"),
      limit: z.number().min(1).max(100).optional().describe("Results per page (1-100, default 50)"),
    },
    async ({ host_id, offset, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/indexing/samples", {
        hostId: host_id,
        params: { offset, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_indexing_archive_create",
    "Start async archive generation of all pages added to sitemap. Returns task_id for polling.",
    {
      host_id: z.string().describe("Host ID"),
    },
    async ({ host_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("POST", "/hosts/{host_id}/indexing/archive/", {
        hostId: host_id,
        body: {},
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_indexing_archive_status",
    "Check archive generation status. States: IN_PROGRESS, DONE, FAILED. On DONE returns download_url.",
    {
      host_id: z.string().describe("Host ID"),
      task_id: z.string().describe("Task ID from archive_create"),
    },
    async ({ host_id, task_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", `/hosts/{host_id}/indexing/archive/${task_id}`, {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
