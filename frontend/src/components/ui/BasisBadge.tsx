import React from 'react';
import type { LinkBasis } from '@/lib/api';
import { LINK_BASIS } from '@/lib/linkBasis';
import { cn } from '@/lib/utils';

/** Small badge naming a link's basis (hidden for declared links unless `always`). */
export function BasisBadge({ basis, always = false, className }: { basis: LinkBasis | undefined; always?: boolean; className?: string }) {
  if (!basis || (!always && basis === 'declared')) return null;
  const b = LINK_BASIS[basis];
  return (
    <span title={b.hint} className={cn('px-1 rounded border text-[10px] leading-4 font-medium', b.className, className)}>
      {b.label}
    </span>
  );
}
