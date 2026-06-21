import yaml from "js-yaml";
import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;

export function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return { frontmatter: {}, body: content };
  const parsed = yaml.load(match[1]);
  return { frontmatter: (parsed ?? {}) as Record<string, unknown>, body: content.slice(match[0].length) };
}

export function joinFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  if (Object.keys(frontmatter).length === 0) return body;
  return `---\n${yaml.dump(frontmatter)}---\n${body}`;
}

export async function getFrontmatter(fs: VaultFS, path: string): Promise<Record<string, unknown>> {
  assertSafePath(path);
  const content = await fs.read(path);
  return splitFrontmatter(content).frontmatter;
}
