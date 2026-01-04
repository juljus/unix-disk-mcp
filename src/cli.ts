#!/usr/bin/env node

/**
 * Main entry point for macos-storage-mcp CLI
 * Routes commands to appropriate handlers
 */

const command = process.argv[2];

async function main() {
  switch (command) {
    case undefined:
    case "server":
      // Start MCP server (default)
      await import("./index.js");
      break;

    case "setup":
      // Run setup wizard
      const { runSetup } = await import("./commands/setup.js");
      await runSetup();
      break;

    case "delete":
      // Execute staged deletions
      const { runDelete } = await import("./commands/delete.js");
      await runDelete();
      break;

    case "config":
      // Show config location
      const { getConfigPath } = await import("./config/index.js");
      console.log(getConfigPath());
      break;

    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
macos-storage-mcp - AI-assisted disk cleanup for macOS

Usage:
  macos-storage-mcp [command]

Commands:
  server      Start MCP server (default)
  setup       Run interactive setup wizard
  delete      Execute staged deletions (manual, with confirmation)
  config      Show config file location
  help        Show this help message

Examples:
  macos-storage-mcp              # Start server
  macos-storage-mcp setup        # Configure protected paths
  macos-storage-mcp delete       # Delete staged items
  macos-storage-mcp config       # Show config location
  `);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
