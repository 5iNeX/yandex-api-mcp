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

export function registerExpensesTools(server: McpServer): void {
  server.tool(
    "yandex_metrika_expenses_upload",
    "Upload ad expenses from non-Yandex sources (VK Ads, Telegram Ads, ...) so all-channel ROI lives in one place. Yandex Direct costs arrive automatically — never upload them. CSV columns: Date, UTMSource, UTMMedium?, UTMCampaign?, UTMTerm?, UTMContent?, Expenses, Currency?, Clicks?, Impressions?. Mutating: previews unless confirm:true.",
    {
      project: projectParam,
      counter_id: counterParam,
      csv: z
        .string()
        .describe("CSV content with a header line, e.g. 'Date,UTMSource,UTMCampaign,Expenses,Currency\\n2026-07-01,vk,promo,1500.50,RUB'"),
      provider: z.string().optional().describe("Data provider label shown in uploads list, e.g. 'vk_ads'"),
      comment: z.string().optional().describe("Comment for the upload"),
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to actually upload (default false = preview only)"),
    },
    async ({ project, counter_id, csv, provider, comment, confirm }) => {
      const counter = resolveCounter(project, counter_id);
      const lines = csv.trim().split("\n");
      const summary = { counter, provider, header: lines[0], rows: Math.max(0, lines.length - 1) };
      if (!confirm) {
        return asText({
          preview: true,
          ...summary,
          note: "Not uploaded. Re-run with confirm:true to apply. Do not upload Yandex Direct costs — they sync automatically.",
        });
      }
      const client = getClient(project);
      const data = await client.metrikaUpload(
        `/management/v1/counter/${counter}/expense/upload`,
        { provider, comment },
        csv,
        "expenses.csv"
      );
      return asText({ executed: true, ...summary, result: data });
    }
  );

  server.tool(
    "yandex_metrika_expenses_uploadings",
    "List expense uploads and their processing status (or one by uploading_id).",
    {
      project: projectParam,
      counter_id: counterParam,
      uploading_id: z.number().optional().describe("Specific uploading id to fetch"),
      limit: z.number().optional().describe("Max uploads to list"),
      offset: z.number().optional().describe("1-based offset"),
    },
    async ({ project, counter_id, uploading_id, limit, offset }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const path =
        uploading_id !== undefined
          ? `/management/v1/counter/${counter}/expense/uploading/${uploading_id}`
          : `/management/v1/counter/${counter}/expense/uploadings`;
      const data = await client.metrikaRequest("GET", path, {
        params: uploading_id !== undefined ? {} : { limit, offset },
      });
      return asText(data);
    }
  );
}
