export interface VaultFS {
  read(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  modify(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(folderPath: string): Promise<{ files: string[]; folders: string[] }>;
  delete(path: string): Promise<void>;
}
