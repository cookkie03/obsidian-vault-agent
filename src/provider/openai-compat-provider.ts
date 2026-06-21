import { ChatMessage, ChatResponse, ModelProvider, ToolSchema, ContentBlock } from "./types";

function toOpenAiContent(content: ContentBlock[]): string | Array<Record<string, unknown>> {
  if (content.length === 1 && content[0].type === "text") return content[0].text;
  return content.map((block) =>
    block.type === "text"
      ? { type: "text", text: block.text }
      : { type: "image_url", image_url: { url: `data:${block.mimeType};base64,${block.base64}` } }
  );
}

export class OpenAICompatProvider implements ModelProvider {
  constructor(private baseUrl: string) {}

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse> {
    const body = {
      messages: messages.map((m) => ({
        role: m.role,
        content: toOpenAiContent(m.content),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OpenAI-compatible provider returned ${res.status}`);
    }

    const data = await res.json();
    const choice = data.choices[0].message;
    const content: ContentBlock[] = choice.content ? [{ type: "text", text: choice.content }] : [];
    const toolCalls = (choice.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      message: { role: "assistant", content, ...(toolCalls.length ? { toolCalls } : {}) },
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }
}
