import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { buildSystemPrompt, BASE_SYSTEM_PROMPT } from "../../src/agent/system-prompt";

describe("buildSystemPrompt", () => {
  it("returns just the base prompt when AGENTS.md is absent", async () => {
    const fs = new FakeVaultFS();
    expect(await buildSystemPrompt(fs)).toBe(BASE_SYSTEM_PROMPT);
  });

  it("appends AGENTS.md content when present", async () => {
    const fs = new FakeVaultFS();
    await fs.create("AGENTS.md", "This vault is organized by project. Archive/ is historical.");
    const prompt = await buildSystemPrompt(fs);
    expect(prompt).toBe(`${BASE_SYSTEM_PROMPT}\n\n${"This vault is organized by project. Archive/ is historical."}`);
  });
});
