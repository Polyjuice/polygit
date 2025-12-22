import { readFile, access, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Assert that a file exists
 */
export async function assertFileExists(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`Expected file to exist: ${path}`);
  }
}

/**
 * Assert that a directory exists
 */
export async function assertDirExists(path: string): Promise<void> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) {
      throw new Error(`Expected directory, but found file: ${path}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Expected directory to exist: ${path}`);
    }
    throw err;
  }
}

/**
 * Assert that a path does not exist
 */
export async function assertNotExists(path: string): Promise<void> {
  try {
    await access(path);
    throw new Error(`Expected path to not exist: ${path}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return; // This is expected
    }
    throw err;
  }
}

/**
 * Assert that polygit is initialized in a directory
 */
export async function assertPolygitInitialized(root: string): Promise<void> {
  await assertDirExists(join(root, ".polygit"));
  await assertFileExists(join(root, ".polygit", "config.json"));
  await assertFileExists(join(root, ".polygit", "state.json"));
}

/**
 * Read and parse a JSON file from .polygit
 */
export async function readPolygitJson<T>(
  root: string,
  filename: string
): Promise<T> {
  const content = await readFile(join(root, ".polygit", filename), "utf-8");
  return JSON.parse(content) as T;
}

/**
 * Read a file and return its content
 */
export async function readFileContent(path: string): Promise<string> {
  return readFile(path, "utf-8");
}
