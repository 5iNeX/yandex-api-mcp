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
const confirmParam = z
  .boolean()
  .optional()
  .describe("Must be true to actually execute (default false = preview only)");

function preview(action: string, detail: unknown) {
  return asText({
    preview: true,
    action,
    detail,
    note: "Not executed. Re-run with confirm:true to apply.",
  });
}

export function registerGoalsWriteTools(server: McpServer): void {
  server.tool(
    "yandex_metrika_goal_add",
    "Create a goal on a Metrika counter. Mutating: previews unless confirm:true. Playbook reminder: optimize Direct on final funnel actions, never on button clicks; do not mix dependent goals in one campaign.",
    {
      project: projectParam,
      counter_id: counterParam,
      goal: z
        .record(z.string(), z.any())
        .describe(
          "Goal object, e.g. { name, type: 'url'|'action'|'step'|..., conditions: [{type:'contain'|'exact'|..., url}] }"
        ),
      confirm: confirmParam,
    },
    async ({ project, counter_id, goal, confirm }) => {
      const counter = resolveCounter(project, counter_id);
      if (!confirm) return preview("add goal", { counter, goal });
      const client = getClient(project);
      const data = await client.metrikaRequest("POST", `/management/v1/counter/${counter}/goals`, {
        body: { goal },
      });
      return asText({ executed: true, result: data });
    }
  );

  server.tool(
    "yandex_metrika_goal_update",
    "Update a goal on a Metrika counter. Mutating: previews unless confirm:true. Changing a goal used by a learning Direct campaign resets its training.",
    {
      project: projectParam,
      counter_id: counterParam,
      goal_id: z.number().describe("Goal id to update"),
      goal: z.record(z.string(), z.any()).describe("Full goal object to store"),
      confirm: confirmParam,
    },
    async ({ project, counter_id, goal_id, goal, confirm }) => {
      const counter = resolveCounter(project, counter_id);
      if (!confirm) return preview("update goal", { counter, goal_id, goal });
      const client = getClient(project);
      const data = await client.metrikaRequest(
        "PUT",
        `/management/v1/counter/${counter}/goal/${goal_id}`,
        { body: { goal } }
      );
      return asText({ executed: true, result: data });
    }
  );

  server.tool(
    "yandex_metrika_goal_delete",
    "Delete a goal from a Metrika counter. Mutating: previews unless confirm:true. Deleting a goal used by Direct campaigns breaks their optimization.",
    {
      project: projectParam,
      counter_id: counterParam,
      goal_id: z.number().describe("Goal id to delete"),
      confirm: confirmParam,
    },
    async ({ project, counter_id, goal_id, confirm }) => {
      const counter = resolveCounter(project, counter_id);
      if (!confirm) return preview("delete goal", { counter, goal_id });
      const client = getClient(project);
      const data = await client.metrikaRequest(
        "DELETE",
        `/management/v1/counter/${counter}/goal/${goal_id}`
      );
      return asText({ executed: true, result: data ?? { success: true } });
    }
  );
}
