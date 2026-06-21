import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";
import { PendingChange, snapshotHash } from "./pending-change";
import { splitFrontmatter, joinFrontmatter } from "./frontmatter";

export async function proposeManageTags(
  fs: VaultFS,
  path: string,
  add: string[],
  remove: string[]
): Promise<PendingChange> {
  assertSafePath(path);
  const currentContent = await fs.read(path);
  const { frontmatter, body } = splitFrontmatter(currentContent);
  const existingTags: string[] = Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : [];
  const removed = existingTags.filter((tag) => !remove.includes(tag));
  const newTags = [...removed, ...add.filter((tag) => !removed.includes(tag))];
  const newContent = joinFrontmatter({ ...frontmatter, tags: newTags }, body);
  return { path, newContent, baseSnapshotHash: snapshotHash(currentContent), kind: "edit" };
}
