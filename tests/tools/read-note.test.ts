import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { readNote } from "../../src/tools/read-note";
import { PathEscapeError } from "../../src/tools/path-guard";

describe("readNote", () => {
  it("returns file content", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "content here");
    expect(await readNote(fs, "notes/a.md")).toBe("content here");
  });

  it("rejects an unsafe path before touching the filesystem", async () => {
    const fs = new FakeVaultFS();
    await expect(readNote(fs, "../secret.md")).rejects.toThrow(PathEscapeError);
  });
});
