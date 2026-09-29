import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient, getProject } from "../client.js";

function asText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function resolveCounter(projectId: string | undefined, counterId: number | undefined): number {
  const counter = counterId ?? getProject(projectId).default_counter;
  if (!counter) {
    throw new Error("No counter_id given and the project has no default_counter configured.");
  }
  return counter;
}

const projectParam = z.string().optional().describe("Project id (defaults to the active project)");
const counterParam = z
  .number()
  .optional()
  .describe("Counter id (defaults to the project's default_counter)");

const logParams = {
  date1: z.string().describe("Start date YYYY-MM-DD (max period 1 year)"),
  date2: z.string().describe("End date YYYY-MM-DD (must not include today)"),
  fields: z
    .string()
    .describe(
      "Comma-separated log fields, e.g. 'ym:s:visitID,ym:s:clientID,ym:s:dateTime,ym:s:lastTrafficSource,ym:s:goalsID'"
    ),
  source: z.enum(["visits", "hits"]).describe("Log source: visits or hits"),
};

export function registerLogsTools(server: McpServer): void {
  server.tool(
    "yandex_metrika_logs_evaluate",
    "Check whether a Logs API request for raw visits/hits data is feasible (size/quota estimate).",
    { project: projectParam, counter_id: counterParam, ...logParams },
    async ({ project, counter_id, date1, date2, fields, source }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const data = await client.metrikaRequest(
        "GET",
        `/management/v1/counter/${counter}/logrequests/evaluate`,
        { params: { date1, date2, fields, source } }
      );
      return asText(data);
    }
  );

  server.tool(
    "yandex_metrika_logs_request_create",
    "Create a Logs API request (queued server-side). Save the returned request_id and poll with logs_requests until status=processed, then use logs_download.",
    { project: projectParam, counter_id: counterParam, ...logParams },
    async ({ project, counter_id, date1, date2, fields, source }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const data = await client.metrikaRequest(
        "POST",
        `/management/v1/counter/${counter}/logrequests`,
        { params: { date1, date2, fields, source } }
      );
      return asText(data);
    }
  );

  server.tool(
    "yandex_metrika_logs_requests",
    "List Logs API requests and their statuses, or one by request_id (status=processed means parts are ready to download).",
    {
      project: projectParam,
      counter_id: counterParam,
      request_id: z.number().optional().describe("Specific log request id"),
    },
    async ({ project, counter_id, request_id }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const path =
        request_id !== undefined
          ? `/management/v1/counter/${counter}/logrequest/${request_id}`
          : `/management/v1/counter/${counter}/logrequests`;
      const data = await client.metrikaRequest("GET", path);
      return asText(data);
    }
  );

  server.tool(
    "yandex_metrika_logs_download",
    "Download one part of a processed Logs API request as TSV. Output is truncated to max_rows to protect the context window — use offset_rows to page through, or lower max_rows.",
    {
      project: projectParam,
      counter_id: counterParam,
      request_id: z.number().describe("Log request id (status must be 'processed')"),
      part: z.number().optional().describe("Part number (default 0; see parts[] in logs_requests)"),
      max_rows: z.number().optional().describe("Max data rows to return (default 200)"),
      offset_rows: z.number().optional().describe("Skip this many data rows before returning (default 0)"),
    },
    async ({ project, counter_id, request_id, part, max_rows, offset_rows }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const text = await client.metrikaDownload(
        `/management/v1/counter/${counter}/logrequest/${request_id}/part/${part ?? 0}/download`
      );
      const lines = text.split("\n").filter((l) => l.length > 0);
      const header = lines[0] ?? "";
      const rows = lines.slice(1);
      const start = offset_rows ?? 0;
      const limit = max_rows ?? 200;
      const slice = rows.slice(start, start + limit);
      const out = [
        `# total_rows=${rows.length} returned=${slice.length} offset=${start}`,
        header,
        ...slice,
      ].join("\n");
      return { content: [{ type: "text" as const, text: out }] };
    }
  );

  server.tool(
    "yandex_metrika_logs_clean",
    "Clean a processed Logs API request (frees server-side quota) or cancel one still in queue.",
    {
      project: projectParam,
      counter_id: counterParam,
      request_id: z.number().describe("Log request id"),
      action: z.enum(["clean", "cancel"]).optional().describe("clean processed (default) or cancel queued"),
    },
    async ({ project, counter_id, request_id, action }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const data = await client.metrikaRequest(
        "POST",
        `/management/v1/counter/${counter}/logrequest/${request_id}/${action ?? "clean"}`
      );
      return asText(data);
    }
  );
}
