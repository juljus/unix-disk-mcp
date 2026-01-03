import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { homedir } from "os";
import { Config, expandPath } from "../config/index.js";

export function registerExplorationTools(server: McpServer, config: Config) {
  // list_directory
  server.tool(
    "list_directory",
    "List contents of a directory with file sizes and dates",
    {
      path: z.string().describe("Absolute path to the directory"),
      show_hidden: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include hidden files (starting with .)"),
    },
    async ({ path, show_hidden }) => {
      try {
        const expandedPath = expandPath(path);
        const entries = readdirSync(expandedPath, { withFileTypes: true });

        const items = entries
          .filter((entry) => show_hidden || !entry.name.startsWith("."))
          .map((entry) => {
            const fullPath = join(expandedPath, entry.name);
            try {
              const stats = statSync(fullPath);
              return {
                name: entry.name,
                type: entry.isDirectory() ? "directory" : "file",
                size: entry.isFile() ? stats.size : null,
                modified: stats.mtime.toISOString(),
                accessed: stats.atime.toISOString(),
              };
            } catch {
              return {
                name: entry.name,
                type: entry.isDirectory() ? "directory" : "file",
                size: null,
                modified: null,
                accessed: null,
                error: "Could not read stats",
              };
            }
          });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, data: items }, null, 2),
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
                code: "LIST_DIRECTORY_FAILED",
              }),
            },
          ],
        };
      }
    }
  );

  // get_disk_usage
  server.tool(
    "get_disk_usage",
    "Get overview of disk space usage",
    {},
    async () => {
      try {
        // Get overall disk usage
        const dfOutput = execSync("df -h /", { encoding: "utf-8" });
        const dfLines = dfOutput.trim().split("\n");
        const dfParts = dfLines[1].split(/\s+/);

        // Get home directory breakdown
        const home = homedir();
        const entries = readdirSync(home, { withFileTypes: true });

        const breakdown = entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .slice(0, 15) // Limit to avoid too many du calls
          .map((entry) => {
            const fullPath = join(home, entry.name);
            try {
              const duOutput = execSync(`du -sk "${fullPath}" 2>/dev/null || echo "0 ${fullPath}"`, {
                encoding: "utf-8",
              });
              const size = parseInt(duOutput.split("\t")[0]) * 1024;
              return { path: fullPath, size };
            } catch {
              return { path: fullPath, size: 0, error: "Could not calculate size" };
            }
          })
          .sort((a, b) => b.size - a.size);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  data: {
                    disk: {
                      filesystem: dfParts[0],
                      total: dfParts[1],
                      used: dfParts[2],
                      available: dfParts[3],
                      percent_used: dfParts[4],
                    },
                    home_breakdown: breakdown,
                  },
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
                code: "DISK_USAGE_FAILED",
              }),
            },
          ],
        };
      }
    }
  );

  // find_large_items
  server.tool(
    "find_large_items",
    "Find files and directories above a size threshold",
    {
      path: z.string().describe("Path to search within"),
      min_size_mb: z.number().describe("Minimum size in megabytes"),
      max_results: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum number of results to return"),
    },
    async ({ path, min_size_mb, max_results }) => {
      try {
        const expandedPath = expandPath(path);
        const minSizeKb = min_size_mb * 1024;

        // Use find + du to get large items
        const cmd = `find "${expandedPath}" -maxdepth 3 -type f -size +${min_size_mb}M 2>/dev/null | head -${max_results * 2}`;
        const output = execSync(cmd, { encoding: "utf-8" });

        const items = output
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .map((filePath) => {
            try {
              const stats = statSync(filePath);
              return { path: filePath, size: stats.size };
            } catch {
              return null;
            }
          })
          .filter((item) => item !== null)
          .sort((a, b) => b!.size - a!.size)
          .slice(0, max_results);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, data: items }, null, 2),
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
                code: "FIND_LARGE_ITEMS_FAILED",
              }),
            },
          ],
        };
      }
    }
  );

  // get_item_info
  server.tool(
    "get_item_info",
    "Get detailed information about a file or directory",
    {
      path: z.string().describe("Path to the file or directory"),
    },
    async ({ path }) => {
      try {
        const expandedPath = expandPath(path);
        const stats = statSync(expandedPath);
        const isDirectory = stats.isDirectory();

        let size = stats.size;
        if (isDirectory) {
          // Calculate directory size
          const duOutput = execSync(`du -sk "${expandedPath}" 2>/dev/null`, {
            encoding: "utf-8",
          });
          size = parseInt(duOutput.split("\t")[0]) * 1024;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  data: {
                    path: expandedPath,
                    type: isDirectory ? "directory" : "file",
                    size,
                    modified: stats.mtime.toISOString(),
                    accessed: stats.atime.toISOString(),
                    created: stats.birthtime.toISOString(),
                  },
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
                code: "GET_ITEM_INFO_FAILED",
              }),
            },
          ],
        };
      }
    }
  );
}
