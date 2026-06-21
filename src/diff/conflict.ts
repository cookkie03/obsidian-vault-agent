export class ConflictError extends Error {
  constructor() {
    super("File changed since the proposal was generated; re-read the file before retrying.");
    this.name = "ConflictError";
  }
}

// FNV-1a 64-bit, computed with two 32-bit halves since JS numbers lose
// precision above 2^53. Obsidian plugins must run on mobile too (no
// node:crypto in the bundled/browser runtime), so this is a pure-JS,
// synchronous content fingerprint rather than a real SHA-256 digest --
// fine here since it only guards against accidental concurrent edits,
// not against a malicious actor forging a collision.
export function snapshotHash(content: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 ^ c) >>> 0;
    h2 = Math.imul(h2, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function assertNoConflict(currentContent: string, snapshotHashAtProposalTime: string): void {
  if (snapshotHash(currentContent) !== snapshotHashAtProposalTime) {
    throw new ConflictError();
  }
}
