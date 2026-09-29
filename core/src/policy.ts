import { readFileSync } from "node:fs";

export function publicReadOnly(): boolean {
  try { if (readFileSync("/app/.mcp_edition", "utf8").trim() === "public") return true; } catch {}
  return process.env.MCP_PUBLIC_READONLY !== "false" || process.env.MCP_EDITION !== "pro";
}

export function assertWriteAllowed(operation: string): void {
  if (publicReadOnly()) throw new Error(`Write operation disabled by public/read-only policy: ${operation}`);
}
