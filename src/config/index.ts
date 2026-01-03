import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

export interface Config {
  protected_paths: string[];
  scan_locations: string[];
  ignore_patterns: string[];
  max_delete_size_gb: number;
  dry_run: boolean;
}

const CONFIG_PATH = resolve(process.cwd(), "config.json");
const SAMPLE_CONFIG_PATH = resolve(process.cwd(), "config.sample.json");

export function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return path.replace("~", homedir());
  }
  return path;
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`Config file not found: ${CONFIG_PATH}`);
    console.error(`Please copy config.sample.json to config.json and adjust settings.`);
    console.error(`  cp ${SAMPLE_CONFIG_PATH} ${CONFIG_PATH}`);
    process.exit(1);
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const config: Config = JSON.parse(raw);

  // Expand ~ in paths
  config.protected_paths = config.protected_paths.map(expandPath);
  config.scan_locations = config.scan_locations.map(expandPath);

  return config;
}

export function isProtectedPath(path: string, config: Config): boolean {
  const normalizedPath = expandPath(path);
  return config.protected_paths.some(
    (protected_path) =>
      normalizedPath === protected_path ||
      normalizedPath.startsWith(protected_path + "/")
  );
}
