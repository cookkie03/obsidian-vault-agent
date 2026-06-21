import { describe, it, expect } from "vitest";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { loadAgentConfig } from "../../src/storage/agent-config";

describe("agent config", () => {
  it("creates .agents/config.json with default 90% threshold if missing", async () => {
    const fs = new FakeVaultFS();
    const config = await loadAgentConfig(fs);
    expect(config).toEqual({ compactThresholdPercent: 90 });
    expect(await fs.exists(".agents/config.json")).toBe(true);
  });

  it("loads an existing config without overwriting it", async () => {
    const fs = new FakeVaultFS();
    await fs.create(".agents/config.json", JSON.stringify({ compactThresholdPercent: 75 }));
    expect(await loadAgentConfig(fs)).toEqual({ compactThresholdPercent: 75 });
  });
});
