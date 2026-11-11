import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCollection, type CollectionState } from '@/lib/api';

/**
 * What the organisation collects, as answered on the Log Sources page. An
 * event follows its source unless it has its own answer.
 */
export function useCollection() {
  const { data } = useQuery({ queryKey: ['collection'], queryFn: getCollection, staleTime: 60 * 1000 });
  return useMemo(() => {
    const map = new Map((data?.entries ?? []).map((e) => [e.key, e]));
    const own = (key: string): CollectionState => {
      const e = map.get(key);
      return e ? (e.collected ? 'collected' : 'not-collected') : 'unknown';
    };
    return {
      active: !!data?.active,
      rules: data?.rules,
      /** The answer given for exactly this key */
      own,
      /** The answer that applies: the key's own, else its source's */
      stateOf: (key: string): CollectionState => {
        const mine = own(key);
        return mine !== 'unknown' || !key.includes(':') ? mine : own(key.slice(0, key.indexOf(':')));
      },
      note: (key: string) => map.get(key)?.note ?? null,
    };
  }, [data]);
}

/** Everything the collection answers change: coverage, impact, the rule list, the dashboard. */
export function useInvalidateCollection() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['collection', 'collection-opportunities', 'rule-collection', 'attack-coverage', 'attack-technique-rules', 'rules', 'dashboard', 'impact', 'watchlist', 'data-health', 'runbook'])
      void qc.invalidateQueries({ queryKey: [key] });
  };
}
