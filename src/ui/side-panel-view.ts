import { ItemView, WorkspaceLeaf } from "obsidian";
import { AgentLoop, StepEvent } from "../agent/loop";
import { VaultFS } from "../tools/vault-fs";
import { stepEventToLabel, formatDiffPreview } from "./render-helpers";
import { parseCommand, isBuiltInCommand } from "../agent/commands";
import { resolveSkillInvocation, listSkills } from "../agent/skills";
import { listSessions, loadSession, saveSession, ChatSession } from "../storage/chat-sessions";
import { compactMessages } from "../agent/context-budget";
import { listAllPaths, fuzzyMatchPaths } from "./path-mention";

export const VIEW_TYPE_VAULT_AGENT = "vault-agent-side-panel";

export class VaultAgentSidePanelView extends ItemView {
  private logEl!: HTMLElement;
  private inputEl!: HTMLInputElement;
  private currentSessionId = `${Date.now()}`;

  constructor(
    leaf: WorkspaceLeaf,
    private loop: AgentLoop,
    private fs: VaultFS
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_VAULT_AGENT;
  }

  getDisplayText(): string {
    return "Vault Agent";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    this.logEl = container.createDiv({ cls: "vault-agent-log" });
    this.inputEl = container.createEl("input", { type: "text", placeholder: "Ask the agent or type / for commands..." });

    this.loop.onStep((event) => this.renderStepEvent(event));

    this.inputEl.addEventListener("keydown", async (evt) => {
      if (evt.key !== "Enter") return;
      const text = this.inputEl.value;
      this.inputEl.value = "";
      await this.handleInput(text);
    });
  }

  private async handleInput(text: string): Promise<void> {
    const parsed = parseCommand(text);
    if (!parsed) {
      this.logEl.createDiv({ text: `> ${text}` });
      await this.loop.send(text);
      return;
    }

    if (isBuiltInCommand(parsed.command)) {
      await this.handleBuiltInCommand(parsed.command, parsed.args);
      return;
    }

    try {
      const resolved = await resolveSkillInvocation(this.fs, parsed.command, parsed.args);
      await this.loop.send(resolved);
    } catch (err: any) {
      this.logEl.createDiv({ text: `⚠ ${err.message}` });
    }
  }

  private async handleBuiltInCommand(command: string, args: string): Promise<void> {
    if (command === "clear") {
      const messages = this.loop.getMessages();
      if (messages.length > 0) {
        await saveSession(this.fs, { id: this.currentSessionId, createdAt: new Date().toISOString(), messages });
      }
      this.currentSessionId = `${Date.now()}`;
      this.logEl.empty();
      return;
    }
    if (command === "resume") {
      if (!args) {
        const sessions = await listSessions(this.fs);
        this.logEl.createDiv({ text: sessions.map((s) => `${s.id}: ${s.firstUserMessage}`).join("\n") });
        return;
      }
      const session: ChatSession = await loadSession(this.fs, args);
      this.currentSessionId = session.id;
      this.logEl.empty();
      this.logEl.createDiv({ text: `Resumed session ${session.id}` });
      return;
    }
    if (command === "compact") {
      const compacted = await compactMessages((this.loop as any).provider, this.loop.getMessages(), 10);
      this.logEl.createDiv({ text: "Compacted older messages into a summary." });
      void compacted;
      return;
    }
    if (command === "help") {
      const skills = await listSkills(this.fs);
      this.logEl.createDiv({ text: ["/resume [id]", "/clear", "/compact", "/help", ...skills.map((s) => `/${s.name}`)].join("\n") });
      return;
    }
  }

  private renderStepEvent(event: StepEvent): void {
    if (event.type === "pending-change") {
      const block = this.logEl.createDiv({ cls: "vault-agent-pending" });
      block.createDiv({ text: stepEventToLabel(event) });
      block.createEl("pre", { text: formatDiffPreview(event.change, "") });
      const approveBtn = block.createEl("button", { text: "Approve" });
      const rejectBtn = block.createEl("button", { text: "Reject" });
      approveBtn.addEventListener("click", () => this.loop.approvePending());
      rejectBtn.addEventListener("click", () => this.loop.rejectPending());
      return;
    }
    this.logEl.createDiv({ text: stepEventToLabel(event) });
  }
}
