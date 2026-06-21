import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAICompatProvider } from "../../src/provider/openai-compat-provider";

describe("OpenAICompatProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends messages and tools, parses a text response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: "hello back" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatProvider("http://example.tailnet:11434");
    const result = await provider.chat(
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      []
    );

    expect(result.message.content).toEqual([{ type: "text", text: "hello back" }]);
    expect(result.usage.totalTokens).toBe(15);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://example.tailnet:11434/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("parses a tool-call response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_1", function: { name: "search_notes", arguments: '{"query":"foo"}' } }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatProvider("http://example.tailnet:11434");
    const result = await provider.chat(
      [{ role: "user", content: [{ type: "text", text: "search for foo" }] }],
      [{ name: "search_notes", description: "search", parameters: {} }]
    );

    expect(result.message.toolCalls).toEqual([
      { id: "call_1", name: "search_notes", arguments: { query: "foo" } },
    ]);
  });

  it("throws on non-ok response without crashing the process", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
    const provider = new OpenAICompatProvider("http://example.tailnet:11434");
    await expect(
      provider.chat([{ role: "user", content: [{ type: "text", text: "hi" }] }], [])
    ).rejects.toThrow(/502/);
  });
});
