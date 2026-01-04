import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Config } from "./config/index.js";
import { registerExplorationTools } from "./tools/exploration.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerStagingTools } from "./tools/staging.js";

export function createServer(config: Config): McpServer {
  const server = new McpServer({
    name: "unix-disk-mcp",
    version: "0.1.0",
  });

  // Register all tools
  registerExplorationTools(server, config);
  registerDiscoveryTools(server, config);
  registerStagingTools(server, config);

  return server;
}
