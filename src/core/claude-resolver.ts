import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAnthropicApiKey } from "./global-config.js";
import { git, gitOrFail } from "./git-ops.js";

// ============================================================================
// Types
// ============================================================================

export interface ConflictResolutionResult {
  success: boolean;
  resolvedFiles: string[];
  failedFiles: string[];
  error?: string;
}

// ============================================================================
// Conflict Resolution
// ============================================================================

/**
 * Read a file with conflict markers
 */
async function readConflictFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8");
}

/**
 * Write the resolved file content
 */
async function writeResolvedFile(
  filePath: string,
  content: string
): Promise<void> {
  await writeFile(filePath, content, "utf-8");
}

/**
 * Use Claude Agent SDK to resolve conflicts in files
 */
export async function resolveConflictsWithClaude(
  repoPath: string,
  conflictFiles: string[]
): Promise<ConflictResolutionResult> {
  const apiKey = await getAnthropicApiKey();

  if (!apiKey) {
    return {
      success: false,
      resolvedFiles: [],
      failedFiles: conflictFiles,
      error:
        "No Anthropic API key found. Set ANTHROPIC_API_KEY environment variable or add to ~/.polygit/config.json",
    };
  }

  const result: ConflictResolutionResult = {
    success: true,
    resolvedFiles: [],
    failedFiles: [],
  };

  // Dynamically import the SDK to avoid requiring it if not using Claude strategy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let claude: any;
  try {
    // Use indirect import to avoid TypeScript module resolution errors
    const sdkName = "@anthropic-ai/claude-agent-sdk";
    claude = await import(/* webpackIgnore: true */ sdkName);
  } catch {
    return {
      success: false,
      resolvedFiles: [],
      failedFiles: conflictFiles,
      error:
        "Claude Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk",
    };
  }

  for (const file of conflictFiles) {
    const filePath = join(repoPath, file);

    try {
      const content = await readConflictFile(filePath);

      // Check if file has conflict markers
      if (!content.includes("<<<<<<<") || !content.includes(">>>>>>>")) {
        // Not a conflict file, skip
        result.resolvedFiles.push(file);
        continue;
      }

      // Use Claude to resolve the conflict
      const prompt = `You are resolving a git merge conflict. The file below contains conflict markers.

Your task:
1. Understand both sides of the conflict
2. Produce a resolved version that combines both changes correctly
3. Remove all conflict markers (<<<<<<<, =======, >>>>>>>)
4. Output ONLY the resolved file content, nothing else

File with conflicts:
\`\`\`
${content}
\`\`\`

Resolved file:`;

      // Create agent and run
      const agent = new claude.Agent({
        apiKey,
        model: "claude-sonnet-4-20250514",
      });

      const response = await agent.run({
        prompt,
        maxTurns: 1,
      });

      // Extract the resolved content from the response
      const resolvedContent = extractResolvedContent(response.output);

      if (resolvedContent) {
        await writeResolvedFile(filePath, resolvedContent);
        result.resolvedFiles.push(file);
      } else {
        result.failedFiles.push(file);
        result.success = false;
      }
    } catch (err) {
      result.failedFiles.push(file);
      result.success = false;
      result.error = err instanceof Error ? err.message : String(err);
    }
  }

  // If all files resolved, stage them and complete the merge
  if (result.success && result.resolvedFiles.length > 0) {
    for (const file of result.resolvedFiles) {
      await git(["add", file], repoPath);
    }

    // Complete the merge
    await git(["commit", "--no-edit"], repoPath);
  }

  return result;
}

/**
 * Extract resolved content from Claude's response
 */
function extractResolvedContent(output: string): string | null {
  // Try to extract content from code blocks
  const codeBlockMatch = output.match(/```(?:\w+)?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1];
  }

  // If no code block, check if output looks like resolved content
  // (no conflict markers)
  if (!output.includes("<<<<<<<") && !output.includes(">>>>>>>")) {
    return output.trim();
  }

  return null;
}

/**
 * Create a conflict resolver function for use with preview.ts
 */
export function createClaudeResolver(): (
  repoPath: string,
  conflicts: string[]
) => Promise<boolean> {
  return async (repoPath: string, conflicts: string[]): Promise<boolean> => {
    console.log(`  Attempting Claude conflict resolution for ${conflicts.length} file(s)...`);
    const result = await resolveConflictsWithClaude(repoPath, conflicts);

    if (result.success) {
      console.log(`  Resolved: ${result.resolvedFiles.join(", ")}`);
      return true;
    } else {
      console.log(`  Failed to resolve: ${result.failedFiles.join(", ")}`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
      return false;
    }
  };
}
