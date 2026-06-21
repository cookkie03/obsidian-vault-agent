import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "./fake-vault-fs";

describe("FakeVaultFS", () => {
  it("creates and reads a file", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "hello");
    expect(await fs.read("notes/a.md")).toBe("hello");
  });

  it("lists files and subfolders directly under a folder", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "1");
    await fs.create("notes/sub/b.md", "2");
    const listing = await fs.list("notes");
    expect(listing.files).toEqual(["notes/a.md"]);
    expect(listing.folders).toEqual(["sub"]);
  });
});
