#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import * as readline from "readline";
import { getConfigPath, getConfigDir } from "../config/index.js";

interface Config {
  protected_paths: string[];
}

const DEFAULT_PROTECTED_PATHS = [
  "/System",
  "/Library",
  "~/.ssh",
  "~/.gnupg",
];

const MCP_CONFIGS = {
  vscode: {
    name: "VS Code",
    path: join(
      homedir(),
      "Library",
      "Application Support",
      "Code",
      "User",
      "mcp.json"
    ),
  },
  claude: {
    name: "Claude Desktop",
    path: join(
      homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json"
    ),
  },
};

/**
 * Create readline interface for user input
 */
function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Ask a question and return the answer
 */
function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Print welcome banner
 */
function printBanner() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║        macOS Storage MCP - Setup Wizard                       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
}

/**
 * Configure protected paths
 */
async function configureProtectedPaths(
  rl: readline.Interface
): Promise<string[]> {
  console.log("\n📁 Protected Paths Configuration\n");
  console.log(
    "Protected paths cannot be deleted by AI. These are recursive (includes subdirectories).\n"
  );
  console.log("Default protected paths:");
  DEFAULT_PROTECTED_PATHS.forEach((path, i) => {
    console.log(`  ${i + 1}. ${path}`);
  });

  const answer = await ask(
    rl,
    "\nUse default protected paths? [Y/n]: "
  );

  if (answer.toLowerCase() === "n") {
    console.log(
      "\nEnter protected paths (one per line, empty line to finish):"
    );
    const paths: string[] = [];
    while (true) {
      const path = await ask(rl, "Path: ");
      if (!path.trim()) break;
      paths.push(path.trim());
    }
    return paths.length > 0 ? paths : DEFAULT_PROTECTED_PATHS;
  }

  return DEFAULT_PROTECTED_PATHS;
}

/**
 * Select MCP client to configure
 */
async function selectMCPClient(
  rl: readline.Interface
): Promise<"vscode" | "claude" | "both" | "none"> {
  console.log("\n🔧 MCP Client Configuration\n");
  console.log("Which MCP client would you like to configure?\n");
  console.log("  1. VS Code (Roo Cline)");
  console.log("  2. Claude Desktop");
  console.log("  3. Both");
  console.log("  4. None (manual configuration)\n");

  const answer = await ask(rl, "Select [1-4]: ");

  switch (answer.trim()) {
    case "1":
      return "vscode";
    case "2":
      return "claude";
    case "3":
      return "both";
    case "4":
    default:
      return "none";
  }
}

/**
 * Update MCP client config
 */
function updateMCPConfig(
  client: "vscode" | "claude",
  configPath: string
): boolean {
  const config = MCP_CONFIGS[client];

  if (!existsSync(config.path)) {
    console.log(`❌ ${config.name} config not found at: ${config.path}`);
    return false;
  }

  try {
    const raw = readFileSync(config.path, "utf-8");
    const data = JSON.parse(raw);

    if (client === "vscode") {
      // VS Code MCP config format
      if (!data.servers) {
        data.servers = {};
      }
      data.servers["macos-storage-mcp"] = {
        type: "stdio",
        command: "macos-storage-mcp",
      };
    } else {
      // Claude Desktop config format
      if (!data.mcpServers) {
        data.mcpServers = {};
      }
      data.mcpServers["macos-storage-mcp"] = {
        command: "macos-storage-mcp",
        args: [],
      };
    }

    writeFileSync(config.path, JSON.stringify(data, null, 2));
    console.log(`✅ Updated ${config.name} config`);
    return true;
  } catch (error: any) {
    console.log(`❌ Failed to update ${config.name} config: ${error.message}`);
    return false;
  }
}

/**
 * Save configuration
 */
function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const configDir = getConfigDir();
  
  // Ensure config directory exists
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n✅ Configuration saved to: ${configPath}`);
}

/**
 * Print manual configuration instructions
 */
function printManualInstructions() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                Manual Configuration                            ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("Add this to your MCP client configuration:\n");
  console.log(JSON.stringify({
    "macos-storage-mcp": {
      command: "macos-storage-mcp",
      args: [],
    },
  }, null, 2));

  console.log("\n\nVS Code (Roo Cline):");
  console.log(`  ${MCP_CONFIGS.vscode.path}\n`);

  console.log("Claude Desktop:");
  console.log(`  ${MCP_CONFIGS.claude.path}\n`);
}

/**
 * Main setup function
 */
export async function runSetup(): Promise<void> {
  printBanner();

  const rl = createInterface();

  try {
    // Configure protected paths
    const protectedPaths = await configureProtectedPaths(rl);

    // Save config
    const config: Config = {
      protected_paths: protectedPaths,
    };
    saveConfig(config);

    // Select and configure MCP client
    const client = await selectMCPClient(rl);

    if (client === "none") {
      printManualInstructions();
    } else {
      if (client === "vscode" || client === "both") {
        updateMCPConfig("vscode", getConfigPath());
      }
      if (client === "claude" || client === "both") {
        updateMCPConfig("claude", getConfigPath());
      }

      console.log("\n✅ Setup complete! Restart your MCP client to use the server.\n");
    }
  } finally {
    rl.close();
  }
}
