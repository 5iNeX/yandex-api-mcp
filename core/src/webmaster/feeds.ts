import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

const feedType = z.enum(["REALTY", "VACANCY", "GOODS", "DOCTORS", "CARS", "SERVICES", "EDUCATION", "ACTIVITY"]);

export function registerFeedsTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_feeds_add",
    "Start async feed upload (YML feed for structured data)",
    {
      host_id: z.string().describe("Host ID"),
      url: z.string().describe("Feed URL"),
      type: feedType.describe("Feed type"),
      region_ids: z.array(z.number()).describe("Region IDs for the feed"),
    },
    async ({ host_id, url, type, region_ids }) => {
      const client = getClient();
      const data = await client.webmasterRequest("POST", "/hosts/{host_id}/feeds/add/start", {
        hostId: host_id,
        body: { url, type, regionIds: region_ids },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_feeds_add_status",
    "Check async feed upload status (OK or IN_PROGRESS)",
    {
      host_id: z.string().describe("Host ID"),
      request_id: z.string().describe("Request ID from feeds_add"),
    },
    async ({ host_id, request_id }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/feeds/add/info", {
        hostId: host_id,
        params: { requestId: request_id },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_feeds_batch_add",
    "Batch upload up to 50 feeds at once",
    {
      host_id: z.string().describe("Host ID"),
      feeds: z.array(z.object({
        url: z.string().describe("Feed URL"),
        type: feedType.describe("Feed type"),
        regionIds: z.array(z.number()).describe("Region IDs"),
      })).max(50).describe("Array of feeds (max 50)"),
    },
    async ({ host_id, feeds }) => {
      const client = getClient();
      const data = await client.webmasterRequest("POST", "/hosts/{host_id}/feeds/batch/add", {
        hostId: host_id,
        body: { feeds },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_feeds_list",
    "List uploaded feeds",
    {
      host_id: z.string().describe("Host ID"),
      offset: z.number().optional().describe("Pagination offset"),
      limit: z.number().min(1).max(100).optional().describe("Results per page (1-100)"),
    },
    async ({ host_id, offset, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/feeds/list", {
        hostId: host_id,
        params: { offset, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_feeds_batch_delete",
    "Batch delete feeds by URL (max 1000)",
    {
      host_id: z.string().describe("Host ID"),
      urls: z.array(z.string()).max(1000).describe("Feed URLs to delete (max 1000)"),
    },
    async ({ host_id, urls }) => {
      const client = getClient();
      const data = await client.webmasterRequest("DELETE", "/hosts/{host_id}/feeds/batch/remove", {
        hostId: host_id,
        body: { urls },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_feeds_change_regions",
    "Change regions for an existing feed",
    {
      host_id: z.string().describe("Host ID"),
      url: z.string().describe("Feed URL"),
      new_region_ids: z.array(z.number()).describe("New region IDs"),
    },
    async ({ host_id, url, new_region_ids }) => {
      const client = getClient();
      const data = await client.webmasterRequest("POST", "/hosts/{host_id}/feeds/change", {
        hostId: host_id,
        body: { url, newRegionIds: new_region_ids },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
