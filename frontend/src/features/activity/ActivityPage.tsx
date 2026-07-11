import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Activity, TrendingUp, Users, AlertCircle, CheckCircle, Clock, Shield } from 'lucide-react';
import { getActivityStats } from '@/lib/api';

const DAYS_OPTIONS = [7, 14, 30, 60] as const;

const ACTION_COLORS: Record<string, string> = {
  LOGIN_SUCCESS: '#22c55e',
  LOGIN_FAILURE: '#ef4444',
  CREATE:        '#6366f1',
  UPDATE:        '#f59e0b',
  DELETE:        '#ec4899',
  VIEW:          '#0ea5e9',
  EXPORT:        '#a855f7',
};

function getActionColor(action: string) {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.includes(key)) return color;
  }
  return '#94a3b8';
}

function StatCard({ icon: Icon, label, value, color, index }: {
  icon: React.ElementType; label: string; value: number | string; color: string; index: number;
}) {
  return (
    <div className={`bg-card rounded-xl border border-border/60 p-5 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 animate-fade-in-up stagger-${index}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}20` }}>
          <Icon className="w-4.5 h-4.5" style={{ color }} />
        </div>
      </div>
      <p className="text-3xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="font-semibold text-foreground">{p.value} logins</p>
      ))}
    </div>
  );
}

export function ActivityPage() {
  const [days, setDays] = useState<typeof DAYS_OPTIONS[number]>(30);

  const { data, isLoading } = useQuery({
    queryKey: ['activity-stats', days],
    queryFn: () => getActivityStats(days),
    staleTime: 60_000,
  });

  const summary = data?.summary;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 animate-fade-in-up">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-900/30">
          <Activity className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">User Activity</h1>
          <p className="text-muted-foreground text-sm">Login history and action breakdown for all users</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {DAYS_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${days === d ? 'bg-indigo-600 text-white shadow-sm' : 'bg-card border border-border text-muted-foreground hover:text-foreground'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={CheckCircle} label="Successful Logins" value={isLoading ? '…' : (summary?.totalLogins ?? 0)} color="#22c55e" index={1} />
        <StatCard icon={AlertCircle} label="Failed Logins" value={isLoading ? '…' : (summary?.failedLogins ?? 0)} color="#ef4444" index={2} />
        <StatCard icon={Activity} label="Total Actions" value={isLoading ? '…' : (summary?.totalActions ?? 0)} color="#6366f1" index={3} />
        <StatCard icon={Users} label="Active Users" value={isLoading ? '…' : (summary?.activeUsers ?? 0)} color="#f59e0b" index={4} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Logins Line Chart */}
        <div className="bg-card rounded-xl border border-border/60 p-5 animate-fade-in-up stagger-2">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h2 className="font-semibold text-foreground">Daily Logins</h2>
          </div>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data?.dailyLogins ?? []} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: string) => v.slice(5)}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#22c55e' }}
                  isAnimationActive
                  animationDuration={800}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Action Breakdown Bar Chart */}
        <div className="bg-card rounded-xl border border-border/60 p-5 animate-fade-in-up stagger-3">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-indigo-400" />
            <h2 className="font-semibold text-foreground">Action Breakdown</h2>
          </div>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
          ) : (data?.actionBreakdown ?? []).length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No actions recorded yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data?.actionBreakdown ?? []} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis
                  dataKey="action"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  angle={-15}
                  interval={0}
                />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={800}>
                  {(data?.actionBreakdown ?? []).map((entry) => (
                    <Cell key={entry.action} fill={getActionColor(entry.action)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Per-user logins */}
      {(data?.userLogins ?? []).length > 0 && (
        <div className="bg-card rounded-xl border border-border/60 p-5 animate-fade-in-up stagger-4">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-amber-400" />
            <h2 className="font-semibold text-foreground">Logins per User</h2>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(120, (data?.userLogins ?? []).length * 36)}>
            <BarChart
              data={data?.userLogins ?? []}
              layout="vertical"
              margin={{ top: 0, right: 10, bottom: 0, left: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
              <YAxis dataKey="username" type="category" tick={{ fontSize: 12, fill: 'hsl(var(--foreground))' }} width={55} />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
              />
              <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={800} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent activity log */}
      <div className="bg-card rounded-xl border border-border/60 p-5 animate-fade-in-up stagger-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-sky-400" />
          <h2 className="font-semibold text-foreground">Recent Activity</h2>
        </div>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading…</div>
        ) : (data?.recentLogs ?? []).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No activity recorded in this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
                  <th className="pb-2 pr-4">Action</th>
                  <th className="pb-2 pr-4">Resource</th>
                  <th className="pb-2 pr-4">User</th>
                  <th className="pb-2 pr-4">IP</th>
                  <th className="pb-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {(data?.recentLogs ?? []).map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-2 pr-4">
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: `${getActionColor(log.action)}20`,
                          color: getActionColor(log.action),
                        }}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">{log.resourceType ?? '—'}</td>
                    <td className="py-2 pr-4 font-medium">{log.username ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">{log.ipAddress ?? '—'}</td>
                    <td className="py-2 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
