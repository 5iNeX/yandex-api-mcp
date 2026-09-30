import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

const queryIndicator = z.enum(["TOTAL_SHOWS", "TOTAL_CLICKS", "AVG_SHOW_POSITION", "AVG_CLICK_POSITION"]).optional();
const deviceType = z.enum(["ALL", "DESKTOP", "MOBILE_AND_TABLET", "MOBILE", "TABLET"]).optional();

export function registerSearchQueriesTools(server: McpServer): void {
  server.tool(
    "yandex_webmaster_search_queries_popular",
    "Get top search queries for a site (up to 3000, max 500 per page). Data delayed ~1 week.",
    {
      host_id: z.string().describe("Host ID"),
      order_by: z.enum(["TOTAL_SHOWS", "TOTAL_CLICKS"]).default("TOTAL_SHOWS").describe("Sort order"),
      query_indicator: queryIndicator.describe("Metric to include"),
      device_type_indicator: deviceType.describe("Device filter"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
      offset: z.number().optional().describe("Pagination offset"),
      limit: z.number().min(1).max(500).optional().describe("Results per page (1-500)"),
    },
    async ({ host_id, order_by, query_indicator, device_type_indicator, date_from, date_to, offset, limit }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/search-queries/popular", {
        hostId: host_id,
        params: { order_by: order_by ?? "TOTAL_SHOWS", query_indicator, device_type_indicator, date_from, date_to, offset, limit },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_search_queries_all_history",
    "Get aggregate search query statistics over time for all queries",
    {
      host_id: z.string().describe("Host ID"),
      query_indicator: queryIndicator.describe("Metric to include"),
      device_type_indicator: deviceType.describe("Device filter"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
    },
    async ({ host_id, query_indicator, device_type_indicator, date_from, date_to }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", "/hosts/{host_id}/search-queries/all/history", {
        hostId: host_id,
        params: { query_indicator, device_type_indicator, date_from, date_to },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_search_queries_history",
    "Get search query statistics over time for a specific query",
    {
      host_id: z.string().describe("Host ID"),
      query_id: z.string().describe("Query ID from popular queries"),
      query_indicator: queryIndicator.describe("Metric to include"),
      device_type_indicator: deviceType.describe("Device filter"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
    },
    async ({ host_id, query_id, query_indicator, device_type_indicator, date_from, date_to }) => {
      const client = getClient();
      const data = await client.webmasterRequest("GET", `/hosts/{host_id}/search-queries/${query_id}/history`, {
        hostId: host_id,
        params: { query_indicator, device_type_indicator, date_from, date_to },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "yandex_webmaster_query_analytics",
    "Query analytics: search queries and URLs the site is shown for (last 2 weeks), with text/statistic filters, device and region breakdowns.",
    {
      host_id: z.string().describe("Host ID"),
      text_indicator: z
        .enum(["QUERY", "URL"])
        .optional()
        .describe("Group rows by search query text or by page URL (default QUERY)"),
      device_type_indicator: z
        .enum(["ALL", "DESKTOP", "MOBILE", "TABLET", "MOBILE_AND_TABLET"])
        .optional()
        .describe("Device filter"),
      region_ids: z.array(z.number()).optional().describe("Region ids (e.g. 213 Moscow, 1 Moscow region)"),
      filters: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "Filters object: { text_filters: [{text_indicator, operation: TEXT_CONTAINS|..., value}], statistic_filters: [{statistic_field: IMPRESSIONS|CLICKS|CTR|POSITION, operation, value}] }"
        ),
      sort_by_date: z
        .record(z.string(), z.any())
        .optional()
        .describe("Sort: { date: 'YYYY-MM-DD', statistic_field: IMPRESSIONS|CLICKS|CTR|POSITION, by: ASC|DESC }"),
      limit: z.number().optional().describe("Rows per page (default 20, max 500)"),
      offset: z.number().optional().describe("Offset for paging"),
    },
    async ({ host_id, text_indicator, device_type_indicator, region_ids, filters, sort_by_date, limit, offset }) => {
      const client = getClient();
      const data = await client.webmasterRequest("POST", "/hosts/{host_id}/query-analytics/list", {
        hostId: host_id,
        body: {
          ...(offset !== undefined ? { offset } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(device_type_indicator ? { device_type_indicator } : {}),
          ...(text_indicator ? { text_indicator } : {}),
          ...(region_ids ? { region_ids } : {}),
          ...(filters ? { filters } : {}),
          ...(sort_by_date ? { sort_by_date } : {}),
        },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
