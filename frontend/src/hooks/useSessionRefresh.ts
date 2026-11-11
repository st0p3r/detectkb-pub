import { useEffect } from 'react';
import { refreshSession } from '@/lib/api';

const EVERY_MS = 20 * 60 * 1000;

/**
 * Renews the session while the app is open and in use, so a long edit doesn't
 * end with a sign-out when the token of the morning expires.
 */
export function useSessionRefresh() {
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < EVERY_MS) return;
      last = Date.now();
      // A failure is not an error here: the next request that needs the session says so
      refreshSession().catch(() => {});
    };
    const timer = window.setInterval(refresh, 60 * 1000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
}
