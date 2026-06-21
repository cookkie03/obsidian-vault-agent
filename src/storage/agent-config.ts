import { VaultFS } from "../tools/vault-fs";

const CONFIG_PATH = ".agents/config.json";
const DEFAULT_CONFIG: AgentConfig = { compactThresholdPercent: 90 };

export interface AgentConfig {
  compactThresholdPercent: number;
}

export async function loadAgentConfig(fs: VaultFS): Promise<AgentConfig> {
  if (!(await fs.exists(CONFIG_PATH))) {
    await fs.create(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
  return JSON.parse(await fs.read(CONFIG_PATH));
}
