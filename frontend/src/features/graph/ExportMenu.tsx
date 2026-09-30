import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ImageDown, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { exportPng, exportSvg } from './exportView';

/** Export the current graph view as PNG, or as vector SVG where the view is SVG. */
export function ExportMenu({ view, vector }: { view: string; vector: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const name = (ext: string) => `detectkb-graph-${view}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  async function run(kind: 'png' | 'svg') {
    setOpen(false);
    setBusy(true);
    try {
      if (kind === 'png') await exportPng(name('png'));
      else exportSvg(name('svg'));
    } catch (err) {
      toast((err as Error).message || 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Save this view as an image"
        className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageDown className="w-4 h-4" />}
        Export
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-60 z-30 rounded-md border border-border bg-card shadow-lg py-1 text-sm">
          <button role="menuitem" onClick={() => run('png')} className="w-full text-left px-3 py-2 hover:bg-accent">
            PNG image
            <span className="block text-xs text-muted-foreground">2× resolution, whole view</span>
          </button>
          <button
            role="menuitem"
            onClick={() => run('svg')}
            disabled={!vector}
            className="w-full text-left px-3 py-2 hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
          >
            SVG (vector)
            <span className="block text-xs text-muted-foreground">{vector ? 'Scales without blur; edit in Inkscape / Illustrator' : 'Only for the Flows view'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
