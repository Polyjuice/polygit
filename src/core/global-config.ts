import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ============================================================================
// Types
// ============================================================================

export interface GlobalConfig {
  anthropic?: {
    apiKey?: string;
  };
}

// ============================================================================
// Paths
// ============================================================================

const GLOBAL_CONFIG_DIR = join(homedir(), ".polygit");
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, "config.json");

/**
 * Get the path to the global config directory
 */
export function getGlobalConfigDir(): string {
  return GLOBAL_CONFIG_DIR;
}

/**
 * Get the path to the global config file
 */
export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_FILE;
}

// ============================================================================
// Config I/O
// ============================================================================

/**
 * Read the global config from ~/.polygit/config.json
 */
export async function readGlobalConfig(): Promise<GlobalConfig> {
  try {
    const content = await readFile(GLOBAL_CONFIG_FILE, "utf-8");
    return JSON.parse(content) as GlobalConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

/**
 * Get the Anthropic API key from config or environment
 */
export async function getAnthropicApiKey(): Promise<string | null> {
  // First check environment variable
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return envKey;
  }

  // Then check global config
  const config = await readGlobalConfig();
  return config.anthropic?.apiKey ?? null;
}
