import { ItemView, WorkspaceLeaf } from "obsidian";
import { AgentLoop, StepEvent } from "../agent/loop";
import { VaultFS } from "../tools/vault-fs";
import { ContentBlock, ImageContentBlock } from "../provider/types";
import { stepEventToLabel, formatDiffPreview } from "./render-helpers";
import { parseCommand, isBuiltInCommand } from "../agent/commands";
import { resolveSkillInvocation, listSkills } from "../agent/skills";
import { listSessions, loadSession, saveSession, ChatSession } from "../storage/chat-sessions";
import { listAllPaths, fuzzyMatchPaths, detectMentionTrigger } from "./path-mention";
import { readNote } from "../tools/read-note";
import { listFolder } from "../tools/list-folder";

export const VIEW_TYPE_VAULT_AGENT = "vault-agent-side-panel";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export class VaultAgentSidePanelView extends ItemView {
  private logEl!: HTMLElement;
  private inputEl!: HTMLInputElement;
  private mentionDropdownEl!: HTMLElement;
  private currentSessionId = `${Date.now()}`;
  private allPaths: string[] = [];
  private pendingMentions: { path: string; content: string }[] = [];
  private pendingImages: ImageContentBlock[] = [];

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
    this.mentionDropdownEl = container.createDiv({ cls: "vault-agent-mention-dropdown" });
    this.mentionDropdownEl.style.display = "none";

    this.loop.onStep((event) => this.renderStepEvent(event));
    this.allPaths = await listAllPaths(this.fs);

    this.inputEl.addEventListener("input", () => this.updateMentionDropdown());
    this.inputEl.addEventListener("paste", (evt) => this.handlePaste(evt));
    this.inputEl.addEventListener("drop", (evt) => this.handleDrop(evt));
    this.inputEl.addEventListener("dragover", (evt) => evt.preventDefault());

    this.inputEl.addEventListener("keydown", async (evt) => {
      if (evt.key !== "Enter") return;
      const text = this.inputEl.value;
      this.inputEl.value = "";
      this.hideMentionDropdown();
      await this.handleInput(text);
    });
  }

  private updateMentionDropdown(): void {
    const cursorPos = this.inputEl.selectionStart ?? this.inputEl.value.length;
    const trigger = detectMentionTrigger(this.inputEl.value, cursorPos);
    if (!trigger) {
      this.hideMentionDropdown();
      return;
    }
    const matches = fuzzyMatchPaths(this.allPaths, trigger.query).slice(0, 10);
    this.mentionDropdownEl.empty();
    if (matches.length === 0) {
      this.hideMentionDropdown();
      return;
    }
    this.mentionDropdownEl.style.display = "block";
    for (const path of matches) {
      const optionEl = this.mentionDropdownEl.createDiv({ text: path, cls: "vault-agent-mention-option" });
      optionEl.addEventListener("click", () => this.selectMention(trigger.triggerStart, cursorPos, path));
    }
  }

  private hideMentionDropdown(): void {
    this.mentionDropdownEl.style.display = "none";
    this.mentionDropdownEl.empty();
  }

  private async handlePaste(evt: ClipboardEvent): Promise<void> {
    const items = evt.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) await this.addPendingImage(file);
    }
  }

  private async handleDrop(evt: DragEvent): Promise<void> {
    evt.preventDefault();
    const files = evt.dataTransfer?.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) await this.addPendingImage(file);
    }
  }

  private async addPendingImage(file: File): Promise<void> {
    const base64 = await blobToBase64(file);
    this.pendingImages.push({ type: "image", base64, mimeType: file.type });
    this.logEl.createDiv({ text: `📎 image attached (${file.type})` });
  }

  private async selectMention(triggerStart: number, cursorPos: number, path: string): Promise<void> {
    const value = this.inputEl.value;
    this.inputEl.value = value.slice(0, triggerStart) + value.slice(cursorPos);
    this.hideMentionDropdown();

    const isFolder = !this.allPaths.includes(path);
    const injected = isFolder ? await listFolder(this.fs, path) : await readNote(this.fs, path);
    this.pendingMentions.push({ path, content: JSON.stringify(injected) });
    this.logEl.createDiv({ text: `📎 attached ${path}` });
  }

  private async handleInput(text: string): Promise<void> {
    const parsed = parseCommand(text);
    if (!parsed) {
      this.logEl.createDiv({ text: `> ${text}` });
      const mentions = this.pendingMentions;
      const images = this.pendingImages;
      this.pendingMentions = [];
      this.pendingImages = [];
      if (!text && mentions.length === 0 && images.length === 0) return;
      const withMentions = mentions.length
        ? `${text}\n\n${mentions.map((m) => `[${m.path}]\n${m.content}`).join("\n\n")}`
        : text;
      const content: ContentBlock[] = withMentions ? [{ type: "text", text: withMentions }, ...images] : images;
      await this.loop.send(content);
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
      await this.loop.compactNow();
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
