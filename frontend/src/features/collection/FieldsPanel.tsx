import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { apiErrorMessage, fieldKey, listRuleFields } from '@/lib/api';
import { useDebounced } from '@/hooks/useDebounced';
import { CollectionControl } from './CollectionControl';

const SOURCE_LABELS: Record<string, string> = { sigma: 'Sigma', spl: 'SPL', native: 'KQL / EQL' };

/**
 * The fields your rules filter on (CommandLine, ParentImage, process.name …),
 * most used first, and whether each is in your events. A rule whose event
 * arrives without the field it filters on never matches.
 */
export function FieldsPanel() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const { data, isLoading, isFetching, error } = useQuery({ queryKey: ['rule-fields', q], queryFn: () => listRuleFields(q), placeholderData: keepPreviousData });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <p className="font-medium">Do your events carry the fields your rules filter on?</p>
        <p className="mt-1 text-muted-foreground max-w-3xl">
          Collecting an event is not enough: Sysmon 1 without <code className="px-1 rounded bg-muted">ParentCommandLine</code>, or a field your SIEM names
          differently, leaves a rule silent. These are the fields read by the detections (Sigma, SPL, KQL / EQL) of your rules. Mark the ones missing from your
          events: the rules reading them are flagged in the rule list, on their runbook and in Data Health.
        </p>
        {data && (
          <p className="mt-2 text-muted-foreground">
            <b className="text-foreground tabular-nums">{data.total}</b> field{data.total === 1 ? '' : 's'} in use
            {data.missing > 0 && (
              <>
                {' · '}
                <Link to="/rules?field=missing" className="text-red-600 dark:text-red-400 hover:underline">
                  <b className="tabular-nums">{data.missing}</b> marked as missing — show the rules reading them
                </Link>
              </>
            )}
          </p>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a field…"
          aria-label="Find a field"
          className="w-full pl-9 pr-9 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        {isFetching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" aria-label="Loading" />}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {isLoading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading fields…
          </p>
        ) : error ? (
          <p className="p-4 text-sm text-destructive">{apiErrorMessage(error, 'Could not load the fields')}</p>
        ) : !data?.fields.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {q ? `No rule reads a field named like “${q}”.` : 'No fields yet: they are read from the Sigma detection, SPL and native query of each rule.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2">Field</th>
                <th className="text-right font-medium px-4 py-2 w-24">Rules</th>
                <th className="text-right font-medium px-4 py-2 w-28">Deployed</th>
                <th className="text-left font-medium px-4 py-2 w-36">Found in</th>
                <th className="text-right font-medium px-4 py-2">In your events?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.fields.map((f) => (
                <tr key={f.field} className={f.state === 'not-collected' ? 'bg-red-500/5' : undefined}>
                  <td className="px-4 py-2 font-mono text-xs break-all">{f.field}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <Link to={`/rules?field=${encodeURIComponent(f.field)}`} className="text-primary hover:underline" title="Rules reading this field">
                      {f.rules}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{f.deployedRules || ''}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{f.sources.map((s) => SOURCE_LABELS[s] ?? s).join(', ')}</td>
                  <td className="px-4 py-1.5 text-right">
                    <CollectionControl telemetryKey={fieldKey(f.field)} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
