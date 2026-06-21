import { VaultFS } from "./vault-fs";

export interface SearchHit {
  path: string;
  matchCount: number;
}

const EXCLUDED_PREFIX = ".agents/";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export class SearchIndex {
  private wordToPaths = new Map<string, Map<string, number>>();
  private resolvedLinks: Record<string, Record<string, number>> = {};

  indexFile(path: string, content: string): void {
    if (path.startsWith(EXCLUDED_PREFIX)) return;
    this.removeFile(path);
    for (const word of tokenize(content)) {
      if (!this.wordToPaths.has(word)) this.wordToPaths.set(word, new Map());
      const paths = this.wordToPaths.get(word)!;
      paths.set(path, (paths.get(path) ?? 0) + 1);
    }
  }

  removeFile(path: string): void {
    for (const paths of this.wordToPaths.values()) {
      paths.delete(path);
    }
  }

  search(query: string): SearchHit[] {
    const counts = new Map<string, number>();
    for (const word of tokenize(query)) {
      const paths = this.wordToPaths.get(word);
      if (!paths) continue;
      for (const [path, count] of paths) {
        counts.set(path, (counts.get(path) ?? 0) + count);
      }
    }
    return [...counts.entries()]
      .map(([path, matchCount]) => ({ path, matchCount }))
      .sort((a, b) => b.matchCount - a.matchCount);
  }

  setResolvedLinks(links: Record<string, Record<string, number>>): void {
    this.resolvedLinks = links;
  }

  getBacklinks(path: string): string[] {
    return Object.entries(this.resolvedLinks)
      .filter(([, targets]) => path in targets)
      .map(([source]) => source);
  }
}

export async function buildSearchIndex(fs: VaultFS): Promise<SearchIndex> {
  const index = new SearchIndex();
  async function walk(folder: string): Promise<void> {
    const { files, folders } = await fs.list(folder);
    for (const file of files) {
      index.indexFile(file, await fs.read(file));
    }
    for (const sub of folders) {
      await walk(folder === "" ? sub : `${folder}/${sub}`);
    }
  }
  await walk("");
  return index;
}
