import { VaultFS } from "./vault-fs";
import { ToolCall, ToolSchema } from "../provider/types";
import { PendingChange } from "./pending-change";
import { SearchIndex } from "./search-index";
import { searchNotes } from "./search-notes";
import { readNote } from "./read-note";
import { readImage } from "./read-image";
import { listFolder } from "./list-folder";
import { getFrontmatter, proposeSetFrontmatter } from "./frontmatter";
import { proposeManageTags } from "./manage-tags";
import { proposeCreateNote } from "./create-note";
import { proposeEditNote } from "./edit-note";

export type DispatchOutcome = { kind: "result"; value: unknown } | { kind: "pending"; change: PendingChange };

const READ_ONLY_TOOLS = new Set(["search_notes", "read_note", "read_image", "list_folder", "get_frontmatter"]);

export class ToolRegistry {
  constructor(private fs: VaultFS, private index: SearchIndex) {}

  schemas(): ToolSchema[] {
    return [
      { name: "search_notes", description: "Full-text and backlink search over the vault.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "read_note", description: "Read the text content of a note.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "read_image", description: "Read an image from the vault as a multimodal content block.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "list_folder", description: "List files and subfolders directly under a folder.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "get_frontmatter", description: "Read the YAML frontmatter of a note.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "set_frontmatter", description: "Propose merging keys into a note's frontmatter (requires approval).", parameters: { type: "object", properties: { path: { type: "string" }, updates: { type: "object" } }, required: ["path", "updates"] } },
      { name: "manage_tags", description: "Propose adding/removing tags on a note (requires approval).", parameters: { type: "object", properties: { path: { type: "string" }, add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } } }, required: ["path"] } },
      { name: "create_note", description: "Propose creating a new note (requires approval).", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
      { name: "edit_note", description: "Propose editing a note via anchored operations, or full content as fallback (requires approval).", parameters: { type: "object", properties: { path: { type: "string" }, operations: { type: "array" }, fullContent: { type: "string" } }, required: ["path"] } },
    ];
  }

  async dispatch(call: ToolCall): Promise<DispatchOutcome> {
    const args = call.arguments as any;
    if (READ_ONLY_TOOLS.has(call.name)) {
      const value = await this.runReadOnly(call.name, args);
      return { kind: "result", value };
    }
    const change = await this.runMutating(call.name, args);
    return { kind: "pending", change };
  }

  private async runReadOnly(name: string, args: any): Promise<unknown> {
    switch (name) {
      case "search_notes":
        return searchNotes(this.index, args.query);
      case "read_note":
        return readNote(this.fs, args.path);
      case "read_image":
        return readImage(this.fs, args.path);
      case "list_folder":
        return listFolder(this.fs, args.path);
      case "get_frontmatter":
        return getFrontmatter(this.fs, args.path);
      default:
        throw new Error(`Unknown read-only tool: ${name}`);
    }
  }

  private async runMutating(name: string, args: any): Promise<PendingChange> {
    switch (name) {
      case "set_frontmatter":
        return proposeSetFrontmatter(this.fs, args.path, args.updates);
      case "manage_tags":
        return proposeManageTags(this.fs, args.path, args.add ?? [], args.remove ?? []);
      case "create_note":
        return proposeCreateNote(this.fs, args.path, args.content);
      case "edit_note":
        return proposeEditNote(this.fs, args.path, args.operations ?? { fullContent: args.fullContent });
      default:
        throw new Error(`Unknown mutating tool: ${name}`);
    }
  }
}
