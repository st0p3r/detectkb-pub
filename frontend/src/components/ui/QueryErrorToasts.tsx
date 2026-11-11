import { useEffect } from 'react';
import { QUERY_ERROR_EVENT as EVENT } from '@/lib/queryErrors';
import { useToast } from '@/hooks/useToast';

const QUIET_MS = 8000;

/** Shows a toast when data fails to load — once per message for a while, not once per request. */
export function QueryErrorToasts() {
  const { toast } = useToast();
  useEffect(() => {
    const last = new Map<string, number>();
    const onError = (e: Event) => {
      const message = String((e as CustomEvent).detail);
      const now = Date.now();
      if (now - (last.get(message) ?? 0) < QUIET_MS) return;
      last.set(message, now);
      toast(message, 'error');
    };
    window.addEventListener(EVENT, onError);
    return () => window.removeEventListener(EVENT, onError);
  }, [toast]);
  return null;
}
