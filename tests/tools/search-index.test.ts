import { describe, it, expect } from "vitest";
import { SearchIndex } from "../../src/tools/search-index";

describe("SearchIndex", () => {
  it("finds a file by a word in its content", () => {
    const index = new SearchIndex();
    index.indexFile("notes/a.md", "the quick brown fox");
    expect(index.search("brown")).toEqual([{ path: "notes/a.md", matchCount: 1 }]);
  });

  it("ranks files with more matching words higher", () => {
    const index = new SearchIndex();
    index.indexFile("notes/a.md", "fox fox jumps");
    index.indexFile("notes/b.md", "fox only once");
    const hits = index.search("fox");
    expect(hits[0].path).toBe("notes/a.md");
  });

  it("excludes files under .agents/ from indexing", () => {
    const index = new SearchIndex();
    index.indexFile(".agents/chats/session1.json", "fox fox fox");
    expect(index.search("fox")).toEqual([]);
  });

  it("removeFile drops a file from future searches", () => {
    const index = new SearchIndex();
    index.indexFile("notes/a.md", "unique-term");
    index.removeFile("notes/a.md");
    expect(index.search("unique-term")).toEqual([]);
  });

  it("returns backlinks from resolved links data", () => {
    const index = new SearchIndex();
    index.setResolvedLinks({ "notes/a.md": { "notes/b.md": 1 }, "notes/c.md": { "notes/b.md": 1 } });
    expect(index.getBacklinks("notes/b.md").sort()).toEqual(["notes/a.md", "notes/c.md"]);
  });
});
