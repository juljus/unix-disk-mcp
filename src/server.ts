import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Config } from "./config/index.js";
import { registerExplorationTools } from "./tools/exploration.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerStagingTools } from "./tools/staging.js";

export function createServer(config: Config): McpServer {
  const server = new McpServer({
    name: "unix-disk-mcp",
    version: "0.4.0",
    description: "AI-assisted disk cleanup for Unix systems. **Recommended workflow:** 1) Start with get_disk_usage for overview 2) Use search_files or find_large_items to identify targets 3) Stage items for deletion 4) User executes deletion manually. You can explore but never delete files.",
  });

  // Register all tools
  registerExplorationTools(server, config);
  registerDiscoveryTools(server, config);
  registerStagingTools(server, config);

  return server;
}
