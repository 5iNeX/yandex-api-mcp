import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerDirectReportTools(server: McpServer): void {
  server.tool(
    "yandex_direct_report",
    "Run a Direct statistics report (Reports service, TSV). Returns the report text or a pending status.",
    {
      project: z.string().optional().describe("Project id (defaults to the active project)"),
      report: z
        .record(z.string(), z.any())
        .describe(
          "ReportDefinition params, e.g. { SelectionCriteria, FieldNames, ReportName, ReportType, DateRangeType, Format:'TSV', IncludeVAT:'NO' }"
        ),
      max_polls: z.number().optional().describe("Max poll attempts if the report is queued (default 5)"),
    },
    async ({ project, report, max_polls }) => {
      const client = getClient(project);
      const body = { params: report };
      const limit = max_polls ?? 5;
      let attempt = 0;
      while (true) {
        const res = await client.directReport(body);
        if (res.status === 200) {
          return { content: [{ type: "text" as const, text: res.text }] };
        }
        // 201 — queued for offline build; 202 — still building. Anything else
        // (incl. 400 offline-queue overflow) falls through and is returned as-is.
        if ((res.status === 201 || res.status === 202) && attempt < limit) {
          attempt += 1;
          const waitMs = (res.retryIn ?? 5) * 1000;
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        return {
          isError: res.status >= 400,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { status: res.status, pending: res.status === 201 || res.status === 202, body: res.text },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
}
