import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { listAllPaths, fuzzyMatchPaths } from "../../src/ui/path-mention";

describe("path mention", () => {
  it("lists every file path in the vault", async () => {
    const fs = new FakeVaultFS();
    await fs.create("Projects/a.md", "1");
    await fs.create("Projects/Sub/b.md", "2");
    expect((await listAllPaths(fs)).sort()).toEqual(["Projects/Sub/b.md", "Projects/a.md"]);
  });

  it("matches paths by subsequence, case-insensitive", () => {
    const matches = fuzzyMatchPaths(["Projects/Roadmap.md", "Personal/Diary.md"], "prjrdm");
    expect(matches).toEqual(["Projects/Roadmap.md"]);
  });

  it("returns no matches when the query is not a subsequence", () => {
    expect(fuzzyMatchPaths(["Projects/Roadmap.md"], "xyz")).toEqual([]);
  });
});
