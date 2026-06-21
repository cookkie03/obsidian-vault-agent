import { VaultFS } from "./vault-fs";
import { assertSafePath } from "./path-guard";
import { ImageContentBlock } from "../provider/types";

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function readImage(fs: VaultFS, path: string): Promise<ImageContentBlock> {
  assertSafePath(path);
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) throw new Error(`Unsupported image extension: .${extension}`);
  const base64 = await fs.read(path);
  return { type: "image", base64, mimeType };
}
