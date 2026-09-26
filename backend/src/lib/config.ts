import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const DEV_JWT_SECRET = 'detectkb-dev-secret-change-in-production';

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT = Number(process.env.PORT) || 3001;
export const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;
// Absolute: res.sendFile and the backup/restore code need absolute paths
export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), '..', 'backups'));
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

export const SIGMA_SERVICE_URL = (process.env.SIGMA_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

if (NODE_ENV === 'production' && JWT_SECRET === DEV_JWT_SECRET) {
  console.warn('[config] WARNING: JWT_SECRET is not set — using the insecure development default.');
}
