import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Get the project root by going up from tests/helpers/
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");
const POLYGIT_BIN = join(PROJECT_ROOT, ".dist/index.js");

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute the polygit CLI with given arguments
 */
export async function polygit(
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    timeout?: number;
  }
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [POLYGIT_BIN, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeout = options.timeout ?? 30000;
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(
        new Error(
          `Command timed out after ${timeout}ms: polygit ${args.join(" ")}`
        )
      );
    }, timeout);

    proc.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode: exitCode ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Execute polygit and expect success (exit code 0)
 */
export async function polygitOk(
  args: string[],
  options: { cwd: string; env?: Record<string, string> }
): Promise<CliResult> {
  const result = await polygit(args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `polygit ${args.join(" ")} failed with exit code ${result.exitCode}\n` +
        `stdout: ${result.stdout}\n` +
        `stderr: ${result.stderr}`
    );
  }
  return result;
}
