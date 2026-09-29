import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerRecrawlTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_recrawl_submit",
    "Submit a page URL for priority recrawl by Yandex",
    {
      host_id: z.string().describe("Host ID"),
      url: z.string().describe("Page URL to recrawl"),
    },
    async ({ host_id, url }) => {
      const client = getClient();
      const data = await client.webmasterRequest("POST", "/hosts/{host_id}/recrawl/queue", {
        hostId: host_id,
        body: { url },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_recrawl_status",
    "Check recrawl task status",
    {
      host_id: z.string().describe("Host ID"),
      task_id: z.string().describe("Recrawl task ID"),
    },
    async ({ host_id, task_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", `/hosts/{host_id}/recrawl/queue/${task_id}`, {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_recrawl_list",
    "List all recrawl tasks",
    {
      host_id: z.string().describe("Host ID"),
      offset: z.number().optional().describe("Pagination offset"),
      limit: z.number().optional().describe("Results per page"),
    },
    async ({ host_id, offset, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/recrawl/queue", {
        hostId: host_id,
        params: { offset, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_recrawl_quota",
    "Check daily recrawl quota",
    {
      host_id: z.string().describe("Host ID"),
    },
    async ({ host_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/recrawl/quota", {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // v4.1 endpoints for sitemap recrawl
  server.tool(
    "yandex_webmaster_recrawl_sitemap_quota",
    "Check monthly sitemap priority recrawl quota",
    {
      host_id: z.string().describe("Host ID"),
    },
    async ({ host_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/sitemaps/recrawl", {
        hostId: host_id,
        apiVersion: "v4.1",
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_recrawl_sitemap_submit",
    "Submit a sitemap for priority recrawl (monthly limit applies)",
    {
      host_id: z.string().describe("Host ID"),
      sitemap_id: z.string().describe("Sitemap ID to recrawl"),
    },
    async ({ host_id, sitemap_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("POST", `/hosts/{host_id}/sitemaps/${sitemap_id}/recrawl`, {
        hostId: host_id,
        apiVersion: "v4.1",
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
