import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { searchGraph, type GraphNode } from '@/lib/api';
import { useDebounced } from '@/hooks/useDebounced';
import { useGroupStyle } from './useGroupStyle';

interface NodePickerProps {
  label: string;
  value: GraphNode | null;
  onChange: (node: GraphNode | null) => void;
  placeholder?: string;
}

/** Search box that picks one graph node (technique, rule, tool, event…). */
export function NodePicker({ label, value, onChange, placeholder = 'Technique, rule, tool, event…' }: NodePickerProps) {
  const { colorOf, labelOf } = useGroupStyle();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 200);
  const { data: results = [] } = useQuery({ queryKey: ['graph-search', q], queryFn: () => searchGraph(q), enabled: q.length >= 2 });

  if (value) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-muted-foreground w-10 shrink-0">{label}</span>
        <span className="inline-flex items-center gap-2 min-w-0 pl-2.5 pr-1 py-1 rounded-md border border-border bg-background text-sm">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(value.group) }} />
          <span className="truncate" title={value.label}>{value.label}</span>
          <span className="text-xs text-muted-foreground shrink-0">{labelOf(value.group)}</span>
          <button onClick={() => onChange(null)} aria-label={`Clear ${label}`} className="p-0.5 rounded hover:bg-accent shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-10 shrink-0">{label}</span>
      <div className="relative w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          className="w-full pl-9 pr-3 py-1.5 rounded-md border border-border bg-background text-sm"
        />
        {q.length >= 2 && results.length > 0 && search && (
          <ul className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card shadow-lg py-1 text-sm">
            {results.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    setSearch('');
                    onChange(n);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorOf(n.group) }} />
                  <span className="truncate flex-1">{n.label}</span>
                  <span className="text-xs text-muted-foreground">{labelOf(n.group)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
