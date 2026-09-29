import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerSitemapsTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_sitemaps_list",
    "List all discovered sitemaps for a site",
    {
      host_id: z.string().describe("Host ID"),
      parent_id: z.string().optional().describe("Parent sitemap ID (for index sitemaps)"),
      limit: z.number().optional().describe("Results per page"),
      from: z.string().optional().describe("Pagination cursor"),
    },
    async ({ host_id, parent_id, limit, from }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/sitemaps", {
        hostId: host_id,
        params: { parent_id, limit, from },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_sitemaps_get",
    "Get details of a specific sitemap",
    {
      host_id: z.string().describe("Host ID"),
      sitemap_id: z.string().describe("Sitemap ID"),
    },
    async ({ host_id, sitemap_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", `/hosts/{host_id}/sitemaps/${sitemap_id}`, {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_sitemaps_user_list",
    "List user-added sitemaps",
    {
      host_id: z.string().describe("Host ID"),
      offset: z.number().optional().describe("Pagination offset"),
      limit: z.number().min(1).max(100).optional().describe("Results per page (1-100)"),
    },
    async ({ host_id, offset, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/user-added-sitemaps", {
        hostId: host_id,
        params: { offset, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_sitemaps_user_get",
    "Get details of a specific user-added sitemap",
    {
      host_id: z.string().describe("Host ID"),
      sitemap_id: z.string().describe("Sitemap ID"),
    },
    async ({ host_id, sitemap_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", `/hosts/{host_id}/user-added-sitemaps/${sitemap_id}`, {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_sitemaps_add",
    "Add a new sitemap to Yandex Webmaster",
    {
      host_id: z.string().describe("Host ID"),
      url: z.string().describe("Sitemap URL (e.g. 'https://example.com/sitemap.xml')"),
    },
    async ({ host_id, url }) => {
      const client = getClient();
      const data = await client.webmasterRequest("POST", "/hosts/{host_id}/user-added-sitemaps", {
        hostId: host_id,
        body: { url },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_sitemaps_delete",
    "Delete a user-added sitemap",
    {
      host_id: z.string().describe("Host ID"),
      sitemap_id: z.string().describe("Sitemap ID to delete"),
    },
    async ({ host_id, sitemap_id }) => {
      const client = getClient();
      await client.webmasterRequest("DELETE", `/hosts/{host_id}/user-added-sitemaps/${sitemap_id}`, {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: "Sitemap deleted successfully" }],
      };
    }
  );
}
