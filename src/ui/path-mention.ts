import { VaultFS } from "../tools/vault-fs";

export async function listAllPaths(fs: VaultFS): Promise<string[]> {
  const paths: string[] = [];
  async function walk(folder: string): Promise<void> {
    const { files, folders } = await fs.list(folder);
    paths.push(...files);
    for (const sub of folders) {
      await walk(folder === "" ? sub : `${folder}/${sub}`);
    }
  }
  await walk("");
  return paths;
}

function isSubsequence(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

export function fuzzyMatchPaths(paths: string[], query: string): string[] {
  const lowerQuery = query.toLowerCase();
  return paths.filter((path) => isSubsequence(lowerQuery, path.toLowerCase()));
}

export interface MentionTrigger {
  triggerStart: number;
  query: string;
}

// Pure cursor-text logic so the side panel's @-mention dropdown wiring
// (DOM-only, manual-test-only) has a tested core to call into.
export function detectMentionTrigger(text: string, cursorPos: number): MentionTrigger | null {
  const upToCursor = text.slice(0, cursorPos);
  const triggerStart = upToCursor.lastIndexOf("@");
  if (triggerStart === -1) return null;
  const query = upToCursor.slice(triggerStart + 1);
  if (/\s/.test(query)) return null;
  if (triggerStart > 0 && !/\s/.test(text[triggerStart - 1])) return null;
  return { triggerStart, query };
}
