/**
 * Login throttling and the password policy.
 *
 * Failed logins are counted per client IP + username, per IP across all
 * usernames (password spraying) and per username across all IPs (a distributed
 * guess at one account). Any of the three reaching its limit blocks further
 * attempts until its window ends. Counters live in memory: fine for the single
 * backend instance DetectKB runs as.
 */

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const LOGIN_LIMITS = {
  ipUser: 10,
  ip: 30,
  user: 100,
} as const;

type Scope = keyof typeof LOGIN_LIMITS;

export class LoginThrottle {
  private failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private limits: Record<Scope, number> = LOGIN_LIMITS,
    private windowMs = LOGIN_WINDOW_MS,
    private now: () => number = Date.now
  ) {}

  private keys(ip: string, username: string): Record<Scope, string> {
    const user = username.trim().toLowerCase();
    return { ipUser: `iu|${ip}|${user}`, ip: `i|${ip}`, user: `u|${user}` };
  }

  /** Seconds until the caller may try again, or 0 when not blocked. */
  retryAfter(ip: string, username: string): number {
    const keys = this.keys(ip, username);
    let wait = 0;
    for (const scope of Object.keys(keys) as Scope[]) {
      const entry = this.failures.get(keys[scope]);
      if (!entry) continue;
      if (entry.resetAt <= this.now()) {
        this.failures.delete(keys[scope]);
        continue;
      }
      if (entry.count >= this.limits[scope]) wait = Math.max(wait, Math.ceil((entry.resetAt - this.now()) / 1000));
    }
    return wait;
  }

  recordFailure(ip: string, username: string): void {
    for (const key of Object.values(this.keys(ip, username))) {
      const entry = this.failures.get(key);
      if (!entry || entry.resetAt <= this.now()) this.failures.set(key, { count: 1, resetAt: this.now() + this.windowMs });
      else entry.count += 1;
    }
  }

  /** A successful login clears only that client's counter for that user. */
  recordSuccess(ip: string, username: string): void {
    this.failures.delete(this.keys(ip, username).ipUser);
  }

  prune(): void {
    const now = this.now();
    for (const [key, entry] of this.failures) if (entry.resetAt <= now) this.failures.delete(key);
  }
}

export const PASSWORD_MIN_LENGTH = 10;
// bcrypt ignores everything after 72 bytes; reject longer passwords instead of silently truncating
export const PASSWORD_MAX_BYTES = 72;

/** Why a new password is not acceptable, or null when it is. */
export function passwordProblem(password: unknown, username?: string): string | null {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return `Password must be at most ${PASSWORD_MAX_BYTES} bytes`;
  const user = username?.trim().toLowerCase();
  if (user && user.length >= 3 && password.toLowerCase().includes(user)) return 'Password must not contain the username';
  if (new Set(password).size < 4) return 'Password is too repetitive';
  return null;
}

export const BCRYPT_ROUNDS = 12;
