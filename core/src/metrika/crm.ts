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

export function registerCrmTools(server: McpServer): void {
  server.tool(
    "yandex_metrika_crm_orders_upload",
    "Upload CRM orders/customers (simplified CDP import) so Metrika reports revenue and LTV and Direct can optimize on real orders. CSV columns: id, create_date_time (DD.MM.YYYY HH:MM, counter timezone), client_uniq_id?, client_ids?, emails?, phones?, order_status? (PAID/CANCELLED/SPAM/...), revenue?, cost?, goals?, currency?. At least one of client_ids/emails/phones per row. Mutating: previews unless confirm:true.",
    {
      project: projectParam,
      counter_id: counterParam,
      csv: z.string().describe("CSV content with a header line (see column list in the tool description)"),
      merge_mode: z
        .enum(["SAVE", "UPDATE", "APPEND"])
        .optional()
        .describe("SAVE: replace previous data (safe default); UPDATE: update uploaded rows; APPEND: add new"),
      delimiter_type: z
        .enum(["COMMA", "SEMICOLON"])
        .optional()
        .describe("CSV delimiter (default COMMA)"),
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to actually upload (default false = preview only)"),
    },
    async ({ project, counter_id, csv, merge_mode, delimiter_type, confirm }) => {
      const counter = resolveCounter(project, counter_id);
      const lines = csv.trim().split("\n");
      const summary = {
        counter,
        merge_mode: merge_mode ?? "SAVE",
        header: lines[0],
        rows: Math.max(0, lines.length - 1),
      };
      if (!confirm) {
        return asText({
          preview: true,
          ...summary,
          note: "Not uploaded. Re-run with confirm:true to apply. Processing may take up to 2 hours.",
        });
      }
      const client = getClient(project);
      const data = await client.metrikaUpload(
        `/cdp/api/v1/counter/${counter}/data/simple_orders`,
        { merge_mode: merge_mode ?? "SAVE", delimiter_type: delimiter_type ?? "COMMA" },
        csv,
        "orders.csv"
      );
      return asText({ executed: true, ...summary, result: data });
    }
  );

  server.tool(
    "yandex_metrika_calls_upload",
    "Upload phone calls as offline conversions (with call-specific fields). CSV columns: UserId|ClientId|Yclid, DateTime (unix), Price?, Currency?, PhoneNumber?, TalkDuration?, HoldDuration?, CallMissed?, Tag?, FirstTimeCaller?, URL?, CallTrackerURL?. Mutating: previews unless confirm:true.",
    {
      project: projectParam,
      counter_id: counterParam,
      csv: z.string().describe("CSV content with a header line"),
      client_id_type: z
        .enum(["USER_ID", "CLIENT_ID", "YCLID"])
        .describe("Which id column is used to match visitors"),
      comment: z.string().optional().describe("Comment shown in the uploadings list"),
      new_goal_name: z
        .string()
        .optional()
        .describe("Create a calls goal with this name if it does not exist yet (e.g. 'Звонок')"),
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to actually upload (default false = preview only)"),
    },
    async ({ project, counter_id, csv, client_id_type, comment, new_goal_name, confirm }) => {
      const counter = resolveCounter(project, counter_id);
      const lines = csv.trim().split("\n");
      const summary = { counter, client_id_type, header: lines[0], rows: Math.max(0, lines.length - 1) };
      if (!confirm) {
        return asText({
          preview: true,
          ...summary,
          note: "Not uploaded. Re-run with confirm:true to apply. Processing may take up to 2 hours.",
        });
      }
      const client = getClient(project);
      const data = await client.metrikaUpload(
        `/management/v1/counter/${counter}/offline_conversions/upload_calls`,
        { client_id_type, comment, new_goal_name },
        csv,
        "calls.csv"
      );
      return asText({ executed: true, ...summary, result: data });
    }
  );

  server.tool(
    "yandex_metrika_calls_uploadings",
    "List call uploads and their processing status (or one by uploading_id).",
    {
      project: projectParam,
      counter_id: counterParam,
      uploading_id: z.number().optional().describe("Specific uploading id to fetch"),
    },
    async ({ project, counter_id, uploading_id }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const path =
        uploading_id !== undefined
          ? `/management/v1/counter/${counter}/offline_conversions/calls_uploading/${uploading_id}`
          : `/management/v1/counter/${counter}/offline_conversions/calls_uploadings`;
      const data = await client.metrikaRequest("GET", path);
      return asText(data);
    }
  );
}
