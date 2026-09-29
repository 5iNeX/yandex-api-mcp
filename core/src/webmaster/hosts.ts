import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerHostsTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_hosts_list",
    "List all sites added to Yandex Webmaster",
    {},
    async () => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_hosts_get",
    "Get detailed info about a specific site in Yandex Webmaster",
    {
      host_id: z.string().describe("Host ID from hosts_list (e.g. 'https:hubmarket.ru:443')"),
    },
    async ({ host_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}", { hostId: host_id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_hosts_add",
    "Add a new site to Yandex Webmaster",
    {
      host_url: z.string().describe("Site URL to add (e.g. 'https://example.com')"),
    },
    async ({ host_url }) => {
      const client = getClient();
      const data = await client.webmasterRequest("POST", "/hosts", { body: { host_url } });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_hosts_delete",
    "Remove a site from Yandex Webmaster",
    {
      host_id: z.string().describe("Host ID to remove"),
    },
    async ({ host_id }) => {
      const client = getClient();
      await client.webmasterRequest("DELETE", "/hosts/{host_id}", { hostId: host_id });
      return {
        content: [{ type: "text" as const, text: "Host deleted successfully" }],
      };
    }
  );
}
