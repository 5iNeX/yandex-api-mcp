import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";

export function registerUserTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_user_get",
    "Get current Yandex Webmaster user ID and account info",
    {},
    async () => {
      const client = getClient();
      const data = await client.request<{ user_id: number }>("GET", "/v4/user");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
