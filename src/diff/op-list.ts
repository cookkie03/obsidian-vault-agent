export type OpListOperation =
  | { type: "replace"; anchor: string; old: string; new: string }
  | { type: "insert_after"; anchor: string; text: string }
  | { type: "delete"; anchor: string };

export class AnchorNotFoundError extends Error {
  constructor(anchor: string) {
    super(`Anchor not found in file: ${JSON.stringify(anchor)}`);
    this.name = "AnchorNotFoundError";
  }
}

function findAnchor(content: string, anchor: string): number {
  const index = content.indexOf(anchor);
  if (index === -1) throw new AnchorNotFoundError(anchor);
  return index;
}

export function applyOpList(content: string, operations: OpListOperation[]): string {
  let result = content;
  for (const op of operations) {
    const index = findAnchor(result, op.anchor);
    if (op.type === "replace") {
      result = result.slice(0, index) + op.new + result.slice(index + op.old.length);
    } else if (op.type === "delete") {
      const lineStart = result.lastIndexOf("\n", index) + 1;
      let lineEnd = result.indexOf("\n", index);
      lineEnd = lineEnd === -1 ? result.length : lineEnd + 1;
      result = result.slice(0, lineStart) + result.slice(lineEnd);
    } else if (op.type === "insert_after") {
      let lineEnd = result.indexOf("\n", index);
      lineEnd = lineEnd === -1 ? result.length : lineEnd;
      result = result.slice(0, lineEnd) + "\n" + op.text + result.slice(lineEnd);
    }
  }
  return result;
}
