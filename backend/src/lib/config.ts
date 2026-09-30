import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

dotenv.config();

const DEV_JWT_SECRET = 'detectkb-dev-secret-change-in-production';
// Values shipped in docker-compose.yml / .env.example: anyone can forge tokens signed with them
const KNOWN_WEAK_SECRETS = new Set([DEV_JWT_SECRET, 'change-me-to-a-long-random-string', 'change-me', 'secret', 'changeme']);
const MIN_SECRET_LENGTH = 32;

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT = Number(process.env.PORT) || 3001;
// Absolute: res.sendFile and the backup/restore code need absolute paths
export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), '..', 'backups'));
// Empty: the API is only reached same-origin through nginx / the Vite proxy, so no cross-origin access
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '';

export const SIGMA_SERVICE_URL = (process.env.SIGMA_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

export function isWeakJwtSecret(secret: string | undefined): boolean {
  return !secret || secret.length < MIN_SECRET_LENGTH || KNOWN_WEAK_SECRETS.has(secret);
}

/**
 * In production a missing or known/short JWT_SECRET is replaced by a random
 * one kept in BACKUP_DIR/.secrets (the persisted volume), so existing installs
 * that never set it are no longer open to forged tokens and sessions survive
 * restarts.
 */
function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (!isWeakJwtSecret(fromEnv)) return fromEnv!;
  if (NODE_ENV !== 'production') return fromEnv || DEV_JWT_SECRET;

  const file = path.join(BACKUP_DIR, '.secrets', 'jwt-secret');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (!isWeakJwtSecret(saved)) return saved;
  } catch {
    // not generated yet
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, generated, { mode: 0o600 });
  console.warn(`[config] JWT_SECRET is unset or weak — using a generated secret stored in ${file}. Set a strong JWT_SECRET in .env.`);
  return generated;
}

export const JWT_SECRET = resolveJwtSecret();
