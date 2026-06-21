import { ChatMessage, ChatResponse, ModelProvider, ToolSchema, ContentBlock } from "./types";

function splitContent(content: ContentBlock[]): { text: string; images: string[] } {
  const text = content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
  const images = content.filter((b) => b.type === "image").map((b: any) => b.base64);
  return { text, images };
}

export class OllamaNativeProvider implements ModelProvider {
  constructor(private baseUrl: string) {}

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse> {
    const body = {
      messages: messages.map((m) => {
        const { text, images } = splitContent(m.content);
        return { role: m.role, content: text, ...(images.length ? { images } : {}) };
      }),
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      stream: false,
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama-native provider returned ${res.status}`);
    }

    const data = await res.json();
    const content: ContentBlock[] = data.message.content ? [{ type: "text", text: data.message.content }] : [];
    const toolCalls = (data.message.tool_calls ?? []).map((tc: any) => ({
      id: tc.id ?? `call_${Math.random().toString(36).slice(2)}`,
      name: tc.function.name,
      arguments: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments,
    }));

    return {
      message: { role: "assistant", content, ...(toolCalls.length ? { toolCalls } : {}) },
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
    };
  }
}
