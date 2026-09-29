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

export function registerManagementTools(server: McpServer): void {
  server.tool(
    "yandex_metrika_counters_list",
    "List Metrika counters available to the token.",
    {
      project: projectParam,
      search_string: z.string().optional().describe("Filter counters by site/name substring"),
    },
    async ({ project, search_string }) => {
      const client = getClient(project);
      const data = await client.metrikaRequest("GET", "/management/v1/counters", {
        params: { search_string },
      });
      return asText(data);
    }
  );

  server.tool(
    "yandex_metrika_counter_get",
    "Get a Metrika counter's settings.",
    { project: projectParam, counter_id: counterParam },
    async ({ project, counter_id }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const data = await client.metrikaRequest("GET", `/management/v1/counter/${counter}`);
      return asText(data);
    }
  );

  server.tool(
    "yandex_metrika_goals_list",
    "List goals configured on a Metrika counter.",
    { project: projectParam, counter_id: counterParam },
    async ({ project, counter_id }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const data = await client.metrikaRequest("GET", `/management/v1/counter/${counter}/goals`);
      return asText(data);
    }
  );

  server.tool(
    "yandex_metrika_segments_list",
    "List API segments saved on a Metrika counter.",
    { project: projectParam, counter_id: counterParam },
    async ({ project, counter_id }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const data = await client.metrikaRequest(
        "GET",
        `/management/v1/counter/${counter}/apisegment/segments`
      );
      return asText(data);
    }
  );

  server.tool(
    "yandex_metrika_filters_list",
    "List filters configured on a Metrika counter.",
    { project: projectParam, counter_id: counterParam },
    async ({ project, counter_id }) => {
      const counter = resolveCounter(project, counter_id);
      const client = getClient(project);
      const data = await client.metrikaRequest("GET", `/management/v1/counter/${counter}/filters`);
      return asText(data);
    }
  );
}
