import { VaultFS } from "../tools/vault-fs";

export const BASE_SYSTEM_PROMPT = [
  "You are an agent operating inside an Obsidian vault.",
  "You can only act on the vault through the provided tools.",
  "Mutating tools (create_note, edit_note, set_frontmatter, manage_tags) never write directly: they always require explicit user approval before anything changes.",
  "Never request a path outside the vault.",
].join(" ");

export async function buildSystemPrompt(fs: VaultFS): Promise<string> {
  if (!(await fs.exists("AGENTS.md"))) return BASE_SYSTEM_PROMPT;
  const userInstructions = await fs.read("AGENTS.md");
  return `${BASE_SYSTEM_PROMPT}\n\n${userInstructions}`;
}
