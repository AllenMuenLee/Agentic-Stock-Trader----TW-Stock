import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Only non-secret fields are persisted to disk (to pre-fill the login form across runs).
 * Passwords and cert passwords are never written to disk — the UI always re-collects them.
 */
export interface LocalConfig {
  fubonId: string;
  fubonCertPath: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.stock-notifier-trader');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function loadConfig(): Partial<LocalConfig> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Partial<LocalConfig>;
  } catch {
    return {};
  }
}

export function saveConfig(config: LocalConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}
