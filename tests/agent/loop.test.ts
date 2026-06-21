import { describe, it, expect, vi } from "vitest";
import { AgentLoop } from "../../src/agent/loop";
import { ModelProvider, ChatResponse } from "../../src/provider/types";
import { ToolRegistry } from "../../src/tools/registry";
import { FakeVaultFS } from "../fixtures/fake-vault-fs";
import { buildSearchIndex } from "../../src/tools/search-index";
import { ContextBudget } from "../../src/agent/context-budget";

function response(partial: Partial<ChatResponse["message"]>, usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 }): ChatResponse {
  return { message: { role: "assistant", content: [], ...partial }, usage };
}

describe("AgentLoop", () => {
  it("executes a read-only tool call automatically and returns the final text", async () => {
    const fs = new FakeVaultFS();
    await fs.create("notes/a.md", "secret plan");
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const chat = vi.fn()
      .mockResolvedValueOnce(response({ toolCalls: [{ id: "1", name: "read_note", arguments: { path: "notes/a.md" } }] }))
      .mockResolvedValueOnce(response({ content: [{ type: "text", text: "The plan is secret." }] }));
    const provider: ModelProvider = { chat };

    const events: string[] = [];
    const loop = new AgentLoop(provider, registry, new ContextBudget(), { compactThresholdPercent: 90 });
    loop.onStep((e) => events.push(e.type));

    await loop.send("what's in notes/a.md?");

    expect(events).toEqual(["tool-call", "tool-result", "final"]);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("suspends on a mutating tool call until approved", async () => {
    const fs = new FakeVaultFS();
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const chat = vi.fn()
      .mockResolvedValueOnce(response({ toolCalls: [{ id: "1", name: "create_note", arguments: { path: "notes/new.md", content: "hi" } }] }))
      .mockResolvedValueOnce(response({ content: [{ type: "text", text: "Created it." }] }));
    const provider: ModelProvider = { chat };

    const events: string[] = [];
    const loop = new AgentLoop(provider, registry, new ContextBudget(), { compactThresholdPercent: 90 });
    loop.onStep((e) => events.push(e.type));

    await loop.send("create a note");
    expect(events).toEqual(["tool-call", "pending-change"]);
    expect(await fs.exists("notes/new.md")).toBe(false);
    expect(chat).toHaveBeenCalledTimes(1);

    await loop.approvePending();
    expect(await fs.exists("notes/new.md")).toBe(true);
    expect(events).toEqual(["tool-call", "pending-change", "tool-result", "final"]);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("on reject, sends a refusal message back to the model and resumes", async () => {
    const fs = new FakeVaultFS();
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const chat = vi.fn()
      .mockResolvedValueOnce(response({ toolCalls: [{ id: "1", name: "create_note", arguments: { path: "notes/new.md", content: "hi" } }] }))
      .mockResolvedValueOnce(response({ content: [{ type: "text", text: "Understood, not creating it." }] }));
    const provider: ModelProvider = { chat };
    const loop = new AgentLoop(provider, registry, new ContextBudget(), { compactThresholdPercent: 90 });

    await loop.send("create a note");
    await loop.rejectPending("not now");

    expect(await fs.exists("notes/new.md")).toBe(false);
    const lastCallMessages = chat.mock.calls[1][0];
    expect(lastCallMessages.at(-1).content[0].text).toMatch(/not now/);
  });

  it("accepts image content blocks alongside text when sending a message", async () => {
    const fs = new FakeVaultFS();
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const chat = vi.fn().mockResolvedValueOnce(response({ content: [{ type: "text", text: "I see a cat." }] }));
    const provider: ModelProvider = { chat };
    const loop = new AgentLoop(provider, registry, new ContextBudget(), { compactThresholdPercent: 90 });

    await loop.send([
      { type: "text", text: "what is this?" },
      { type: "image", base64: "AAA", mimeType: "image/png" },
    ]);

    const sentMessages = chat.mock.calls[0][0];
    expect(sentMessages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what is this?" },
        { type: "image", base64: "AAA", mimeType: "image/png" },
      ],
    });
  });

  it("emits an error event and does not crash when the provider throws", async () => {
    const fs = new FakeVaultFS();
    const registry = new ToolRegistry(fs, await buildSearchIndex(fs));
    const provider: ModelProvider = { chat: vi.fn().mockRejectedValue(new Error("connection refused")) };
    const events: any[] = [];
    const loop = new AgentLoop(provider, registry, new ContextBudget(), { compactThresholdPercent: 90 });
    loop.onStep((e) => events.push(e));

    await loop.send("hello");
    expect(events).toEqual([{ type: "error", message: "connection refused" }]);
  });
});
