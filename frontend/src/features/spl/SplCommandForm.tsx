import React from 'react';
import { Star } from 'lucide-react';
import type { SplCommandData } from '@/lib/api';

const SPL_GROUPS = [
  'Search',
  'Reporting',
  'Eval functions',
  'Filtering',
  'Transforming',
  'Other',
];

interface SplCommandFormProps {
  value: Partial<SplCommandData>;
  onChange: (v: Partial<SplCommandData>) => void;
}

export function SplCommandForm({ value, onChange }: SplCommandFormProps) {
  function set<K extends keyof SplCommandData>(key: K, val: SplCommandData[K]) {
    onChange({ ...value, [key]: val });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">SPL Command Details</h2>
        <button
          type="button"
          onClick={() => set('isFavorite', !value.isFavorite)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
            value.isFavorite
              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-600'
              : 'border-border text-muted-foreground hover:bg-accent'
          }`}
          title="Toggle favorite"
        >
          <Star
            className={`w-3.5 h-3.5 ${value.isFavorite ? 'fill-current' : ''}`}
          />
          {value.isFavorite ? 'Favorited' : 'Add to Favorites'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
            Command Name <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            value={value.command ?? ''}
            onChange={(e) => set('command', e.target.value)}
            placeholder="e.g. stats"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
            Group
          </label>
          <select
            value={value.group ?? 'Other'}
            onChange={(e) => set('group', e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {SPL_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
          Syntax
        </label>
        <textarea
          value={value.syntax ?? ''}
          onChange={(e) => set('syntax', e.target.value)}
          placeholder="e.g. ... | stats <function> BY <field>"
          rows={2}
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
          Description
        </label>
        <textarea
          value={value.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Brief description of what this command does"
          rows={2}
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
          Examples{' '}
          <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
            (markdown with code blocks)
          </span>
        </label>
        <textarea
          value={value.examples ?? ''}
          onChange={(e) => set('examples', e.target.value)}
          placeholder={`Basic usage:\n\`\`\`spl\n... | stats count BY host\n\`\`\``}
          rows={6}
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
          Pitfalls &amp; Gotchas
        </label>
        <textarea
          value={value.pitfalls ?? ''}
          onChange={(e) => set('pitfalls', e.target.value)}
          placeholder="Common mistakes or things to watch out for"
          rows={2}
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
        />
      </div>
    </div>
  );
}
