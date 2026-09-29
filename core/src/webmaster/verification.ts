import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerVerificationTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_verification_start",
    "Start site ownership verification in Yandex Webmaster",
    {
      host_id: z.string().describe("Host ID"),
      verification_type: z.enum(["DNS", "HTML_FILE", "META_TAG"]).describe("Verification method"),
    },
    async ({ host_id, verification_type }) => {
      const client = getClient();
      const data = await client.webmasterRequest("POST", "/hosts/{host_id}/verification", {
        hostId: host_id,
        params: { verification_type },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_verification_status",
    "Get site ownership verification status",
    {
      host_id: z.string().describe("Host ID"),
    },
    async ({ host_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/verification", {
        hostId: host_id,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_verification_owners",
    "List users who confirmed site management rights",
    {
      host_id: z.string().describe("Host ID"),
      offset: z.number().optional().describe("Pagination offset"),
      limit: z.number().min(1).max(100).optional().describe("Results per page (1-100)"),
    },
    async ({ host_id, offset, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/owners", {
        hostId: host_id,
        params: { offset, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
