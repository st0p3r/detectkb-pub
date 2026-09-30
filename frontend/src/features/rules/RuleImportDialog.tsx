import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileUp, FolderUp, Loader2, X } from 'lucide-react';
import { ImportReview } from './ImportReview';
import {
  SOURCE_FORMAT_LABELS,
  apiErrorMessage,
  getSigmaTargets,
  importRules,
  previewRuleImport,
  type ImportPreviewItem,
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
  // Review step: the preview, entries the user unticked, and whether to update changed rules
  const [preview, setPreview] = useState<ImportPreviewItem[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [updateChanged, setUpdateChanged] = useState(true);
  const [convertTo, setConvertTo] = useState('splunk');
  const [statusMode, setStatusMode] = useState<'draft' | 'source'>('draft');
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
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
    setPreview(null);
    setExcluded(new Set());
    setUpdateChanged(true);
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

  const payload = () => {
    const all = [...files];
    if (pasted.trim()) all.push({ name: 'pasted.yml', content: pasted });
    return all;
  };

  async function handlePreview() {
    const all = payload();
    if (!all.length) return;
    setError(null);
    const total = Math.ceil(all.length / CHUNK_SIZE);
    const items: ImportPreviewItem[] = [];
    try {
      for (let i = 0; i < total; i++) {
        setProgress({ done: i, total, label: 'Checking' });
        items.push(...(await previewRuleImport(all.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE))).items);
      }
      setExcluded(new Set());
      setPreview(items);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not read the files'));
    } finally {
      setProgress(null);
    }
  }

  async function handleImport() {
    const all = payload();
    if (!all.length) return;
    setError(null);
    const total = Math.ceil(all.length / CHUNK_SIZE);
    const merged: SigmaImportResult = { created: [], updated: [], skipped: [], errors: [], warnings: [] };
    try {
      for (let i = 0; i < total; i++) {
        setProgress({ done: i, total, label: 'Importing' });
        const res = await importRules({
          files: all.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
          overwrite: updateChanged,
          convertTo: convertTo === 'none' ? null : convertTo,
          status: statusMode,
          skip: Array.from(excluded),
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

  const count = (s: ImportPreviewItem['status']) => (preview ?? []).filter((i) => i.status === s && !excluded.has(i.where)).length;
  const toCreate = count('new');
  const toUpdate = updateChanged ? count('changed') : 0;
  const importLabel = !toCreate && !toUpdate ? 'Nothing to import' : [`Import ${toCreate.toLocaleString()} new`, toUpdate ? `update ${toUpdate.toLocaleString()}` : ''].filter(Boolean).join(' · ');

  const serviceAvailable = targetInfo?.available !== false;
  const busy = progress !== null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="rule-import-title">
      <div className="absolute inset-0 bg-black/50" onClick={() => !busy && onClose()} />
      <div className={`relative z-10 w-full ${preview ? 'max-w-4xl' : 'max-w-2xl'} mx-4 max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-xl p-6`}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 id="rule-import-title" className="text-lg font-semibold">Import detection rules</h2>
            <p className="text-sm text-muted-foreground">
              Sigma, Splunk ESCU and Microsoft Sentinel <code>.yml</code>, or Elastic detection-rules <code>.toml</code>.
              The format is detected per file. Next you'll see which rules are new, which changed since they were imported, and
              which are unchanged — before anything is saved.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-1 rounded hover:bg-accent disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          <ImportSummary result={result} onClose={onClose} error={error} />
        ) : preview ? (
          <div className="space-y-4">
            <ImportReview
              items={preview}
              excluded={excluded}
              onExcludedChange={setExcluded}
              updateChanged={updateChanged}
              onUpdateChangedChange={setUpdateChanged}
              onNavigate={onClose}
            />
            {progress && <Progress progress={progress} />}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setPreview(null)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={handleImport}
                disabled={busy || (!toCreate && !toUpdate)}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {importLabel}
              </button>
            </div>
          </div>
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

            {!serviceAvailable && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                The Sigma conversion service is not running — Sigma rules will be imported without an SPL query.
              </p>
            )}

            {progress && <Progress progress={progress} />}
            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={handlePreview}
                disabled={busy || (!files.length && !pasted.trim())}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Review
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function Progress({ progress }: { progress: { done: number; total: number; label: string } }) {
  return (
    <div>
      <div className="h-2 rounded bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {progress.label} batch {progress.done + 1} of {progress.total}…
      </p>
    </div>
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
