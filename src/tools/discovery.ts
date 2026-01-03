import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { Config } from "../config/index.js";

export function registerDiscoveryTools(server: McpServer, config: Config) {
  // list_applications
  server.tool(
    "list_applications",
    "List installed applications with size and last opened date",
    {},
    async () => {
      try {
        const appDirs = ["/Applications", join(process.env.HOME || "", "Applications")];
        const apps: Array<{
          name: string;
          path: string;
          size: number | null;
          last_opened: string | null;
        }> = [];

        for (const dir of appDirs) {
          if (!existsSync(dir)) continue;

          const entries = readdirSync(dir).filter((name) => name.endsWith(".app"));

          for (const name of entries) {
            const appPath = join(dir, name);
            try {
              // Get size using du
              const duOutput = execSync(`du -sk "${appPath}" 2>/dev/null`, {
                encoding: "utf-8",
              });
              const size = parseInt(duOutput.split("\t")[0]) * 1024;

              // Get last opened using mdls (Spotlight metadata)
              let lastOpened: string | null = null;
              try {
                const mdlsOutput = execSync(
                  `mdls -name kMDItemLastUsedDate -raw "${appPath}" 2>/dev/null`,
                  { encoding: "utf-8" }
                );
                if (mdlsOutput && !mdlsOutput.includes("null")) {
                  lastOpened = new Date(mdlsOutput.trim()).toISOString();
                }
              } catch {
                // Spotlight metadata not available
              }

              apps.push({
                name: name.replace(".app", ""),
                path: appPath,
                size,
                last_opened: lastOpened,
              });
            } catch {
              apps.push({
                name: name.replace(".app", ""),
                path: appPath,
                size: null,
                last_opened: null,
              });
            }
          }
        }

        // Sort by size descending
        apps.sort((a, b) => (b.size || 0) - (a.size || 0));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, data: apps }, null, 2),
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
                code: "LIST_APPLICATIONS_FAILED",
              }),
            },
          ],
        };
      }
    }
  );

  // list_homebrew
  server.tool(
    "list_homebrew",
    "List Homebrew packages (formulas and casks)",
    {
      include_casks: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include casks in the list"),
    },
    async ({ include_casks }) => {
      try {
        // Check if Homebrew is installed
        try {
          execSync("which brew", { encoding: "utf-8" });
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: "Homebrew is not installed",
                  code: "HOMEBREW_NOT_FOUND",
                }),
              },
            ],
          };
        }

        const packages: Array<{
          name: string;
          type: "formula" | "cask";
          version: string;
        }> = [];

        // Get formulas
        const formulaOutput = execSync("brew list --formula --versions 2>/dev/null", {
          encoding: "utf-8",
        });
        for (const line of formulaOutput.trim().split("\n")) {
          if (!line) continue;
          const parts = line.split(" ");
          packages.push({
            name: parts[0],
            type: "formula",
            version: parts.slice(1).join(" "),
          });
        }

        // Get casks
        if (include_casks) {
          try {
            const caskOutput = execSync("brew list --cask --versions 2>/dev/null", {
              encoding: "utf-8",
            });
            for (const line of caskOutput.trim().split("\n")) {
              if (!line) continue;
              const parts = line.split(" ");
              packages.push({
                name: parts[0],
                type: "cask",
                version: parts.slice(1).join(" "),
              });
            }
          } catch {
            // No casks installed
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, data: packages }, null, 2),
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
                code: "LIST_HOMEBREW_FAILED",
              }),
            },
          ],
        };
      }
    }
  );

  // list_docker
  server.tool(
    "list_docker",
    "List Docker images, containers, and volumes",
    {
      resource_type: z
        .enum(["images", "containers", "volumes", "all"])
        .optional()
        .default("all")
        .describe("Type of Docker resources to list"),
    },
    async ({ resource_type }) => {
      try {
        // Check if Docker is available
        try {
          execSync("docker info 2>/dev/null", { encoding: "utf-8" });
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: "Docker is not running or not installed",
                  code: "DOCKER_NOT_AVAILABLE",
                }),
              },
            ],
          };
        }

        const result: {
          images?: Array<{ id: string; repository: string; tag: string; size: string; created: string }>;
          containers?: Array<{ id: string; name: string; image: string; status: string; size: string }>;
          volumes?: Array<{ name: string; driver: string; size: string | null }>;
        } = {};

        if (resource_type === "all" || resource_type === "images") {
          const output = execSync(
            'docker images --format "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedAt}}"',
            { encoding: "utf-8" }
          );
          result.images = output
            .trim()
            .split("\n")
            .filter((line) => line)
            .map((line) => {
              const [id, repository, tag, size, created] = line.split("|");
              return { id, repository, tag, size, created };
            });
        }

        if (resource_type === "all" || resource_type === "containers") {
          const output = execSync(
            'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Size}}"',
            { encoding: "utf-8" }
          );
          result.containers = output
            .trim()
            .split("\n")
            .filter((line) => line)
            .map((line) => {
              const [id, name, image, status, size] = line.split("|");
              return { id, name, image, status, size };
            });
        }

        if (resource_type === "all" || resource_type === "volumes") {
          const output = execSync('docker volume ls --format "{{.Name}}|{{.Driver}}"', {
            encoding: "utf-8",
          });
          result.volumes = output
            .trim()
            .split("\n")
            .filter((line) => line)
            .map((line) => {
              const [name, driver] = line.split("|");
              return { name, driver, size: null }; // Volume size requires inspection
            });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, data: result }, null, 2),
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
                code: "LIST_DOCKER_FAILED",
              }),
            },
          ],
        };
      }
    }
  );
}
