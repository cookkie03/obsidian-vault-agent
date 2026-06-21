import { describe, it, expect, vi, afterEach } from "vitest";
import { OllamaNativeProvider } from "../../src/provider/ollama-native-provider";

describe("OllamaNativeProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends images as a top-level images array and parses eval_count as usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "I see a cat" },
        prompt_eval_count: 20,
        eval_count: 8,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaNativeProvider("http://example.tailnet:11434");
    const result = await provider.chat(
      [{ role: "user", content: [{ type: "text", text: "what is this" }, { type: "image", base64: "AAA", mimeType: "image/png" }] }],
      []
    );

    expect(result.usage.totalTokens).toBe(28);
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.messages[0].images).toEqual(["AAA"]);
  });
});
