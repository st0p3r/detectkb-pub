import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { DetectionRuleData } from '@/lib/api';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft', style: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  { value: 'testing', label: 'Testing', style: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { value: 'production', label: 'Production', style: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { value: 'deprecated', label: 'Deprecated', style: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
];

const SEVERITY_OPTIONS = [
  { value: 'info', label: 'Info', style: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  { value: 'low', label: 'Low', style: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { value: 'medium', label: 'Medium', style: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { value: 'high', label: 'High', style: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  { value: 'critical', label: 'Critical', style: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
];

interface RuleFormProps {
  value: Partial<DetectionRuleData>;
  onChange: (v: Partial<DetectionRuleData>) => void;
}

function SplCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs transition-colors"
      title="Copy SPL query"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function RuleForm({ value, onChange }: RuleFormProps) {
  const currentStatus = value.status ?? 'draft';
  const currentSeverity = value.severity ?? 'medium';

  const currentStatusStyle =
    STATUS_OPTIONS.find((s) => s.value === currentStatus)?.style ??
    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

  const currentSeverityStyle =
    SEVERITY_OPTIONS.find((s) => s.value === currentSeverity)?.style ??
    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

  function set<K extends keyof DetectionRuleData>(key: K, val: DetectionRuleData[K]) {
    onChange({ ...value, [key]: val });
  }

  return (
    <div className="mt-6 rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30">
        <h2 className="text-sm font-semibold text-foreground">Detection Rule Details</h2>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* Status + Severity */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium mb-1.5">Status</label>
            <div className="relative">
              <select
                value={currentStatus}
                onChange={(e) => set('status', e.target.value)}
                className={`w-full pl-3 pr-8 py-2 rounded-md border border-border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none ${currentStatusStyle}`}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                <svg className="w-4 h-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium mb-1.5">Severity</label>
            <div className="relative">
              <select
                value={currentSeverity}
                onChange={(e) => set('severity', e.target.value)}
                className={`w-full pl-3 pr-8 py-2 rounded-md border border-border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none ${currentSeverityStyle}`}
              >
                {SEVERITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                <svg className="w-4 h-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* SPL Query */}
        <div>
          <label className="block text-sm font-medium mb-1.5">SPL Query</label>
          <div className="relative">
            <textarea
              value={value.splQuery ?? ''}
              onChange={(e) => set('splQuery', e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder="index=* sourcetype=... | stats count by ..."
              className="w-full px-3 py-3 rounded-md border border-border bg-zinc-900 text-zinc-100 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
            />
            <SplCopyButton text={value.splQuery ?? ''} />
          </div>
        </div>

        {/* MITRE */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1.5">MITRE Tactics</label>
            <input
              type="text"
              value={value.mitreTactics ?? ''}
              onChange={(e) => set('mitreTactics', e.target.value)}
              placeholder="TA0006, TA0003"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="mt-1 text-xs text-muted-foreground">Comma-separated tactic IDs</p>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1.5">MITRE Techniques</label>
            <input
              type="text"
              value={value.mitreTechniques ?? ''}
              onChange={(e) => set('mitreTechniques', e.target.value)}
              placeholder="T1110, T1110.001"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="mt-1 text-xs text-muted-foreground">Comma-separated technique IDs</p>
          </div>
        </div>

        {/* Data Source */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Data Source</label>
          <input
            type="text"
            value={value.dataSource ?? ''}
            onChange={(e) => set('dataSource', e.target.value)}
            placeholder="WinEventLog:Security"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* False Positives */}
        <div>
          <label className="block text-sm font-medium mb-1.5">False Positives</label>
          <textarea
            value={value.falsePositives ?? ''}
            onChange={(e) => set('falsePositives', e.target.value)}
            rows={3}
            placeholder="Describe known false positive scenarios..."
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
          />
        </div>

        {/* References */}
        <div>
          <label className="block text-sm font-medium mb-1.5">References</label>
          <textarea
            value={value.references ?? ''}
            onChange={(e) => set('references', e.target.value)}
            rows={3}
            placeholder="https://attack.mitre.org/techniques/T1110/&#10;https://docs.splunk.com/..."
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
          />
          <p className="mt-1 text-xs text-muted-foreground">One URL per line</p>
        </div>

        {/* Test Notes */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Test Notes</label>
          <textarea
            value={value.testNotes ?? ''}
            onChange={(e) => set('testNotes', e.target.value)}
            rows={4}
            placeholder="Describe how to test this rule, expected results, environment requirements..."
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
          />
        </div>
      </div>
    </div>
  );
}
