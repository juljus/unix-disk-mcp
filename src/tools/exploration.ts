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
        let disk: any;
        
        if (process.platform === 'darwin') {
          // macOS: Use diskutil for accurate APFS container usage
          const diskutilOutput = execSync("diskutil info / | grep -E 'Volume Name|Container Total Space|Container Free Space'", { 
            encoding: "utf-8" 
          });
          
          const lines = diskutilOutput.trim().split("\n");
          const volumeName = lines[0]?.split(":")[1]?.trim() || "Unknown";
          
          // Parse container space - format: "494.4 GB (494384795648 Bytes) (exactly...)"
          const totalLine = lines[1]?.split(":")[1]?.trim() || "";
          const freeLine = lines[2]?.split(":")[1]?.trim() || "";
          
          // Extract human-readable values before the first parenthesis (e.g., "494.4 GB")
          const totalGB = totalLine.split("(")[0]?.trim() || "Unknown";
          const freeGB = freeLine.split("(")[0]?.trim() || "Unknown";
          
          // Extract bytes for calculations - inside first parenthesis
          const totalBytesMatch = totalLine.match(/\((\d+) Bytes\)/);
          const freeBytesMatch = freeLine.match(/\((\d+) Bytes\)/);
          
          const totalBytes = totalBytesMatch ? parseInt(totalBytesMatch[1]) : 0;
          const freeBytes = freeBytesMatch ? parseInt(freeBytesMatch[1]) : 0;
          const usedBytes = totalBytes - freeBytes;
          const percentUsed = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
          
          // Format used space
          const usedGB = (usedBytes / 1e9).toFixed(1) + " GB";

          disk = {
            volume: volumeName,
            total: totalGB,
            used: usedGB,
            available: freeGB,
            percent_used: `${percentUsed}%`,
            note: "APFS container usage (accurate)",
          };
        } else {
          // Linux: Use df
          const dfOutput = execSync("df -h / | tail -1", { encoding: "utf-8" });
          const parts = dfOutput.trim().split(/\s+/);
          
          disk = {
            filesystem: parts[0],
            total: parts[1],
            used: parts[2],
            available: parts[3],
            percent_used: parts[4],
            mounted: parts[5],
          };
        }

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
                    disk,
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
    "Find files and directories above a size threshold. WORKFLOW: (1) Start with max_depth=3 on home dir for overview, (2) Identify large branches (e.g., Library/Application Support/Steam), (3) Drill down into those specific paths with max_depth=5-8, (4) For final details, search specific subdirs with no depth limit. This progressive approach is fast and gives clear actionable results.",
    {
      path: z.string().describe("Path to search within"),
      min_size_mb: z.number().describe("Minimum size in megabytes"),
      max_depth: z
        .number()
        .optional()
        .describe("Maximum depth from this path. Start with 3 for overview, use 5-8 for branch exploration, omit for deep dive. REQUIRED for initial scans to avoid slow searches."),
      max_results: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum number of results to return"),
    },
    async ({ path, min_size_mb, max_depth, max_results }) => {
      try {
        const expandedPath = expandPath(path);

        // Find large files (no depth limit, but use timeout)
        const fileCmd = `timeout 30 find "${expandedPath}" -type f -size +${min_size_mb}M 2>/dev/null || true`;
        const fileOutput = execSync(fileCmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });

        const files = fileOutput
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .slice(0, max_results * 2) // Limit how many we stat
          .map((filePath) => {
            try {
              const stats = statSync(filePath);
              return { path: filePath, size: stats.size, type: "file" };
            } catch {
              return null;
            }
          })
          .filter((item) => item !== null);

        // Find large directories using du
        const minSizeKb = min_size_mb * 1024;
        const depthFlag = max_depth !== undefined ? `-d ${max_depth}` : `-a`;
        const dirCmd = `du ${depthFlag} -k "${expandedPath}" 2>/dev/null | awk '$1 > ${minSizeKb}' | sort -rn | head -${max_results * 2}`;
        const dirOutput = execSync(dirCmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 60000 });

        const dirs = dirOutput
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => {
            const parts = line.split("\t");
            if (parts.length === 2) {
              const size = parseInt(parts[0]) * 1024;
              const itemPath = parts[1];
              // Check if it's a directory
              try {
                const stats = statSync(itemPath);
                if (stats.isDirectory()) {
                  return { path: itemPath, size, type: "directory" };
                }
              } catch {}
            }
            return null;
          })
          .filter((item) => item !== null);

        // Filter out parent directories - only keep leaves or items without children in results
        const filteredDirs = dirs.filter((dir) => {
          // Check if any other directory in the list is a child of this one
          const hasChildInList = dirs.some(
            (other) => other !== dir && other!.path.startsWith(dir!.path + "/")
          );
          return !hasChildInList;
        });

        // Combine and sort by size
        const items = [...files, ...filteredDirs]
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
