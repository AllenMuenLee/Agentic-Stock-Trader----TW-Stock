import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Only non-secret (or low-risk, revocable) fields are persisted to disk, to
 * avoid re-prompting for everything on every restart. Fubon's password and
 * cert password are never written to disk — the UI always re-collects those,
 * and a fresh Fubon login is required every restart regardless.
 */
export interface LocalConfig {
  fubonId: string;
  fubonCertPath: string;
  /** AI股探 username (email) — pre-fills the login field. Not secret. */
  aiUsername: string;
  /**
   * The AI股探 server's JWT (7-day expiry, see apps/api/src/middleware/auth.ts)
   * — NOT the password itself. Lets a restart skip AI股探 login entirely
   * (server.ts verifies it's still valid via GET /api/auth/me before trusting
   * it). Far lower risk than persisting the raw password: it's already scoped
   * and short-lived, and revoking it doesn't touch the account password.
   */
  aiToken: string;
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

/** Merges `patch` into the existing saved config — callers only pass the fields they own. */
export function saveConfig(patch: Partial<LocalConfig>): void {
  const merged = { ...loadConfig(), ...patch };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

/** Drops the saved AI股探 session (username + token) — e.g. the UI's "switch account" escape hatch. Leaves fubonId/fubonCertPath untouched. */
export function clearSavedSession(): void {
  const { aiUsername, aiToken, ...rest } = loadConfig();
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(rest, null, 2), { mode: 0o600 });
}
