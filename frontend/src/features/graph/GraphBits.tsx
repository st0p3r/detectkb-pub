import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useClickOutside } from '@/hooks/useClickOutside';

/** A button opening a checklist ("Layers · 2"). */
export function CheckMenu({
  label,
  icon: Icon,
  options,
  value,
  onToggle,
}: {
  label: string;
  icon?: React.ElementType;
  options: { id: string; label: string; color?: string; hint?: string }[];
  value: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-background text-sm', value.length ? 'border-primary/50' : 'border-border')}
      >
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
        {label}
        {value.length > 0 && <span className="px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-medium tabular-nums">{value.length}</span>}
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-60 max-h-80 overflow-y-auto rounded-md border border-border bg-popover p-1.5 shadow-lg">
          {options.map((o) => (
            <label key={o.id} title={o.hint} className="flex items-center gap-2 px-2 py-1 rounded text-sm cursor-pointer hover:bg-accent">
              <input type="checkbox" checked={value.includes(o.id)} onChange={() => onToggle(o.id)} />
              {o.color && <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: o.color }} />}
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export interface PickOption {
  id: string;
  label: string;
  color: string;
  /** Shown on the right: the kind of node, a count */
  note?: string;
}

/**
 * A search box with a result list driven by the keyboard (↑ ↓ Enter Esc).
 * The caller supplies the results for the current text.
 */
export function NodeSearch({
  value,
  onChange,
  options,
  onPick,
  placeholder,
  ariaLabel,
  empty,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: PickOption[];
  onPick: (id: string) => void;
  placeholder: string;
  ariaLabel: string;
  /** Said when the text matches nothing */
  empty?: string;
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => setActive(0), [value, options.length]);
  const show = open && value.trim().length >= 2;

  function pick(id: string) {
    onPick(id);
    onChange('');
    setOpen(false);
  }

  return (
    <div className={cn('relative', className)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && options[active]) {
            e.preventDefault();
            pick(options[active].id);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        dir="auto"
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={show}
        aria-controls="node-search-results"
        className="w-full pl-9 pr-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      {show && (
        <ul id="node-search-results" ref={listRef} role="listbox" className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg py-1 text-sm">
          {options.length === 0 && <li className="px-3 py-2 text-muted-foreground">{empty ?? 'Nothing found'}</li>}
          {options.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === active}>
              <button
                // mousedown: before the input loses focus and the list closes
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.id);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn('w-full text-left px-3 py-1.5 flex items-center gap-2', i === active ? 'bg-accent' : '')}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: o.color }} />
                <span dir="auto" className="truncate flex-1">{o.label}</span>
                {o.note && <span className="text-xs text-muted-foreground shrink-0">{o.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A legend entry that also switches its kind of node on and off. */
export function GroupChip({ label, color, count, active, onClick, square }: { label: string; color: string; count?: number; active: boolean; onClick: () => void; square?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={active ? `Hide ${label}` : `Show ${label}`}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors',
        active ? 'border-border bg-card' : 'border-dashed border-border text-muted-foreground line-through decoration-muted-foreground/50'
      )}
    >
      <span className={cn('w-2.5 h-2.5', square ? 'rounded-sm' : 'rounded-full', !active && 'opacity-40')} style={{ backgroundColor: color }} />
      {label}
      {count !== undefined && <span className="tabular-nums text-muted-foreground">{count}</span>}
    </button>
  );
}
