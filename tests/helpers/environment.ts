/**
 * Hermetic Git environment shared by fixture commands and the CLI under test.
 * File transport is the only permitted transport, including for Git subprocesses
 * spawned by Polygit. Ignore developer config, signing, identity and GIT_DIR.
 */
export function gitTestEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...overrides };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Polygit Test",
    GIT_AUTHOR_EMAIL: "polygit-test@example.invalid",
    GIT_COMMITTER_NAME: "Polygit Test",
    GIT_COMMITTER_EMAIL: "polygit-test@example.invalid",
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "init.defaultBranch",
    GIT_CONFIG_VALUE_0: "main",
    GIT_CONFIG_KEY_1: "commit.gpgSign",
    GIT_CONFIG_VALUE_1: "false",
    GIT_CONFIG_KEY_2: "tag.gpgSign",
    GIT_CONFIG_VALUE_2: "false",
  };
}
