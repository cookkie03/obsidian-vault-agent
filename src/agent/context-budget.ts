import { ChatMessage, ModelProvider } from "../provider/types";
import { AgentConfig } from "../storage/agent-config";

export class ContextBudget {
  private lastTotalTokens = 0;

  recordUsage(totalTokens: number): void {
    this.lastTotalTokens = totalTokens;
  }

  percentUsed(maxContextTokens: number): number {
    return Math.round((this.lastTotalTokens / maxContextTokens) * 100);
  }

  shouldAutoCompact(maxContextTokens: number, config: AgentConfig): boolean {
    return this.percentUsed(maxContextTokens) >= config.compactThresholdPercent;
  }
}

export async function compactMessages(
  provider: ModelProvider,
  messages: ChatMessage[],
  keepLastN: number
): Promise<ChatMessage[]> {
  const toSummarize = messages.slice(0, Math.max(0, messages.length - keepLastN));
  const kept = messages.slice(Math.max(0, messages.length - keepLastN));
  if (toSummarize.length === 0) return messages;

  const summaryRequest: ChatMessage = {
    role: "user",
    content: [{
      type: "text",
      text: `Summarize the following conversation concisely, preserving facts and decisions:\n\n${JSON.stringify(toSummarize)}`,
    }],
  };
  const response = await provider.chat([summaryRequest], []);
  return [{ role: "system", content: response.message.content }, ...kept];
}
