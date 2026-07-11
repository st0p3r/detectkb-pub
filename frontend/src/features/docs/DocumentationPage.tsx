import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Download, Trash2, Loader2, FileBarChart, Globe, File,
} from 'lucide-react';
import {
  listGeneratedDocs,
  generateHTMLReport,
  generatePDFReport,
  generateDetectionMatrix,
  downloadGeneratedDoc,
  deleteGeneratedDoc,
  listPages,
  listRules,
  listTagsAll,
  type GeneratedDoc,
} from '@/lib/api';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { relativeTime } from '@/lib/time';

type ReportType = 'html' | 'pdf' | 'matrix';

function formatBytes(bytes?: number) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DocumentationPage() {
  const queryClient = useQueryClient();
  const [reportType, setReportType] = useState<ReportType>('pdf');
  const [title, setTitle] = useState('Detection Report');
  const [includeToc, setIncludeToc] = useState(true);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [selectedRules, setSelectedRules] = useState<number[]>([]);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [deletingDoc, setDeletingDoc] = useState<GeneratedDoc | null>(null);
  const [pageSearch, setPageSearch] = useState('');
  const [ruleSearch, setRuleSearch] = useState('');

  const { data: docs = [], isLoading: docsLoading } = useQuery({
    queryKey: ['generated-docs'],
    queryFn: listGeneratedDocs,
  });

  const { data: pages = [] } = useQuery({ queryKey: ['pages'], queryFn: () => listPages() });
  const { data: rules = [] } = useQuery({ queryKey: ['rules'], queryFn: () => listRules() });
  const { data: tags = [] } = useQuery({ queryKey: ['tags-all'], queryFn: listTagsAll });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (reportType === 'matrix') {
        return generateDetectionMatrix({ title, tagIds: selectedTags.length ? selectedTags : undefined });
      } else if (reportType === 'html') {
        return generateHTMLReport({ title, pageIds: selectedPages, ruleIds: selectedRules, includeTableOfContents: includeToc });
      } else {
        return generatePDFReport({ title, pageIds: selectedPages, ruleIds: selectedRules });
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['generated-docs'] });
      downloadGeneratedDoc(result.document.id, result.document.title + '.' + result.document.format);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteGeneratedDoc(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generated-docs'] });
      setDeletingDoc(null);
    },
  });

  function togglePage(id: number) {
    setSelectedPages((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  }

  function toggleRule(id: number) {
    setSelectedRules((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  }

  function toggleTag(id: number) {
    setSelectedTags((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  }

  const filteredPages = pages.filter((p) =>
    !pageSearch || p.title.toLowerCase().includes(pageSearch.toLowerCase())
  );

  const filteredRules = rules.filter((r) =>
    !ruleSearch || r.page.title.toLowerCase().includes(ruleSearch.toLowerCase())
  );

  const canGenerate =
    !generateMutation.isPending &&
    (reportType === 'matrix' || selectedPages.length > 0 || selectedRules.length > 0);

  return (
    <div className="max-w-6xl mx-auto">
      <Breadcrumbs items={[{ label: 'Documentation' }]} />
      <div className="flex items-center gap-3 mb-6">
        <FileText className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Documentation Generator</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Config panel */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold text-sm mb-4">Report Configuration</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Report Type</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { value: 'pdf', label: 'PDF', icon: File },
                    { value: 'html', label: 'HTML', icon: Globe },
                    { value: 'matrix', label: 'Matrix', icon: FileBarChart },
                  ] as const).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => setReportType(value)}
                      className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium border transition-colors ${
                        reportType === value
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Report Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>

              {reportType === 'html' && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeToc}
                    onChange={(e) => setIncludeToc(e.target.checked)}
                    className="w-4 h-4"
                  />
                  Include Table of Contents
                </label>
              )}

              {reportType !== 'matrix' && (
                <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                  {selectedPages.length} pages · {selectedRules.length} rules selected
                </div>
              )}

              {reportType === 'matrix' && (
                <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                  All detection rules · {selectedTags.length > 0 ? `filtered by ${selectedTags.length} tags` : 'no tag filter'}
                </div>
              )}

              <button
                onClick={() => generateMutation.mutate()}
                disabled={!canGenerate}
                className="w-full py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Generate & Download
                  </>
                )}
              </button>

              {generateMutation.error && (
                <p className="text-xs text-destructive">{(generateMutation.error as Error).message}</p>
              )}
            </div>
          </div>
        </div>

        {/* Content selection */}
        <div className="lg:col-span-3 space-y-4">
          {reportType === 'matrix' ? (
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="font-semibold text-sm mb-3">Filter by Tags (optional)</h2>
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium transition-all border"
                    style={{
                      backgroundColor: selectedTags.includes(tag.id) ? tag.color : 'transparent',
                      color: selectedTags.includes(tag.id) ? 'white' : tag.color,
                      borderColor: tag.color,
                    }}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold text-sm">Pages ({selectedPages.length}/{pages.length})</h2>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setSelectedPages(pages.map((p) => p.id))}
                      className="text-xs text-primary hover:underline"
                    >
                      All
                    </button>
                    <span className="text-muted-foreground text-xs">·</span>
                    <button
                      onClick={() => setSelectedPages([])}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      None
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="Search pages…"
                  value={pageSearch}
                  onChange={(e) => setPageSearch(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-border bg-background text-xs mb-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {filteredPages.map((page) => (
                    <label key={page.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedPages.includes(page.id)}
                        onChange={() => togglePage(page.id)}
                        className="w-3.5 h-3.5"
                      />
                      <span className="text-sm truncate flex-1">{page.title}</span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{page.type}</span>
                    </label>
                  ))}
                  {filteredPages.length === 0 && (
                    <p className="text-xs text-muted-foreground px-2 py-3">No pages match</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold text-sm">Detection Rules ({selectedRules.length}/{rules.length})</h2>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setSelectedRules(rules.map((r) => r.id!))}
                      className="text-xs text-primary hover:underline"
                    >
                      All
                    </button>
                    <span className="text-muted-foreground text-xs">·</span>
                    <button
                      onClick={() => setSelectedRules([])}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      None
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="Search rules…"
                  value={ruleSearch}
                  onChange={(e) => setRuleSearch(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-border bg-background text-xs mb-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {filteredRules.map((rule) => (
                    <label key={rule.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedRules.includes(rule.id!)}
                        onChange={() => toggleRule(rule.id!)}
                        className="w-3.5 h-3.5"
                      />
                      <span className="text-sm truncate flex-1">{rule.page.title}</span>
                      <span className={`text-xs flex-shrink-0 ${
                        rule.severity === 'critical' ? 'text-red-500' :
                        rule.severity === 'high' ? 'text-orange-500' :
                        rule.severity === 'medium' ? 'text-yellow-500' : 'text-green-500'
                      }`}>{rule.severity}</span>
                    </label>
                  ))}
                  {filteredRules.length === 0 && (
                    <p className="text-xs text-muted-foreground px-2 py-3">No rules match</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Generated documents list */}
      <div className="mt-8">
        <h2 className="font-semibold text-sm mb-3">Generated Documents</h2>
        {docsLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm border border-border rounded-lg">
            No documents generated yet.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Format</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Size</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Generated</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">By</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{doc.title}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${
                        doc.format === 'pdf'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      }`}>
                        {doc.format}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs hidden sm:table-cell">
                      {formatBytes(doc.fileSize)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">
                      {relativeTime(doc.generatedAt)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">
                      {doc.generatedBy?.username || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => downloadGeneratedDoc(doc.id, `${doc.title}.${doc.format}`)}
                          title="Download"
                          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeletingDoc(doc)}
                          title="Delete"
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
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
        )}
      </div>

      <ConfirmDialog
        open={deletingDoc !== null}
        title="Delete Document"
        message={`Delete "${deletingDoc?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => deletingDoc && deleteMutation.mutate(deletingDoc.id)}
        onCancel={() => setDeletingDoc(null)}
      />
    </div>
  );
}
