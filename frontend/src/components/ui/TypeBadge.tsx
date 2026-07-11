import React from 'react';
import { cn } from '@/lib/utils';
import type { PageType } from '@/lib/api';
import { usePageTypes } from '@/context/PageTypesContext';

export function TypeBadge({ type, className }: { type: PageType; className?: string }) {
  const { getLabelFor, getColorFor } = usePageTypes();
  const label = getLabelFor(type);
  const color = getColorFor(type);

  return (
    <span
      className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white', className)}
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  );
}
