import React from 'react';
import type { ValidationStatus } from '@/lib/api';
import { VALIDATION } from '@/lib/validationStatus';
import { cn } from '@/lib/utils';

/** A rule's lab validation status. */
export function ValidationBadge({ status, className }: { status: ValidationStatus; className?: string }) {
  const v = VALIDATION[status];
  return (
    <span title={v.hint} className={cn('inline-flex items-center px-1.5 rounded border text-[11px] leading-5 whitespace-nowrap', v.className, className)}>
      {v.label}
    </span>
  );
}
