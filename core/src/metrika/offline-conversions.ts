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

export function registerOfflineConversionTools(server: McpServer): void {
  server.tool(
    "yandex_metrika_offline_conversions_upload",
    "Upload offline conversions (CRM sales, calls) to Metrika so Direct auto-strategies learn on real money, not just site events. CSV columns: UserId|ClientId|Yclid, Target, DateTime (unix), Price?, Currency?. Mutating: previews unless confirm:true.",
    {
      project: projectParam,
      counter_id: counterParam,
      csv: z
        .string()
        .describe(
          "CSV content with a header line, e.g. 'ClientId,Target,DateTime,Price,Currency\\n133591247...,order,1720000000,1000,RUB'"
        ),
      client_id_type: z
        .enum(["USER_ID", "CLIENT_ID", "YCLID"])
        .describe("Which id column is used to match visitors"),
      comment: z.string().optional().describe("Comment shown in the uploadings list"),
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to actually upload (default false = preview only)"),
    },
    async ({ project, counter_id, csv, client_id_type, comment, confirm }) => {
      const counter = resolveCounter(project, counter_id);
      const lines = csv.trim().split("\n");
      const summary = {
        counter,
        client_id_type,
        header: lines[0],
        rows: Math.max(0, lines.length - 1),
      };
      if (!confirm) {
        return asText({
          preview: true,
          ...summary,
          note: "Not uploaded. Re-run with confirm:true to apply. Conversions must reference visits of the last 21 days.",
        });
      }
      const client = getClient(project);
      const data = await client.metrikaUpload(
        `/management/v1/counter/${counter}/offline_conversions/upload`,
        { client_id_type, comment },
        csv
      );
      return asText({ executed: true, ...summary, result: data });
    }
  );

  server.tool(
    "yandex_metrika_offline_conversions_uploadings",
    "List offline conversion uploads and their processing status (or one by uploading_id).",
    {
      project: projectParam,
      counter_id: counterParam,
      uploading_id: z.number().optional().describe("Specific uploading id to fetch"),
      limit: z.number().optional().describe("Max uploads to list (default 1000)"),
      offset: z.number().optional().describe("1-based offset"),
    },
    async ({ project, counter_id, uploading_id, limit, offset }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const path =
        uploading_id !== undefined
          ? `/management/v1/counter/${counter}/offline_conversions/uploading/${uploading_id}`
          : `/management/v1/counter/${counter}/offline_conversions/uploadings`;
      const data = await client.metrikaRequest("GET", path, {
        params: uploading_id !== undefined ? {} : { limit, offset },
      });
      return asText(data);
    }
  );
}
