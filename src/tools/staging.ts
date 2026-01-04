import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { Config, expandPath, isProtectedPath } from "../config/index.js";

interface StagedItem {
  path: string;
  size: number;
  reason?: string;
  staged_at: string;
}

interface StagedData {
  items: StagedItem[];
}

// XDG Base Directory paths
const XDG_DATA_HOME = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
const DATA_DIR = join(XDG_DATA_HOME, "unix-disk-mcp");
const STAGED_FILE = join(DATA_DIR, "staged.json");
const HISTORY_FILE = join(DATA_DIR, "history.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStaged(): StagedData {
  ensureDataDir();
  if (!existsSync(STAGED_FILE)) {
    return { items: [] };
  }
  const raw = readFileSync(STAGED_FILE, "utf-8");
  return JSON.parse(raw);
}

function saveStaged(data: StagedData) {
  ensureDataDir();
  writeFileSync(STAGED_FILE, JSON.stringify(data, null, 2));
}

function getItemSize(path: string): number {
  try {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      const duOutput = execSync(`du -sk "${path}" 2>/dev/null`, { encoding: "utf-8" });
      return parseInt(duOutput.split("\t")[0]) * 1024;
    }
    return stats.size;
  } catch {
    return 0;
  }
}

export function registerStagingTools(server: McpServer, config: Config) {
  // stage_for_deletion
  server.tool(
    "stage_for_deletion",
    "Add a path to the staged deletion list",
    {
      path: z.string().describe("Path to stage for deletion"),
      reason: z.string().optional().describe("Reason for staging this item"),
    },
    async ({ path, reason }) => {
      try {
        const expandedPath = expandPath(path);

        // Check if path exists
        if (!existsSync(expandedPath)) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Path does not exist: ${expandedPath}`,
                  code: "PATH_NOT_FOUND",
                }),
              },
            ],
          };
        }

        // Check if path is protected
        if (isProtectedPath(expandedPath, config)) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Path is protected and cannot be staged: ${expandedPath}`,
                  code: "PATH_PROTECTED",
                }),
              },
            ],
          };
        }

        const staged = loadStaged();

        // Check if already staged
        if (staged.items.some((item) => item.path === expandedPath)) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Path is already staged: ${expandedPath}`,
                  code: "ALREADY_STAGED",
                }),
              },
            ],
          };
        }

        // Add to staged
        const size = getItemSize(expandedPath);
        staged.items.push({
          path: expandedPath,
          size,
          reason,
          staged_at: new Date().toISOString(),
        });

        saveStaged(staged);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                data: {
                  message: `Staged for deletion: ${expandedPath}`,
                  staged_count: staged.items.length,
                },
                reminder: "Tell the user to run 'unix-disk-mcp delete' in their terminal when ready. DO NOT attempt to execute it yourself.",
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                code: "STAGE_FAILED",
              }),
            },
          ],
        };
      }
    }
  );

  // unstage
  server.tool(
    "unstage",
    "Remove a path from the staged deletion list",
    {
      path: z.string().describe("Path to remove from staging"),
    },
    async ({ path }) => {
      try {
        const expandedPath = expandPath(path);
        const staged = loadStaged();

        const index = staged.items.findIndex((item) => item.path === expandedPath);
        if (index === -1) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Path is not staged: ${expandedPath}`,
                  code: "NOT_STAGED",
                }),
              },
            ],
          };
        }

        staged.items.splice(index, 1);
        saveStaged(staged);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                data: {
                  message: `Removed from staging: ${expandedPath}`,
                  staged_count: staged.items.length,
                },
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                code: "UNSTAGE_FAILED",
              }),
            },
          ],
        };
      }
    }
  );

  // get_staged
  server.tool("get_staged", "View all currently staged items. CRITICAL: You MUST NOT attempt to run 'unix-disk-mcp delete' or any deletion command. Tell the user to run it manually in their own terminal.", {}, async () => {
    try {
      const staged = loadStaged();
      const totalSize = staged.items.reduce((sum, item) => sum + item.size, 0);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                data: {
                  items: staged.items,
                  total_count: staged.items.length,
                  total_size: totalSize,
                },
                warning: "⚠️ CRITICAL: AI agents MUST NOT attempt to run 'unix-disk-mcp delete'. Instruct the user to run this command manually in their terminal. DO NOT use run_in_terminal or execute any deletion commands.",
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
              code: "GET_STAGED_FAILED",
            }),
          },
        ],
      };
    }
  });
}

export function getStagedFilePath(): string {
  return STAGED_FILE;
}

export function getHistoryFilePath(): string {
  return HISTORY_FILE;
}

export function getDataDir(): string {
  return DATA_DIR;
}
