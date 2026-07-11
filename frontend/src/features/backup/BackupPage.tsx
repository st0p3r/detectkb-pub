import React, { useEffect, useRef, useState } from 'react';
import { HardDrive, Download, Trash2, Upload, AlertTriangle, RefreshCw } from 'lucide-react';
import { BackupLog, createJsonBackup, listBackups, deleteBackup, restoreFromJson, downloadBackup } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { relativeTime } from '@/lib/time';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupPage() {
  const { toast } = useToast();
  const [backups, setBackups] = useState<BackupLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [backing, setBacking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreResult, setRestoreResult] = useState<{ restored: number; skipped: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Confirm dialogs
  const [deleteTarget, setDeleteTarget] = useState<BackupLog | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const fetchBackups = async () => {
    try {
      const data = await listBackups();
      setBackups(data);
    } catch {
      toast('Failed to load backups', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleBackupNow = async () => {
    setBacking(true);
    try {
      const result = await createJsonBackup();
      toast(`Backup created: ${result.fileName} (${formatBytes(result.sizeBytes)})`, 'success');
      await fetchBackups();
    } catch {
      toast('Backup failed', 'error');
    } finally {
      setBacking(false);
    }
  };

  const handleDownload = async (b: BackupLog) => {
    setDownloadingId(b.id);
    try {
      await downloadBackup(b.fileName);
    } catch {
      toast('Download failed', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget) return;
    try {
      await deleteBackup(deleteTarget.id);
      toast('Backup deleted', 'success');
      setBackups((prev) => prev.filter((b) => b.id !== deleteTarget.id));
    } catch {
      toast('Failed to delete backup', 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleRestore = async () => {
    if (!restoreFile) return;
    setShowRestoreConfirm(false);
    setRestoring(true);
    setRestoreResult(null);
    try {
      const result = await restoreFromJson(restoreFile);
      setRestoreResult(result);
      toast(`Restored ${result.restored} items`, result.errors.length > 0 ? 'info' : 'success');
    } catch {
      toast('Restore failed', 'error');
    } finally {
      setRestoring(false);
    }
  };

  const lastBackup = backups[0];

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <Breadcrumbs items={[{ label: 'Backups' }]} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <HardDrive className="w-6 h-6" />
            Backups
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {lastBackup
              ? `Last backup: ${relativeTime(lastBackup.createdAt)}`
              : 'No backups yet'}
          </p>
        </div>
        <button
          onClick={handleBackupNow}
          disabled={backing}
          aria-label="Create backup now"
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
        >
          {backing ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <HardDrive className="w-4 h-4" />
          )}
          {backing ? 'Backing up...' : 'Backup Now'}
        </button>
      </div>

      {/* Scheduled note */}
      <div className="text-sm text-muted-foreground bg-muted/40 border border-border rounded-md px-4 py-2">
        Automatic daily backup is scheduled.
      </div>

      {/* Backup list */}
      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">File</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Size</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Created</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground" role="status" aria-label="Loading backups">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && backups.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No backups found
                </td>
              </tr>
            )}
            {backups.map((b) => (
              <tr key={b.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-mono text-xs truncate max-w-[240px]">{b.fileName}</td>
                <td className="px-4 py-3">
                  <span className="inline-block px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium uppercase">
                    {b.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatBytes(b.sizeBytes)}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs" title={new Date(b.createdAt).toLocaleString()}>
                  {relativeTime(b.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleDownload(b)}
                      disabled={downloadingId === b.id}
                      aria-label={`Download ${b.fileName}`}
                      title="Download backup"
                      className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
                    >
                      {downloadingId === b.id
                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : <Download className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(b)}
                      aria-label={`Delete ${b.fileName}`}
                      title="Delete backup"
                      className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/50 outline-none"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Restore section */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Restore from File</h2>

        <div className="flex items-start gap-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            This will overwrite existing data with matching slugs. New pages and categories will be created. This action cannot be undone.
          </span>
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm hover:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
          >
            <Upload className="w-4 h-4" />
            {restoreFile ? restoreFile.name : 'Choose JSON file'}
          </button>
          <button
            onClick={() => restoreFile && setShowRestoreConfirm(true)}
            disabled={!restoreFile || restoring}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
          >
            {restoring ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {restoring ? 'Restoring...' : 'Restore'}
          </button>
        </div>

        {restoreResult && (
          <div className="rounded-md border border-border bg-muted/30 p-4 text-sm space-y-2">
            <p>
              <span className="font-medium text-green-600 dark:text-green-400">Restored: {restoreResult.restored}</span>
              {' · '}
              <span className="text-muted-foreground">Skipped: {restoreResult.skipped}</span>
            </p>
            {restoreResult.errors.length > 0 && (
              <div>
                <p className="font-medium text-destructive mb-1">Errors ({restoreResult.errors.length}):</p>
                <ul className="list-disc list-inside space-y-0.5 text-destructive/80">
                  {restoreResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm: delete backup */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Backup"
        message={`Delete backup "${deleteTarget?.fileName}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Confirm: restore */}
      <ConfirmDialog
        open={showRestoreConfirm}
        title="Restore from Backup"
        message={`Restore from "${restoreFile?.name}"? This will overwrite existing pages with matching slugs and cannot be undone.`}
        confirmLabel="Restore"
        onConfirm={handleRestore}
        onCancel={() => setShowRestoreConfirm(false)}
      />
    </div>
  );
}
