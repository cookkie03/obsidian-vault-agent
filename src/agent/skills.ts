import { VaultFS } from "../tools/vault-fs";

const SKILLS_FOLDER = ".agents/skills";

export async function listSkills(fs: VaultFS): Promise<{ name: string; content: string }[]> {
  const { files } = await fs.list(SKILLS_FOLDER);
  return Promise.all(
    files.map(async (file) => ({
      name: file.slice(SKILLS_FOLDER.length + 1, -".md".length),
      content: await fs.read(file),
    }))
  );
}

export async function resolveSkillInvocation(fs: VaultFS, name: string, args: string): Promise<string> {
  const path = `${SKILLS_FOLDER}/${name}.md`;
  if (!(await fs.exists(path))) throw new Error(`Unknown command or skill: /${name}`);
  const content = await fs.read(path);
  return args ? `${content}\n\n${args}` : content;
}
