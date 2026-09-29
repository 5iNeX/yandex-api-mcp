import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerManagementTools } from "./management.js";
import { registerReportTools } from "./reports.js";
import { registerGoalsWriteTools } from "./goals-write.js";
import { registerOfflineConversionTools } from "./offline-conversions.js";
import { registerLogsTools } from "./logs.js";
import { registerExpensesTools } from "./expenses.js";
import { registerCrmTools } from "./crm.js";

export function registerMetrikaTools(server: McpServer): void {
  registerManagementTools(server);
  registerReportTools(server);
  registerGoalsWriteTools(server);
  registerOfflineConversionTools(server);
  registerLogsTools(server);
  registerExpensesTools(server);
  registerCrmTools(server);
}
