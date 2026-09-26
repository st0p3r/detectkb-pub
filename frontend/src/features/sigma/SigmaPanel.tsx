import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, Check, Copy, Loader2, Wand2 } from 'lucide-react';
import { apiErrorMessage, convertSigma, getSigmaTargets, type SigmaConversion } from '@/lib/api';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
      className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

interface SigmaPanelProps {
  sigmaYaml: string;
  /** Editor mode: the YAML is editable. */
  onChange?: (yaml: string) => void;
  /** Editor mode: offer to copy a Splunk conversion into the rule's SPL query. */
  onUseAsSpl?: (spl: string) => void;
}

/** Sigma source editor/viewer with pySigma conversion to SPL, KQL, EQL and Lucene. */
export function SigmaPanel({ sigmaYaml, onChange, onUseAsSpl }: SigmaPanelProps) {
  const { data: targetInfo } = useQuery({ queryKey: ['sigma-targets'], queryFn: getSigmaTargets, staleTime: 60_000 });
  const targets = targetInfo?.targets ?? [];
  const [target, setTarget] = useState('splunk');
  const [result, setResult] = useState<SigmaConversion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [sigmaYaml, target]);

  async function handleConvert() {
    setConverting(true);
    setError(null);
    try {
      setResult(await convertSigma(sigmaYaml, target));
    } catch (err) {
      setError(apiErrorMessage(err, 'Conversion failed'));
    } finally {
      setConverting(false);
    }
  }

  const query = result?.queries.join('\n\n') ?? '';

  return (
    <div className="space-y-3">
      {onChange ? (
        <textarea
          value={sigmaYaml}
          onChange={(e) => onChange(e.target.value)}
          rows={14}
          spellCheck={false}
          placeholder={'title: Suspicious LSASS access\nlogsource:\n  category: process_access\n  product: windows\ndetection:\n  selection:\n    TargetImage|endswith: \\lsass.exe\n  condition: selection\nlevel: high'}
          className="w-full px-3 py-3 rounded-md border border-border bg-zinc-900 text-zinc-100 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
        />
      ) : (
        <div className="relative">
          <pre className="px-3 py-3 rounded-md bg-zinc-900 text-zinc-100 text-xs font-mono overflow-x-auto max-h-96">
            {sigmaYaml}
          </pre>
          <CopyButton text={sigmaYaml} />
        </div>
      )}

      {targetInfo && !targetInfo.available ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          The Sigma conversion service is not running, so queries can't be generated.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Conversion target"
            className="px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.language} — {t.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleConvert}
            disabled={converting || !sigmaYaml.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {converting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            Convert
          </button>
        </div>
      )}

      {error && <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>}

      {result && (
        <div className="space-y-2">
          {!result.pipelineApplied && (
            <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              No field mapping exists for this log source on {result.target.label}; the query uses the raw Sigma
              field names and may need adjusting.
            </p>
          )}
          <div className="relative">
            <pre className="px-3 py-3 pr-20 rounded-md bg-zinc-900 text-emerald-200 text-xs font-mono whitespace-pre-wrap break-all">
              {query}
            </pre>
            <CopyButton text={query} />
          </div>
          {onUseAsSpl && result.target.id === 'splunk' && (
            <button
              type="button"
              onClick={() => onUseAsSpl(query)}
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ArrowDownToLine className="w-4 h-4" />
              Use as this rule's SPL query
            </button>
          )}
        </div>
      )}
    </div>
  );
}
