import { describe, expect, it } from 'vitest';
import { LoginThrottle, passwordProblem } from '../src/lib/auth-security';

function throttle(limits = { ipUser: 3, ip: 5, user: 8 }) {
  let now = 1_000_000;
  const t = new LoginThrottle(limits, 60_000, () => now);
  return { t, advance: (ms: number) => (now += ms) };
}

describe('LoginThrottle', () => {
  it('blocks one IP guessing one account', () => {
    const { t } = throttle();
    for (let i = 0; i < 3; i++) t.recordFailure('1.1.1.1', 'admin');
    expect(t.retryAfter('1.1.1.1', 'admin')).toBeGreaterThan(0);
    // the same user from another IP is not yet blocked
    expect(t.retryAfter('2.2.2.2', 'admin')).toBe(0);
  });

  it('treats usernames case-insensitively', () => {
    const { t } = throttle();
    for (const u of ['Admin', 'ADMIN', ' admin ']) t.recordFailure('1.1.1.1', u);
    expect(t.retryAfter('1.1.1.1', 'admin')).toBeGreaterThan(0);
  });

  it('blocks one IP spraying many usernames', () => {
    const { t } = throttle();
    for (let i = 0; i < 5; i++) t.recordFailure('1.1.1.1', `user${i}`);
    expect(t.retryAfter('1.1.1.1', 'someone-else')).toBeGreaterThan(0);
    expect(t.retryAfter('9.9.9.9', 'someone-else')).toBe(0);
  });

  it('blocks many IPs guessing one account', () => {
    const { t } = throttle();
    for (let i = 0; i < 8; i++) t.recordFailure(`10.0.0.${i}`, 'admin');
    expect(t.retryAfter('10.0.0.200', 'admin')).toBeGreaterThan(0);
  });

  it('forgets failures after the window', () => {
    const { t, advance } = throttle();
    for (let i = 0; i < 3; i++) t.recordFailure('1.1.1.1', 'admin');
    advance(60_001);
    expect(t.retryAfter('1.1.1.1', 'admin')).toBe(0);
  });

  it('a success clears only that client/user counter', () => {
    const { t } = throttle();
    for (let i = 0; i < 2; i++) t.recordFailure('1.1.1.1', 'admin');
    for (let i = 0; i < 3; i++) t.recordFailure('1.1.1.1', `x${i}`);
    t.recordSuccess('1.1.1.1', 'admin');
    // 5 failures from the IP still count toward the IP limit
    expect(t.retryAfter('1.1.1.1', 'admin')).toBeGreaterThan(0);
  });
});

describe('passwordProblem', () => {
  it('accepts a reasonable password', () => {
    expect(passwordProblem('Correct-Horse-7', 'alice')).toBeNull();
  });
  it.each([
    ['short1', 'at least'],
    ['aaaaaaaaaaaa', 'repetitive'],
    ['my-alice-password', 'username'],
    ['x'.repeat(40) + 'é'.repeat(20), 'at most'],
  ])('rejects %s', (pw, msg) => {
    expect(passwordProblem(pw, 'alice')).toContain(msg);
  });
  it('rejects non-strings', () => {
    expect(passwordProblem({ $ne: '' })).not.toBeNull();
  });
});
