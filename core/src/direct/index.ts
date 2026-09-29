import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDirectReadTools } from "./read.js";
import { registerDirectWriteTools } from "./write.js";
import { registerDirectReportTools } from "./reports.js";

export function registerDirectTools(server: McpServer): void {
  registerDirectReadTools(server);
  registerDirectWriteTools(server);
  registerDirectReportTools(server);
}
