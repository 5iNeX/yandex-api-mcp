import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRegistry } from "./client.js";

export function registerServerTools(server: McpServer): void {
  server.tool(
    "yandex_projects_list",
    "List configured projects and which one is active. No secrets are returned.",
    {},
    async () => {
      const reg = getRegistry();
      const data = { active: reg.active, projects: reg.list() };
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "yandex_set_active_project",
    "Set the active project used by tools that do not specify a 'project' parameter.",
    { project: z.string().describe("Project id to activate") },
    async ({ project }) => {
      const reg = getRegistry();
      reg.setActive(project);
      return { content: [{ type: "text" as const, text: `Active project: ${reg.active}` }] };
    }
  );
}
