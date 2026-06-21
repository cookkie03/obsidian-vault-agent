export interface ImageContentBlock {
  type: "image";
  base64: string;
  mimeType: string;
}

export interface TextContentBlock {
  type: "text";
  text: string;
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ContentBlock[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatResponse {
  message: ChatMessage;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface ModelProvider {
  chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse>;
}
