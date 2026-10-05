import { join } from "node:path";
import { createPolyrepoFixture } from "./fixtures.js";
import { polygitOk } from "./cli.js";
import { gitOk } from "./git.js";

/** Members and metadata publish exclusively to disposable local bare repos. */
export async function createLocalFixture(memberNames = ["app"]) {
  const fixture = await createPolyrepoFixture({ memberNames });
  const meta = join(fixture.root, ".polygit");
  const metaOrigin = join(fixture.root, ".origins", "meta.git");
  try {
    await polygitOk(["init"], { cwd: fixture.root });
    await gitOk(["init", "--bare", metaOrigin], fixture.root);
    await gitOk(["remote", "add", "origin", metaOrigin], meta);
    await gitOk(["push", "-u", "origin", "main"], meta);
    return { ...fixture, meta, metaOrigin };
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}

export type LocalFixture = Awaited<ReturnType<typeof createLocalFixture>>;
