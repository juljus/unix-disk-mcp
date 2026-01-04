import { readFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { homedir } from "os";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

export interface Config {
  protected_paths: string[];
  ignore_patterns: string[];
  max_delete_size_gb: number;
  dry_run: boolean;
}

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// XDG Base Directory paths
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const CONFIG_DIR = join(XDG_CONFIG_HOME, "macos-storage-mcp");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

// Get the directory where the package is installed (for config.sample.json)
function getPackageRoot(): string {
  // In development: src/config/index.ts -> project root is 2 levels up
  // In production: dist/config/index.js -> project root is 2 levels up
  return resolve(__dirname, "../..");
}

const SAMPLE_CONFIG_PATH = join(getPackageRoot(), "config.sample.json");

export function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return path.replace("~", homedir());
  }
  return path;
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!existsSync(CONFIG_PATH)) {
    // Copy sample config on first run
    if (existsSync(SAMPLE_CONFIG_PATH)) {
      copyFileSync(SAMPLE_CONFIG_PATH, CONFIG_PATH);
      console.error(`Created config file: ${CONFIG_PATH}`);
      console.error(`Please review and adjust settings, especially protected_paths.`);
    } else {
      console.error(`Config file not found: ${CONFIG_PATH}`);
      console.error(`Sample config not found: ${SAMPLE_CONFIG_PATH}`);
      console.error(`Please create a config file manually or run: macos-storage-mcp setup`);
      process.exit(1);
    }
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const config: Config = JSON.parse(raw);

  // Expand ~ in paths
  config.protected_paths = config.protected_paths.map(expandPath);

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

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
