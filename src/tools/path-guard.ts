export class PathEscapeError extends Error {
  constructor(path: string) {
    super(`Path escapes the vault: ${path}`);
    this.name = "PathEscapeError";
  }
}

export function assertSafePath(path: string): void {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new PathEscapeError(path);
  }
}
