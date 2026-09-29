import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerDiagnosticsTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_diagnostics_get",
    "Get site diagnostics — problems by severity (FATAL, CRITICAL, POSSIBLE_PROBLEM, RECOMMENDATION) and state (PRESENT, ABSENT, UNDEFINED)",
    {
      host_id: z.string().describe("Host ID"),
    },
    async ({ host_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/diagnostics", {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
