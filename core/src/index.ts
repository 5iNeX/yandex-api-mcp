#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initRegistry } from "./client.js";
import { registerServerTools } from "./server-tools.js";
import { registerWebmasterTools } from "./webmaster/index.js";
import { registerMetrikaTools } from "./metrika/index.js";
import { registerDirectTools } from "./direct/index.js";
import { registerPrompts } from "./prompts.js";

async function main(): Promise<void> {
  try {
    initRegistry();
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const server = new McpServer({ name: "yandex-api-mcp-core", version: "0.1.0" });

  registerServerTools(server);
  registerWebmasterTools(server);
  registerMetrikaTools(server);
  registerDirectTools(server);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Yandex API MCP core v0.1.0 started");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
