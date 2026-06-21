import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { getFrontmatter } from "../../src/tools/frontmatter";

describe("getFrontmatter", () => {
  it("parses YAML frontmatter from a note", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "---\ntitle: Hello\ntags:\n  - one\n  - two\n---\nBody text");
    expect(await getFrontmatter(fs, "notes/a.md")).toEqual({ title: "Hello", tags: ["one", "two"] });
  });

  it("returns an empty object when there is no frontmatter block", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/b.md", "Just body text");
    expect(await getFrontmatter(fs, "notes/b.md")).toEqual({});
  });
});
