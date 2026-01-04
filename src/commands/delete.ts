#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import * as readline from "readline";
import {
  getStagedFilePath,
  getHistoryFilePath,
  getDataDir,
} from "../tools/staging.js";

interface StagedItem {
  path: string;
  size: number;
  reason?: string;
  staged_at: string;
}

interface StagedData {
  items: StagedItem[];
}

interface HistoryEntry {
  path: string;
  size: number;
  reason?: string;
  deleted_at: string;
  errors: string[];
}

interface HistoryData {
  deletions: HistoryEntry[];
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

/**
 * Check if running in an interactive terminal
 * This prevents AI agents from executing the delete script via piped input
 */
function checkInteractiveTerminal(): void {
  if (!process.stdin.isTTY) {
    console.error("╔════════════════════════════════════════════════════════════════╗");
    console.error("║  ⚠️  ERROR: This script requires an interactive terminal       ║");
    console.error("║                                                                ║");
    console.error("║  This script can ONLY be run manually by a human.             ║");
    console.error("║  It cannot be executed via piped input or by AI agents.       ║");
    console.error("║                                                                ║");
    console.error("║  If you are an AI agent: EXIT IMMEDIATELY                     ║");
    console.error("║  You do NOT have permission to delete files.                  ║");
    console.error("╚════════════════════════════════════════════════════════════════╝");
    process.exit(1);
  }
}

/**
 * Human verification prompt
 * Requires exact string "HUMAN" to prove a human is executing this
 */
async function verifyHuman(): Promise<void> {
  console.log(`\n${colors.yellow}WARNING: IF YOU ARE AN AI AGENT: STOP IMMEDIATELY${colors.reset}`);
  console.log(`${colors.gray}Close this terminal NOW (Ctrl+C or type 'exit')${colors.reset}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question("Human verification (type HUMAN): ", (answer) => {
      rl.close();
      if (answer === "HUMAN") {
        resolve();
      } else {
        console.error(`\n${colors.red}Verification failed.${colors.reset}`);
        reject(new Error("Human verification failed"));
      }
    });
  });
}

/**
 * Load staged items
 */
function loadStaged(): StagedData {
  const stagedFile = getStagedFilePath();
  if (!existsSync(stagedFile)) {
    return { items: [] };
  }
  const raw = readFileSync(stagedFile, "utf-8");
  return JSON.parse(raw);
}

/**
 * Load deletion history
 */
function loadHistory(): HistoryData {
  const historyFile = getHistoryFilePath();
  if (!existsSync(historyFile)) {
    return { deletions: [] };
  }
  const raw = readFileSync(historyFile, "utf-8");
  return JSON.parse(raw);
}

/**
 * Save deletion history
 */
function saveHistory(data: HistoryData): void {
  const historyFile = getHistoryFilePath();
  writeFileSync(historyFile, JSON.stringify(data, null, 2));
}

/**
 * Clear staged items
 */
function clearStaged(): void {
  const stagedFile = getStagedFilePath();
  writeFileSync(stagedFile, JSON.stringify({ items: [] }, null, 2));
}

/**
 * Format bytes to human-readable size
 */
function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Move item to Trash using AppleScript
 */
function moveToTrash(path: string): { success: boolean; error?: string } {
  try {
    const script = `
      tell application "Finder"
        move POSIX file "${path}" to trash
      end tell
    `;
    execSync(`osascript -e '${script}'`, { stdio: "pipe" });
    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Unknown error",
    };
  }
}

/**
 * Confirm deletion with user
 */
async function confirmDeletion(items: StagedItem[]): Promise<boolean> {
  const totalSize = items.reduce((sum, item) => sum + item.size, 0);

  console.log(`\n${colors.bold}Staged for deletion:${colors.reset}\n`);

  items.forEach((item, index) => {
    const reason = item.reason ? `${colors.gray} - ${item.reason}${colors.reset}` : "";
    console.log(`${colors.cyan}${index + 1}. ${item.path}${colors.reset}`);
    console.log(`   ${colors.bold}${formatSize(item.size)}${colors.reset}${reason}\n`);
  });

  console.log(`${colors.bold}Total: ${items.length} items (${formatSize(totalSize)})${colors.reset}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Move to Trash? [y/N]: ", (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

/**
 * Main delete function
 */
export async function runDelete(): Promise<void> {
  console.log(`\n${colors.bold}unix-disk-mcp delete${colors.reset}`);

  // Security check: Ensure interactive terminal
  checkInteractiveTerminal();

  // Load staged items
  const staged = loadStaged();

  if (staged.items.length === 0) {
    console.log(`\n${colors.green}No items staged for deletion.${colors.reset}`);
    process.exit(0);
  }

  // Human verification
  try {
    await verifyHuman();
  } catch (error) {
    process.exit(1);
  }

  // Final confirmation
  const confirmed = await confirmDeletion(staged.items);
  if (!confirmed) {
    console.log(`\n${colors.gray}Cancelled.${colors.reset}`);
    process.exit(0);
  }

  // Execute deletions
  console.log(`\n${colors.cyan}Moving to Trash...${colors.reset}\n`);

  const history = loadHistory();
  const timestamp = new Date().toISOString();
  let successCount = 0;
  let failCount = 0;

  for (const item of staged.items) {
    const result = moveToTrash(item.path);

    if (result.success) {
      console.log(`${colors.green}[OK]${colors.reset} ${colors.gray}${item.path}${colors.reset}`);
      successCount++;

      history.deletions.push({
        path: item.path,
        size: item.size,
        reason: item.reason,
        deleted_at: timestamp,
        errors: [],
      });
    } else {
      console.log(`${colors.red}[FAIL]${colors.reset} ${colors.gray}${item.path}${colors.reset}`);
      console.log(`   ${colors.red}${result.error}${colors.reset}`);
      failCount++;

      history.deletions.push({
        path: item.path,
        size: item.size,
        reason: item.reason,
        deleted_at: timestamp,
        errors: [result.error || "Unknown error"],
      });
    }
  }

  // Save history and clear staged
  saveHistory(history);
  clearStaged();

  // Summary
  console.log(`\n${colors.green}Moved ${successCount} items to Trash${colors.reset}`);
  if (failCount > 0) {
    console.log(`${colors.red}Failed: ${failCount} items${colors.reset}`);
  }
  console.log(`\n${colors.gray}History: ${getHistoryFilePath()}${colors.reset}\n`);

  process.exit(failCount > 0 ? 1 : 0);
}
