import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileUp, FolderUp, Loader2, X } from 'lucide-react';
import {
  SOURCE_FORMAT_LABELS,
  apiErrorMessage,
  getSigmaTargets,
  importRules,
  type RuleSourceFormat,
  type SigmaImportResult,
} from '@/lib/api';

interface RuleImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

const RULE_FILE = /\.(ya?ml|toml)$/i;
// Files per request: keeps request bodies small and shows progress on big repositories
const CHUNK_SIZE = 100;
const LIST_LIMIT = 100;

/**
 * Imports rules from Sigma, Splunk ESCU and Sentinel YAML or Elastic TOML files.
 * Accepts single files, whole folders (e.g. a cloned rules repository) or pasted YAML.
 */
export function RuleImportDialog({ open, onClose, onImported }: RuleImportDialogProps) {
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
  const [statusMode, setStatusMode] = useState<'draft' | 'source'>('draft');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SigmaImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setPasted('');
    setError(null);
    setResult(null);
    setProgress(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !progress && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, progress]);

  useEffect(() => {
    // `webkitdirectory` is not in React's typings
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, [open]);

  if (!open) return null;

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const read = await Promise.all(
      Array.from(list)
        .filter((f) => RULE_FILE.test(f.name))
        .map(async (f) => ({ name: f.webkitRelativePath || f.name, content: await f.text() }))
    );
    setFiles((prev) => [...prev, ...read]);
  }

  async function handleImport() {
    const payload = [...files];
    if (pasted.trim()) payload.push({ name: 'pasted.yml', content: pasted });
    if (!payload.length) return;
    setError(null);
    const total = Math.ceil(payload.length / CHUNK_SIZE);
    const merged: SigmaImportResult = { created: [], updated: [], skipped: [], errors: [], warnings: [] };
    try {
      for (let i = 0; i < total; i++) {
        setProgress({ done: i, total });
        const res = await importRules({
          files: payload.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
          overwrite,
          convertTo: convertTo === 'none' ? null : convertTo,
          status: statusMode,
        });
        for (const key of Object.keys(merged) as (keyof SigmaImportResult)[]) {
          (merged[key] as unknown[]).push(...(res[key] as unknown[]));
        }
      }
      setResult(merged);
    } catch (err) {
      setError(apiErrorMessage(err, 'Import failed'));
      if (merged.created.length || merged.updated.length) setResult(merged);
    } finally {
      setProgress(null);
      if (merged.created.length || merged.updated.length) onImported();
    }
  }

  const serviceAvailable = targetInfo?.available !== false;
  const busy = progress !== null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="rule-import-title">
      <div className="absolute inset-0 bg-black/50" onClick={() => !busy && onClose()} />
      <div className="relative z-10 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 id="rule-import-title" className="text-lg font-semibold">Import detection rules</h2>
            <p className="text-sm text-muted-foreground">
              Sigma, Splunk ESCU and Microsoft Sentinel <code>.yml</code>, or Elastic detection-rules <code>.toml</code>.
              The format is detected per file; a rule already imported (same source id) is skipped unless you update it.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-1 rounded hover:bg-accent disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          <ImportSummary result={result} onClose={onClose} error={error} />
        ) : (
          <div className="space-y-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              className="grid sm:grid-cols-2 gap-2"
            >
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex flex-col items-center justify-center gap-2 px-4 py-5 rounded-md border-2 border-dashed border-border hover:border-primary/60 text-sm text-muted-foreground"
              >
                <FileUp className="w-6 h-6" />
                Choose or drop rule files
              </button>
              <button
                type="button"
                onClick={() => folderInput.current?.click()}
                className="flex flex-col items-center justify-center gap-2 px-4 py-5 rounded-md border-2 border-dashed border-border hover:border-primary/60 text-sm text-muted-foreground"
              >
                <FolderUp className="w-6 h-6" />
                Choose a folder (e.g. a cloned rules repository)
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".yml,.yaml,.toml"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={folderInput}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {files.length > 0 && (
              <div className="flex items-center justify-between text-sm px-3 py-2 rounded bg-muted/50">
                <span>
                  <strong>{files.length}</strong> rule file{files.length === 1 ? '' : 's'} selected
                  {files.length <= 3 && <span className="text-muted-foreground"> — {files.map((f) => f.name).join(', ')}</span>}
                </span>
                <button onClick={() => setFiles([])} className="text-xs text-muted-foreground hover:underline">
                  Clear
                </button>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1.5">…or paste YAML (separate rules with ---)</label>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={5}
                spellCheck={false}
                className="w-full px-3 py-2 rounded-md border border-border bg-zinc-900 text-zinc-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="font-medium">Status of imported rules</span>
                <select
                  value={statusMode}
                  onChange={(e) => setStatusMode(e.target.value as 'draft' | 'source')}
                  className="px-2 py-1.5 rounded-md border border-border bg-background"
                >
                  <option value="draft">Draft (until tested here)</option>
                  <option value="source">Keep the source's status</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium">Sigma rules: generate</span>
                <select
                  value={serviceAvailable ? convertTo : 'none'}
                  onChange={(e) => setConvertTo(e.target.value)}
                  disabled={!serviceAvailable}
                  className="px-2 py-1.5 rounded-md border border-border bg-background"
                >
                  <option value="splunk">SPL (Splunk)</option>
                  <option value="none">No query</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              Update rules that were already imported
            </label>

            {!serviceAvailable && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                The Sigma conversion service is not running — Sigma rules will be imported without an SPL query.
              </p>
            )}

            {progress && (
              <div>
                <div className="h-2 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Importing batch {progress.done + 1} of {progress.total}…
                </p>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={busy || (!files.length && !pasted.trim())}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
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

function countByFormat(items: { format?: RuleSourceFormat }[]) {
  const counts = new Map<string, number>();
  for (const i of items) {
    const label = i.format ? SOURCE_FORMAT_LABELS[i.format] : 'Other';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts, ([label, n]) => `${label}: ${n}`).join(' · ');
}

function ImportSummary({ result, onClose, error }: { result: SigmaImportResult; onClose: () => void; error: string | null }) {
  const pageLink = (r: { title: string; slug: string }) => (
    <Link key={r.slug} to={`/pages/${r.slug}`} onClick={onClose} className="hover:underline">
      {r.title}
    </Link>
  );
  const sections: { label: string; hint?: string; items: React.ReactNode[]; tone: string }[] = [
    { label: 'Created', hint: countByFormat(result.created), tone: 'text-emerald-600 dark:text-emerald-400', items: result.created.map(pageLink) },
    { label: 'Updated', hint: countByFormat(result.updated), tone: 'text-blue-600 dark:text-blue-400', items: result.updated.map(pageLink) },
    { label: 'Skipped', tone: 'text-muted-foreground', items: result.skipped.map((s) => `${s.title} — ${s.reason}`) },
    { label: 'Errors', tone: 'text-destructive', items: result.errors.map((e) => `${e.file}: ${e.error}`) },
    { label: 'Warnings', tone: 'text-amber-600 dark:text-amber-400', items: result.warnings },
  ];

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">Stopped early: {error}</p>}
      {sections
        .filter((s) => s.items.length)
        .map((s) => (
          <div key={s.label}>
            <h3 className={`text-sm font-semibold mb-1 ${s.tone}`}>
              {s.label} ({s.items.length}){s.hint && <span className="font-normal text-muted-foreground"> — {s.hint}</span>}
            </h3>
            <ul className="text-sm space-y-0.5 list-disc pl-5 max-h-48 overflow-y-auto">
              {s.items.slice(0, LIST_LIMIT).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
              {s.items.length > LIST_LIMIT && <li className="text-muted-foreground">…and {s.items.length - LIST_LIMIT} more</li>}
            </ul>
          </div>
        ))}
      <p className="text-xs text-muted-foreground">
        Imported rules keep their original source for reference. Queries from other vendors use their data models
        (Splunk CIM, Elastic ECS, Sentinel tables) — check field names and index/source settings before relying on them.
      </p>
      <div className="flex justify-end">
        <button onClick={onClose} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
          Done
        </button>
      </div>
    </div>
  );
}
