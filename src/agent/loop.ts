import { ChatMessage, ContentBlock, ModelProvider, ToolCall } from "../provider/types";
import { ToolRegistry } from "../tools/registry";
import { PendingChange, applyPendingChange } from "../tools/pending-change";
import { ContextBudget } from "./context-budget";
import { AgentConfig } from "../storage/agent-config";

export type StepEvent =
  | { type: "tool-call"; name: string }
  | { type: "tool-result"; name: string }
  | { type: "pending-change"; change: PendingChange }
  | { type: "final"; text: string }
  | { type: "error"; message: string };

interface SuspendedState {
  toolCallId: string;
  toolName: string;
  change: PendingChange;
}

export class AgentLoop {
  private messages: ChatMessage[] = [];
  private handlers: ((event: StepEvent) => void)[] = [];
  private suspended: SuspendedState | null = null;

  constructor(
    private provider: ModelProvider,
    private registry: ToolRegistry,
    private budget: ContextBudget,
    private config: AgentConfig
  ) {}

  onStep(handler: (event: StepEvent) => void): void {
    this.handlers.push(handler);
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  async send(input: string | ContentBlock[]): Promise<void> {
    const content: ContentBlock[] = typeof input === "string" ? [{ type: "text", text: input }] : input;
    this.messages.push({ role: "user", content });
    await this.runUntilSuspendOrFinal();
  }

  async approvePending(): Promise<void> {
    if (!this.suspended) return;
    const { toolCallId, toolName, change } = this.suspended;
    this.suspended = null;
    await applyPendingChange(this.registry.fsForApply(), change);
    this.emit({ type: "tool-result", name: toolName });
    this.messages.push({
      role: "tool",
      toolCallId,
      content: [{ type: "text", text: `Applied. New content of ${change.path} written.` }],
    });
    await this.runUntilSuspendOrFinal();
  }

  async rejectPending(reason?: string): Promise<void> {
    if (!this.suspended) return;
    const { toolCallId } = this.suspended;
    this.suspended = null;
    const text = reason ? `Rejected by user. Reason: ${reason}` : "Rejected by user.";
    this.messages.push({ role: "tool", toolCallId, content: [{ type: "text", text }] });
    await this.runUntilSuspendOrFinal();
  }

  private emit(event: StepEvent): void {
    for (const handler of this.handlers) handler(event);
  }

  private async runUntilSuspendOrFinal(): Promise<void> {
    while (true) {
      let response;
      try {
        response = await this.provider.chat([...this.messages], this.registry.schemas());
      } catch (err: any) {
        this.emit({ type: "error", message: err.message });
        return;
      }

      this.budget.recordUsage(response.usage.totalTokens);
      this.messages.push(response.message);

      const toolCalls: ToolCall[] = response.message.toolCalls ?? [];
      if (toolCalls.length === 0) {
        const text = response.message.content.find((b) => b.type === "text");
        this.emit({ type: "final", text: text && text.type === "text" ? text.text : "" });
        return;
      }

      const call = toolCalls[0];
      this.emit({ type: "tool-call", name: call.name });
      const outcome = await this.registry.dispatch(call);

      if (outcome.kind === "pending") {
        this.suspended = { toolCallId: call.id, toolName: call.name, change: outcome.change };
        this.emit({ type: "pending-change", change: outcome.change });
        return;
      }

      this.emit({ type: "tool-result", name: call.name });
      this.messages.push({
        role: "tool",
        toolCallId: call.id,
        content: [{ type: "text", text: JSON.stringify(outcome.value) }],
      });
    }
  }
}
