import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerImportantUrlsTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_important_urls_list",
    "List monitored important URLs with indexing and search status",
    {
      host_id: z.string().describe("Host ID"),
      offset: z.number().optional().describe("Pagination offset"),
      limit: z.number().min(1).max(100).optional().describe("Results per page (1-100)"),
    },
    async ({ host_id, offset, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/important-urls", {
        hostId: host_id,
        params: { offset, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_important_urls_history",
    "Get change history for a specific important URL",
    {
      host_id: z.string().describe("Host ID"),
      url: z.string().describe("URL to check (will be URL-encoded automatically)"),
    },
    async ({ host_id, url }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/important-urls/history", {
        hostId: host_id,
        params: { url },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
