import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { listSkills, resolveSkillInvocation } from "../../src/agent/skills";

describe("skills", () => {
  it("lists skill files from .agents/skills", async () => {
    const fs = new FakeVaultFS();
    await fs.create(".agents/skills/summarize.md", "Summarize the active note in 5 bullets.");
    expect(await listSkills(fs)).toEqual([{ name: "summarize", content: "Summarize the active note in 5 bullets." }]);
  });

  it("resolves a skill invocation by appending arguments", async () => {
    const fs = new FakeVaultFS();
    await fs.create(".agents/skills/summarize.md", "Summarize the active note in 5 bullets.");
    expect(await resolveSkillInvocation(fs, "summarize", "in Italian")).toBe(
      "Summarize the active note in 5 bullets.\n\nin Italian"
    );
  });

  it("throws when the skill does not exist", async () => {
    const fs = new FakeVaultFS();
    await expect(resolveSkillInvocation(fs, "missing", "")).rejects.toThrow();
  });
});
