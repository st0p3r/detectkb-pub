import React from 'react';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  testing: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  production: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  deprecated: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${style} ${className}`}
    >
      {status}
    </span>
  );
}
