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
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    HUMAN VERIFICATION                          ║");
  console.log("║                                                                ║");
  console.log("║  This is a MANUAL deletion script.                            ║");
  console.log("║  AI agents should NEVER reach this point.                     ║");
  console.log("║                                                                ║");
  console.log("║  Type exactly: HUMAN                                          ║");
  console.log("║  (case-sensitive, then press Enter)                           ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question("\nVerification: ", (answer) => {
      rl.close();
      if (answer === "HUMAN") {
        resolve();
      } else {
        console.error("\n❌ Verification failed. Exiting.");
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

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    STAGED FOR DELETION                         ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  items.forEach((item, index) => {
    console.log(`${index + 1}. ${item.path}`);
    console.log(`   Size: ${formatSize(item.size)}`);
    if (item.reason) {
      console.log(`   Reason: ${item.reason}`);
    }
    console.log("");
  });

  console.log(`Total: ${items.length} items (${formatSize(totalSize)})\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Move these items to Trash? [y/N]: ", (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

/**
 * Main delete function
 */
export async function runDelete(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║          macOS Storage MCP - Manual Deletion Script           ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  // Security check: Ensure interactive terminal
  checkInteractiveTerminal();

  // Load staged items
  const staged = loadStaged();

  if (staged.items.length === 0) {
    console.log("\n✅ No items staged for deletion.");
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
    console.log("\n❌ Deletion cancelled.");
    process.exit(0);
  }

  // Execute deletions
  console.log("\n🗑️  Moving items to Trash...\n");

  const history = loadHistory();
  const timestamp = new Date().toISOString();
  let successCount = 0;
  let failCount = 0;

  for (const item of staged.items) {
    const result = moveToTrash(item.path);

    if (result.success) {
      console.log(`✅ ${item.path}`);
      successCount++;

      history.deletions.push({
        path: item.path,
        size: item.size,
        reason: item.reason,
        deleted_at: timestamp,
        errors: [],
      });
    } else {
      console.log(`❌ ${item.path}`);
      console.log(`   Error: ${result.error}`);
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
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                         SUMMARY                                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`✅ Successfully moved: ${successCount} items`);
  if (failCount > 0) {
    console.log(`❌ Failed: ${failCount} items`);
  }
  console.log(`\n📝 History saved to: ${getHistoryFilePath()}\n`);

  process.exit(failCount > 0 ? 1 : 0);
}
