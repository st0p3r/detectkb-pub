import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Camera, Loader2, TrendingUp } from 'lucide-react';
import { apiErrorMessage, getCoverageHistory, takeCoverageSnapshot, type CoverageSnapshot } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

// Fixed order: the colour belongs to the measure, whichever are shown
const SERIES: { key: 'deployed' | 'withLogs' | 'validated'; label: string; hint: string; color: string }[] = [
  { key: 'deployed', label: 'Deployed', hint: 'Techniques with a production or testing rule', color: 'var(--series-1)' },
  { key: 'withLogs', label: 'With logs', hint: 'Techniques with a deployed rule whose logs are collected', color: 'var(--series-2)' },
  { key: 'validated', label: 'Proven in lab', hint: 'Techniques with a deployed rule that fired in a lab test', color: 'var(--series-3)' },
];

const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: CoverageSnapshot }[] }) {
  const s = active ? payload?.[0]?.payload : null;
  if (!s) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-medium mb-1">
        {new Date(`${s.day}T00:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
      </div>
      {SERIES.filter((x) => s[x.key] !== null).map((x) => (
        <div key={x.key} className="flex items-center gap-2">
          <span className="w-2.5 h-0.5 rounded" style={{ background: x.color }} />
          <span className="text-muted-foreground">{x.label}</span>
          <span className="ml-auto pl-4 font-medium tabular-nums">
            {s[x.key]} / {s.totalTechniques}
          </span>
        </div>
      ))}
      <div className="mt-1 pt-1 border-t border-border text-muted-foreground">
        {s.rules.total.toLocaleString()} rules · ATT&CK v{s.attackVersion}
      </div>
    </div>
  );
}

/** Coverage over time, from the daily snapshots. */
export function CoverageTrend() {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [days, setDays] = useState(90);
  const [table, setTable] = useState(false);
  const { data = [], isLoading } = useQuery({ queryKey: ['coverage-history', days], queryFn: () => getCoverageHistory(days) });
  const snapshot = useMutation({
    mutationFn: takeCoverageSnapshot,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['coverage-history'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Today\'s coverage saved', 'success');
    },
    onError: (err) => toast(apiErrorMessage(err, 'Could not save the snapshot'), 'error'),
  });

  const series = SERIES.filter((s) => data.some((d) => d[s.key] !== null));
  const first = data[0];
  const last = data[data.length - 1];
  const change = first && last && first !== last ? last.deployed - first.deployed : null;

  return (
    <div className="mb-5 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <TrendingUp className="w-4 h-4 text-muted-foreground" /> Coverage over time
        </span>
        {change !== null && (
          <span className="text-xs text-muted-foreground">
            <b className="text-foreground tabular-nums">
              {change > 0 ? '+' : ''}
              {change}
            </b>{' '}
            deployed technique{Math.abs(change) === 1 ? '' : 's'} since {shortDay(first.day)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden text-xs" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                aria-pressed={days === r.days}
                className={cn('px-2.5 py-1', days === r.days ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={() => setTable((t) => !t)} aria-pressed={table} className="px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent">
            {table ? 'Chart' : 'Table'}
          </button>
          {hasPermission('rules:update') && (
            <button
              onClick={() => snapshot.mutate()}
              disabled={snapshot.isPending}
              title="Save today's numbers now (they are also saved automatically every day)"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent disabled:opacity-50"
            >
              {snapshot.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} Snapshot now
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : data.length < 2 ? (
        <p className="py-4 text-sm text-muted-foreground">
          {data.length === 0 ? 'No snapshot yet.' : `One snapshot so far (${shortDay(data[0].day)}: ${data[0].deployed} of ${data[0].totalTechniques} techniques deployed).`}{' '}
          DetectKB saves the coverage numbers once a day; the trend appears from the second day.
        </p>
      ) : table ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground sticky top-0 bg-card">
              <tr>
                <th className="text-left font-medium py-1">Day</th>
                {series.map((s) => (
                  <th key={s.key} className="text-right font-medium py-1">{s.label}</th>
                ))}
                <th className="text-right font-medium py-1">Techniques</th>
                <th className="text-right font-medium py-1">Rules</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...data].reverse().map((d) => (
                <tr key={d.day}>
                  <td className="py-1">{d.day}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 text-right tabular-nums">{d[s.key] ?? '—'}</td>
                  ))}
                  <td className="py-1 text-right tabular-nums text-muted-foreground">{d.totalTechniques}</td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">{d.rules.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1 text-xs text-muted-foreground">
            {series.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5" title={s.hint}>
                <span className="w-3 h-0.5 rounded" style={{ background: s.color }} /> {s.label}
              </span>
            ))}
            <span className="ml-auto">techniques covered, of {last.totalTechniques}</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} minTickGap={40} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} domain={[0, 'auto']} />
              <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }} />
              {series.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={data.length <= 14 ? { r: 2.5, fill: s.color, strokeWidth: 0 } : false} activeDot={{ r: 4, stroke: 'hsl(var(--card))', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
