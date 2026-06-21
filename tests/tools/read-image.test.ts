import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { readImage } from "../../src/tools/read-image";

describe("readImage", () => {
  it("returns a base64 image content block with mimeType from extension", async () => {
    const fs = new FakeVaultFS();
    await fs.create("attachments/diagram.png", "binary-as-base64-string");
    const block = await readImage(fs, "attachments/diagram.png");
    expect(block).toEqual({ type: "image", base64: "binary-as-base64-string", mimeType: "image/png" });
  });
});
