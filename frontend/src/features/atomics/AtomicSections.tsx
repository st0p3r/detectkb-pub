import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiErrorMessage, getRuleAtomics, getTechniqueAtomics } from '@/lib/api';
import { EXECUTOR_LABEL, PLATFORM_LABEL } from '@/lib/atomicMatch';
import { CopyText, MatchBadge } from './AtomicTestsPage';

const PREVIEW = 8;

/** The atomic tests of a technique (and its sub-techniques), for the ATT&CK coverage panel. */
export function TechniqueAtomics({ id, className }: { id: string; className: string }) {
  const { data } = useQuery({ queryKey: ['atomics-technique', id], queryFn: () => getTechniqueAtomics(id) });
  const [all, setAll] = useState(false);
  if (!data) return null;
  const tests = all ? data.tests : data.tests.slice(0, PREVIEW);
  const seen = data.tests.filter((t) => t.rules.telemetry > 0).length;
  return (
    <div>
      <h3 className={className}>
        Atomic Red Team tests ({data.tests.length}
        {data.tests.length > 0 && `, ${seen} seen by a rule`})
      </h3>
      {data.tests.length === 0 ? (
        <p className="text-sm text-muted-foreground">None for this technique.</p>
      ) : (
        <ul className="space-y-0.5">
          {tests.map((t) => (
            <li key={t.guid} className="flex items-baseline gap-2 text-sm min-w-0">
              <Link to={`/atomic-tests?test=${t.guid}`} className="text-primary hover:underline truncate" title={t.name}>
                {t.techniqueId !== id && <span className="font-mono text-xs text-muted-foreground mr-1">{t.techniqueId}</span>}
                {t.name}
              </Link>
              <span className="text-[11px] text-muted-foreground shrink-0">{t.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(', ')}</span>
              <span className="ml-auto shrink-0">
                {t.rules.telemetry ? <MatchBadge match="telemetry" count={t.rules.telemetry} /> : <span className="text-[11px] text-amber-600 dark:text-amber-400">no rule sees it</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-3 mt-1">
        {data.tests.length > tests.length && (
          <button onClick={() => setAll(true)} className="text-xs text-primary hover:underline">
            +{data.tests.length - tests.length} more
          </button>
        )}
        {data.tests.length > 0 && (
          <Link to={`/atomic-tests?technique=${id}`} className="text-xs text-primary hover:underline">
            Open in Atomic Red Team
          </Link>
        )}
      </div>
    </div>
  );
}

/** The atomic tests that exercise a rule's techniques, and whether each should trigger it. */
export function RuleAtomics({ pageId }: { pageId: number }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['atomics-rule', pageId], queryFn: () => getRuleAtomics(pageId) });
  const [all, setAll] = useState(false);
  if (isLoading) return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  if (error || !data) return <p className="text-sm text-destructive">{apiErrorMessage(error, 'Could not load the tests')}</p>;
  if (!data.techniques.length) return <p className="text-sm text-muted-foreground">The rule has no ATT&CK technique, so no test can be matched to it.</p>;
  if (!data.tests.length) return <p className="text-sm text-muted-foreground">No Atomic Red Team test for {data.techniques.join(', ')}.</p>;
  const tests = all ? data.tests : data.tests.slice(0, PREVIEW);
  const best = data.tests.find((t) => t.match === 'telemetry');
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Tests for {data.techniques.join(', ')}. "Sees its telemetry" means the rule reads an event the test should produce — run the test in a lab to
        prove the rule fires.
      </p>
      {best && (
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 text-xs font-mono bg-muted/60 border border-border rounded px-2 py-1 overflow-x-auto whitespace-nowrap">{best.invoke}</code>
          <CopyText text={best.invoke} />
        </div>
      )}
      <ul className="space-y-1">
        {tests.map((t) => (
          <li key={t.guid} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <Link to={`/atomic-tests?test=${t.guid}`} className="text-primary hover:underline">
              <span className="font-mono text-xs text-muted-foreground mr-1">
                {t.techniqueId}#{t.testNumber}
              </span>
              {t.name}
            </Link>
            <span className="text-[11px] text-muted-foreground">
              {t.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(', ')} · {EXECUTOR_LABEL[t.executor] ?? t.executor}
            </span>
            <MatchBadge match={t.match} />
            {t.sharedTelemetry.length > 0 && <span className="text-[11px] font-mono text-muted-foreground">{t.sharedTelemetry.join(', ')}</span>}
          </li>
        ))}
      </ul>
      {data.tests.length > tests.length && (
        <button onClick={() => setAll(true)} className="text-xs text-primary hover:underline">
          +{data.tests.length - tests.length} more
        </button>
      )}
    </div>
  );
}
