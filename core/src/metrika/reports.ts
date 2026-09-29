import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient, getProject } from "../client.js";

function asText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function resolveIds(projectId: string | undefined, ids: string | undefined): string {
  if (ids) return ids;
  const counter = getProject(projectId).default_counter;
  if (!counter) {
    throw new Error("No ids given and the project has no default_counter configured.");
  }
  return String(counter);
}

const baseStatSchema = {
  project: z.string().optional().describe("Project id (defaults to the active project)"),
  ids: z
    .string()
    .optional()
    .describe("Comma-separated counter ids (defaults to the project's default_counter)"),
  metrics: z
    .string()
    .describe("Comma-separated metrics, e.g. 'ym:s:visits,ym:s:users,ym:s:bounceRate'"),
  dimensions: z
    .string()
    .optional()
    .describe("Comma-separated dimensions, e.g. 'ym:s:date,ym:s:lastTrafficSource'"),
  date1: z.string().optional().describe("Start date: YYYY-MM-DD, today, yesterday or NdaysAgo"),
  date2: z.string().optional().describe("End date: YYYY-MM-DD, today, yesterday or NdaysAgo"),
  filters: z.string().optional().describe("Segmentation filter expression"),
  sort: z.string().optional().describe("Comma-separated sort fields, '-' prefix for descending"),
  limit: z.number().optional().describe("Rows to return (default 100)"),
  offset: z.number().optional().describe("1-based index of the first returned row"),
  accuracy: z.string().optional().describe("Sampling accuracy: low, medium, high or full"),
  preset: z.string().optional().describe("Report preset name"),
  direct_client_logins: z
    .string()
    .optional()
    .describe(
      "Comma-separated Direct logins — required for advertising reports with ym:ad: metrics/dimensions (e.g. metrics 'ym:ad:clicks,ym:ad:RUBAdCost', dimensions 'ym:ad:campaign')"
    ),
  extra_params: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional()
    .describe("Any additional query params (attribution, currency, include_undefined, lang, ...)"),
};

const comparisonSchema = {
  ...baseStatSchema,
  date1_a: z.string().optional().describe("Segment A start date"),
  date2_a: z.string().optional().describe("Segment A end date"),
  date1_b: z.string().optional().describe("Segment B start date"),
  date2_b: z.string().optional().describe("Segment B end date"),
  filters_a: z.string().optional().describe("Segment A filter expression"),
  filters_b: z.string().optional().describe("Segment B filter expression"),
};

type StatArgs = { project?: string; ids?: string; extra_params?: Record<string, string | number> } & Record<
  string,
  string | number | Record<string, string | number> | undefined
>;

function statHandler(path: string) {
  return async ({ project, ids, extra_params, ...rest }: StatArgs) => {
    const client = getClient(project);
    const data = await client.metrikaRequest("GET", path, {
      params: {
        ids: resolveIds(project, ids),
        ...(rest as Record<string, string | number | undefined>),
        ...(extra_params ?? {}),
      },
    });
    return asText(data);
  };
}

export function registerReportTools(server: McpServer): void {
  server.tool(
    "yandex_metrika_stat_data",
    "Metrika report: aggregated data table (Reporting API /stat/v1/data).",
    baseStatSchema,
    statHandler("/stat/v1/data")
  );

  server.tool(
    "yandex_metrika_stat_bytime",
    "Metrika report: metrics over time (/stat/v1/data/bytime).",
    {
      ...baseStatSchema,
      group: z.string().optional().describe("Time grouping: day, week, month, quarter, year"),
    },
    statHandler("/stat/v1/data/bytime")
  );

  server.tool(
    "yandex_metrika_stat_drilldown",
    "Metrika report: tree-like drilldown into one dimension level at a time (/stat/v1/data/drilldown).",
    {
      ...baseStatSchema,
      parent_id: z.string().optional().describe("JSON array of parent dimension keys to expand"),
    },
    statHandler("/stat/v1/data/drilldown")
  );

  server.tool(
    "yandex_metrika_stat_comparison",
    "Metrika report: compare two segments (/stat/v1/data/comparison).",
    comparisonSchema,
    statHandler("/stat/v1/data/comparison")
  );

  server.tool(
    "yandex_metrika_stat_comparison_drilldown",
    "Metrika report: segment comparison with drilldown (/stat/v1/data/comparison/drilldown).",
    {
      ...comparisonSchema,
      parent_id: z.string().optional().describe("JSON array of parent dimension keys to expand"),
    },
    statHandler("/stat/v1/data/comparison/drilldown")
  );
}
