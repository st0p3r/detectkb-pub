import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileUp, Loader2, X } from 'lucide-react';
import { apiErrorMessage, getSigmaTargets, importSigma, type SigmaImportResult } from '@/lib/api';

interface SigmaImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

/** Imports Sigma rules from .yml files or pasted YAML and converts them to a query. */
export function SigmaImportDialog({ open, onClose, onImported }: SigmaImportDialogProps) {
  const { data: targetInfo } = useQuery({
    queryKey: ['sigma-targets'],
    queryFn: getSigmaTargets,
    staleTime: 60_000,
    enabled: open,
  });
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);
  const [pasted, setPasted] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [convertTo, setConvertTo] = useState('splunk');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SigmaImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setPasted('');
    setError(null);
    setResult(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const read = await Promise.all(
      Array.from(list).map(async (f) => ({ name: f.name, content: await f.text() }))
    );
    setFiles((prev) => [...prev, ...read]);
  }

  async function handleImport() {
    const payload = [...files];
    if (pasted.trim()) payload.push({ name: 'pasted YAML', content: pasted });
    if (!payload.length) return;
    setLoading(true);
    setError(null);
    try {
      const res = await importSigma({
        files: payload,
        overwrite,
        convertTo: convertTo === 'none' ? null : convertTo,
      });
      setResult(res);
      if (res.created.length || res.updated.length) onImported();
    } catch (err) {
      setError(apiErrorMessage(err, 'Import failed'));
    } finally {
      setLoading(false);
    }
  }

  const serviceAvailable = targetInfo?.available !== false;

  // Portal: the page wrapper's transform animation would otherwise trap `position: fixed`
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="sigma-import-title">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 id="sigma-import-title" className="text-lg font-semibold">Import Sigma rules</h2>
            <p className="text-sm text-muted-foreground">
              Each rule becomes a detection page. Rules with an existing Sigma id are skipped unless you choose to update them.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-accent">
            <X className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          <ImportSummary result={result} onClose={onClose} />
        ) : (
          <div className="space-y-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInput.current?.click()}
              className="flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-md border-2 border-dashed border-border hover:border-primary/60 cursor-pointer text-sm text-muted-foreground"
            >
              <FileUp className="w-6 h-6" />
              Drop .yml files here or click to choose
              <input
                ref={fileInput}
                type="file"
                accept=".yml,.yaml"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            {files.length > 0 && (
              <ul className="text-sm space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-1.5 rounded bg-muted/50">
                    <span className="font-mono truncate">{f.name}</span>
                    <button
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={`Remove ${f.name}`}
                      className="p-0.5 rounded hover:bg-accent"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div>
              <label className="block text-sm font-medium mb-1.5">…or paste YAML (separate rules with ---)</label>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={6}
                spellCheck={false}
                className="w-full px-3 py-2 rounded-md border border-border bg-zinc-900 text-zinc-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
              />
            </div>

            <div className="flex flex-wrap gap-4 items-center text-sm">
              <label className="flex items-center gap-2">
                Generate query:
                <select
                  value={serviceAvailable ? convertTo : 'none'}
                  onChange={(e) => setConvertTo(e.target.value)}
                  disabled={!serviceAvailable}
                  className="px-2 py-1 rounded-md border border-border bg-background"
                >
                  <option value="splunk">SPL (Splunk)</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                Update rules that were already imported
              </label>
            </div>
            {!serviceAvailable && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                The Sigma conversion service is not running — rules will be imported without an SPL query.
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-md border border-border text-sm hover:bg-accent">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={loading || (!files.length && !pasted.trim())}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Import
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function ImportSummary({ result, onClose }: { result: SigmaImportResult; onClose: () => void }) {
  const sections: { label: string; items: React.ReactNode[]; tone: string }[] = [
    {
      label: 'Created',
      tone: 'text-emerald-600 dark:text-emerald-400',
      items: result.created.map((r) => (
        <Link key={r.slug} to={`/pages/${r.slug}`} onClick={onClose} className="hover:underline">
          {r.title}
        </Link>
      )),
    },
    {
      label: 'Updated',
      tone: 'text-blue-600 dark:text-blue-400',
      items: result.updated.map((r) => (
        <Link key={r.slug} to={`/pages/${r.slug}`} onClick={onClose} className="hover:underline">
          {r.title}
        </Link>
      )),
    },
    { label: 'Skipped', tone: 'text-muted-foreground', items: result.skipped.map((s) => `${s.title} — ${s.reason}`) },
    { label: 'Errors', tone: 'text-destructive', items: result.errors.map((e) => `${e.file}: ${e.error}`) },
    { label: 'Warnings', tone: 'text-amber-600 dark:text-amber-400', items: result.warnings },
  ];

  return (
    <div className="space-y-4">
      {sections
        .filter((s) => s.items.length)
        .map((s) => (
          <div key={s.label}>
            <h3 className={`text-sm font-semibold mb-1 ${s.tone}`}>
              {s.label} ({s.items.length})
            </h3>
            <ul className="text-sm space-y-0.5 list-disc pl-5 max-h-48 overflow-y-auto">
              {s.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      <div className="flex justify-end">
        <button onClick={onClose} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
          Done
        </button>
      </div>
    </div>
  );
}
