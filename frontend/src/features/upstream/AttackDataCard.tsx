import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DownloadCloud, Grid3x3, Loader2, RotateCcw, Upload } from 'lucide-react';
import { apiErrorMessage, downloadAttackData, getAttackDataInfo, resetAttackData, uploadAttackData, type AttackImportResult } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/hooks/useToast';
import { relativeTime } from '@/lib/time';

function ImportSummary({ r }: { r: AttackImportResult }) {
  const revoked = Object.entries(r.newlyRevoked);
  return (
    <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1">
      <div className="font-medium text-sm">
        {r.from === r.to ? `ATT&CK v${r.to} imported again` : `ATT&CK v${r.from} → v${r.to}`}
      </div>
      <div>
        Techniques: +{r.techniques.added.length} / −{r.techniques.removed.length}
        {r.techniques.added.length > 0 && <span className="text-muted-foreground"> ({r.techniques.added.slice(0, 12).join(', ')}{r.techniques.added.length > 12 ? ', …' : ''})</span>}
      </div>
      {r.techniques.removed.length > 0 && <div className="text-muted-foreground">Removed: {r.techniques.removed.slice(0, 12).join(', ')}</div>}
      {revoked.length > 0 && (
        <div>
          Newly retired IDs (rules using them now count under the replacement):{' '}
          <span className="font-mono">{revoked.slice(0, 10).map(([a, b]) => `${a}→${b}`).join(', ')}</span>
        </div>
      )}
      <div>
        Groups +{r.groups.added} / −{r.groups.removed} · software +{r.software.added} / −{r.software.removed} · rule mappings changed: {r.ruleMappings.added + r.ruleMappings.removed}
      </div>
    </div>
  );
}

/**
 * The MITRE ATT&CK release in use, and updating it without a new DetectKB
 * version: download MITRE's current release, or upload enterprise-attack.json
 * on servers without internet.
 */
export function AttackDataCard({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<AttackImportResult | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const { data } = useQuery({ queryKey: ['attack-data'], queryFn: getAttackDataInfo });

  const done = (r: AttackImportResult) => {
    setResult(r);
    toast(`ATT&CK v${r.to} is in use`, 'success');
    // Everything ATT&CK-based is recomputed
    qc.invalidateQueries();
  };
  const fail = (err: unknown) => toast(apiErrorMessage(err, 'Could not update ATT&CK'), 'error');
  const download = useMutation({ mutationFn: downloadAttackData, onSuccess: done, onError: fail });
  const upload = useMutation({ mutationFn: uploadAttackData, onSuccess: done, onError: fail });
  const reset = useMutation({
    mutationFn: resetAttackData,
    onSuccess: (info) => {
      setResult(null);
      toast(`Back to the bundled ATT&CK v${info.version}`, 'success');
      qc.invalidateQueries();
    },
    onError: fail,
  });
  const busy = download.isPending || upload.isPending || reset.isPending;

  return (
    <div className="rounded-lg border border-border bg-card p-4 mb-5">
      <div className="flex flex-wrap items-center gap-3">
        <Grid3x3 className="w-5 h-5 text-muted-foreground" />
        <div className="min-w-0">
          <div className="font-medium">MITRE ATT&CK data</div>
          {data && (
            <div className="text-xs text-muted-foreground">
              v{data.version} in use · {data.techniques} techniques, {data.groups} groups, {data.software} malware and tools ·{' '}
              {data.imported
                ? `imported ${relativeTime(data.imported.importedAt)} (${data.imported.source.startsWith('upload') ? 'uploaded file' : 'downloaded from MITRE'}); bundled: v${data.bundledVersion}`
                : 'bundled with DetectKB'}
            </div>
          )}
        </div>
        {canManage && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={() => download.mutate()}
              disabled={busy}
              title={data ? `Download ${data.downloadUrl}` : undefined}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
            >
              {download.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
              Update from MITRE
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              title="For servers without internet: enterprise-attack.json from github.com/mitre-attack/attack-stix-data"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
            >
              {upload.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload STIX file
            </button>
            {data?.imported && (
              <button
                onClick={() => setConfirmReset(true)}
                disabled={busy}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
              >
                {reset.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Use bundled v{data.bundledVersion}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>
      {result && <ImportSummary r={result} />}
      <ConfirmDialog
        open={confirmReset}
        title="Use the bundled ATT&CK data?"
        message={`The imported release is removed and DetectKB goes back to ATT&CK v${data?.bundledVersion} that came with it. Rule mappings are recomputed.`}
        confirmLabel="Use bundled data"
        onConfirm={() => {
          setConfirmReset(false);
          reset.mutate();
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
