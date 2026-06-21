import { describe, it, expect, vi } from "vitest";
import { ContextBudget, compactMessages } from "../../src/agent/context-budget";
import { ModelProvider, ChatMessage } from "../../src/provider/types";

describe("ContextBudget", () => {
  it("tracks percent of max context used from real provider usage", () => {
    const budget = new ContextBudget();
    budget.recordUsage(54000);
    expect(budget.percentUsed(60000)).toBe(90);
  });

  it("flags auto-compact once the configured threshold is reached", () => {
    const budget = new ContextBudget();
    budget.recordUsage(54000);
    expect(budget.shouldAutoCompact(60000, { compactThresholdPercent: 90 })).toBe(true);
    expect(budget.shouldAutoCompact(60000, { compactThresholdPercent: 95 })).toBe(false);
  });
});

describe("compactMessages", () => {
  it("summarizes older messages via the provider, keeping the last N intact", async () => {
    const fakeProvider: ModelProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: [{ type: "text", text: "Summary: discussed project plan." }] },
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    };
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "msg1" }] },
      { role: "assistant", content: [{ type: "text", text: "msg2" }] },
      { role: "user", content: [{ type: "text", text: "msg3" }] },
      { role: "assistant", content: [{ type: "text", text: "msg4" }] },
    ];
    const result = await compactMessages(fakeProvider, messages, 2);
    expect(result).toEqual([
      { role: "system", content: [{ type: "text", text: "Summary: discussed project plan." }] },
      { role: "user", content: [{ type: "text", text: "msg3" }] },
      { role: "assistant", content: [{ type: "text", text: "msg4" }] },
    ]);
  });
});
