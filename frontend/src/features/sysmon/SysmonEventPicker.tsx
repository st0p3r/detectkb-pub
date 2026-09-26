import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { listSysmonEvents, type PageSysmonLink } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SysmonEventPickerProps {
  /** Manually selected Sysmon event numbers. */
  selected: number[];
  onChange: (eventIds: number[]) => void;
  /** Links detected automatically at last save (shown, not toggleable). */
  autoLinks: PageSysmonLink[];
}

/** Lets a rule / data source declare which Sysmon events it depends on. */
export function SysmonEventPicker({ selected, onChange, autoLinks }: SysmonEventPickerProps) {
  const { data: events = [] } = useQuery({ queryKey: ['sysmon-events'], queryFn: () => listSysmonEvents() });
  const auto = new Set(autoLinks.filter((l) => l.source === 'auto').map((l) => l.sysmonEvent.eventId));

  function toggle(eventId: number) {
    onChange(selected.includes(eventId) ? selected.filter((id) => id !== eventId) : [...selected, eventId].sort((a, b) => a - b));
  }

  return (
    <div className="mt-6 rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30">
        <h2 className="text-sm font-semibold text-foreground">Sysmon events</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Events this page depends on. Links are also detected automatically from the SPL query / Sigma logsource
          (e.g. <code>EventCode=10</code> with Sysmon, or <code>category: process_access</code>) when you save.
        </p>
      </div>
      <div className="px-5 py-4 flex flex-wrap gap-1.5">
        {events.map((e) => {
          const isAuto = auto.has(e.eventId);
          const isManual = selected.includes(e.eventId);
          return (
            <button
              key={e.eventId}
              type="button"
              onClick={() => toggle(e.eventId)}
              title={isAuto ? `${e.name} — detected automatically` : e.name}
              aria-pressed={isManual}
              className={cn(
                'px-2 py-1 rounded-md border text-xs transition-colors',
                isManual
                  ? 'bg-primary text-primary-foreground border-primary'
                  : isAuto
                    ? 'bg-primary/10 text-primary border-primary/40 border-dashed'
                    : 'border-border text-muted-foreground hover:bg-accent'
              )}
            >
              <span className="font-mono font-semibold">{e.eventId}</span> {e.name}
              {isAuto && !isManual && <span className="ml-1 opacity-70">(auto)</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
