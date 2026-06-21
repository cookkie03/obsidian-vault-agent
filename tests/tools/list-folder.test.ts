import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { listFolder } from "../../src/tools/list-folder";

describe("listFolder", () => {
  it("lists files and folders directly under a path", async () => {
    const fs = new FakeVaultFS();
    await fs.create("Projects/a.md", "1");
    await fs.create("Projects/Sub/b.md", "2");
    expect(await listFolder(fs, "Projects")).toEqual({ files: ["Projects/a.md"], folders: ["Sub"] });
  });
});
