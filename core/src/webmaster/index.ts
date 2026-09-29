import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerUserTools } from "./user.js";
import { registerHostsTools } from "./hosts.js";
import { registerVerificationTools } from "./verification.js";
import { registerSummaryTools } from "./summary.js";
import { registerSearchQueriesTools } from "./search-queries.js";
import { registerIndexingTools } from "./indexing.js";
import { registerSearchUrlsTools } from "./search-urls.js";
import { registerImportantUrlsTools } from "./important-urls.js";
import { registerSitemapsTools } from "./sitemaps.js";
import { registerRecrawlTools } from "./recrawl.js";
import { registerDiagnosticsTools } from "./diagnostics.js";
import { registerLinksTools } from "./links.js";
import { registerProExportTools } from "./pro-export.js";
import { registerFeedsTools } from "./feeds.js";

export function registerWebmasterTools(server: McpServer): void {
  registerUserTools(server);
  registerHostsTools(server);
  registerVerificationTools(server);
  registerSummaryTools(server);
  registerSearchQueriesTools(server);
  registerIndexingTools(server);
  registerSearchUrlsTools(server);
  registerImportantUrlsTools(server);
  registerSitemapsTools(server);
  registerRecrawlTools(server);
  registerDiagnosticsTools(server);
  registerLinksTools(server);
  registerProExportTools(server);
  registerFeedsTools(server);
}
