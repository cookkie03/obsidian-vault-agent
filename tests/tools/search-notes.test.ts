import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { buildSearchIndex } from "../../src/tools/search-index";
import { searchNotes } from "../../src/tools/search-notes";

describe("searchNotes", () => {
  it("builds an index from the vault and searches it", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "project plan for Q3");
    await fs.create(".agents/chats/session1.json", "project project project");
    const index = await buildSearchIndex(fs);
    expect(searchNotes(index, "project")).toEqual([{ path: "notes/a.md", matchCount: 1 }]);
  });
});
