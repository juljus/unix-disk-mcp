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
    "Get overview of disk space usage. **Use this first** when exploring disk usage to understand which filesystems/volumes need attention and get a breakdown of home directory space.",
    {},
    async () => {
      try {
        let disk: any;
        
        if (process.platform === 'darwin') {
          // macOS: Use df to get relevant volumes, plus diskutil for container info
          const dfOutput = execSync(
            "df -k | awk '$9==\"/\" || $9==\"/System/Volumes/Data\" || $9~/^\\/Volumes\\// {print}'",
            { encoding: "utf-8" }
          );
          
          const dfLines = dfOutput.trim().split("\n");
          const disks = dfLines.map((line) => {
            const parts = line.trim().split(/\s+/);
            const totalBytes = parseInt(parts[1]) * 1024 || 0;
            const usedBytes = parseInt(parts[2]) * 1024 || 0;
            const availableBytes = parseInt(parts[3]) * 1024 || 0;
            const percentUsed = Math.round((usedBytes / totalBytes) * 100) || 0;
            
            return {
              filesystem: parts[0],
              total_bytes: totalBytes,
              used_bytes: usedBytes,
              available_bytes: availableBytes,
              percent_used: percentUsed,
              mounted_on: parts[8],
            };
          });
          
          // Add container summary for context
          try {
            const diskutilOutput = execSync(
              "diskutil info / | grep -E 'Container Total Space|Container Free Space'",
              { encoding: "utf-8" }
            );
            const lines = diskutilOutput.trim().split("\n");
            const totalLine = lines[0]?.split(":")[1]?.trim() || "";
            const freeLine = lines[1]?.split(":")[1]?.trim() || "";
            
            const totalBytesMatch = totalLine.match(/\((\d+) Bytes\)/);
            const freeBytesMatch = freeLine.match(/\((\d+) Bytes\)/);
            
            const containerTotal = totalBytesMatch ? parseInt(totalBytesMatch[1]) : 0;
            const containerFree = freeBytesMatch ? parseInt(freeBytesMatch[1]) : 0;
            const containerUsed = containerTotal - containerFree;
            
            disk = {
              volumes: disks,
              apfs_container: {
                total_bytes: containerTotal,
                used_bytes: containerUsed,
                available_bytes: containerFree,
                percent_used: Math.round((containerUsed / containerTotal) * 100),
                note: "Shared APFS container space - volumes dynamically allocate from this",
              },
            };
          } catch {
            // If diskutil fails, just return volumes
            disk = disks;
          }
        } else {
          // Linux: Use df to get all relevant filesystems
          const dfOutput = execSync(
            "df -B1 | awk 'NR==1 || $6==\"/\" || $6==\"/home\" || $6~/^\\/mnt\\// || $6~/^\\/media\\//'",
            { encoding: "utf-8" }
          );
          
          const lines = dfOutput.trim().split("\n");
          const disks = lines.slice(1).map((line) => {
            const parts = line.trim().split(/\s+/);
            const totalBytes = parseInt(parts[1]) || 0;
            const usedBytes = parseInt(parts[2]) || 0;
            const availableBytes = parseInt(parts[3]) || 0;
            const percentUsed = Math.round((usedBytes / totalBytes) * 100) || 0;
            
            return {
              filesystem: parts[0],
              total_bytes: totalBytes,
              used_bytes: usedBytes,
              available_bytes: availableBytes,
              percent_used: percentUsed,
              mounted_on: parts[5],
            };
          });
          
          disk = disks;
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

  // search_files
  server.tool(
    "search_files",
    "Search for files and directories by name pattern. Use this to find all instances of an app, package, or file type across the system.",
    {
      query: z.string().describe("Search query - can be exact name or pattern (e.g., 'Anki', 'node_modules', '*.mp4')"),
      search_path: z.string().optional().describe("Starting directory (defaults to home directory)"),
      max_results: z.number().optional().default(50).describe("Maximum number of results to return"),
    },
    async ({ query, search_path, max_results }) => {
      try {
        const startPath = search_path ? expandPath(search_path) : homedir();
        let results: string[] = [];

        if (process.platform === 'darwin') {
          // macOS: Use mdfind (Spotlight) for fast searching
          try {
            const mdfindCmd = search_path 
              ? `mdfind -onlyin "${startPath}" -name "${query}"`
              : `mdfind -name "${query}"`;
            
            const output = execSync(mdfindCmd, { 
              encoding: "utf-8",
              maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            });
            results = output.trim().split("\n").filter(Boolean);
          } catch (error) {
            // Fall back to find if mdfind fails
            const findCmd = `find "${startPath}" -iname "*${query}*" 2>/dev/null`;
            const output = execSync(findCmd, { 
              encoding: "utf-8",
              maxBuffer: 10 * 1024 * 1024,
            });
            results = output.trim().split("\n").filter(Boolean);
          }
        } else {
          // Linux: Use find
          const findCmd = `find "${startPath}" -iname "*${query}*" 2>/dev/null`;
          const output = execSync(findCmd, { 
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
          });
          results = output.trim().split("\n").filter(Boolean);
        }

        // Limit results and get sizes
        const limitedResults = results.slice(0, max_results);
        const items = limitedResults.map(path => {
          try {
            const stats = statSync(path);
            return {
              path,
              type: stats.isDirectory() ? "directory" : "file",
              size: stats.size,
              modified: stats.mtime.toISOString(),
            };
          } catch {
            return {
              path,
              type: "unknown",
              size: 0,
              error: "Could not read stats",
            };
          }
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  data: {
                    query,
                    total_found: results.length,
                    returned: items.length,
                    items,
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
                code: "SEARCH_FILES_FAILED",
              }),
            },
          ],
        };
      }
    }
  );
}
