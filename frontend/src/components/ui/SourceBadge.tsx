import React from 'react';
import type { RuleSourceFormat } from '@/lib/api';
import { SOURCE_STYLES, sourceLabel } from '@/lib/ruleSource';

interface SourceBadgeProps {
  source: RuleSourceFormat;
  onClick?: () => void;
}

/** Where an imported rule came from — outlined, so it doesn't read as a tag. */
export function SourceBadge({ source, onClick }: SourceBadgeProps) {
  const style = SOURCE_STYLES[source] ?? SOURCE_STYLES.manual;
  const className = `inline-flex items-center gap-1 px-1.5 py-px rounded border text-[11px] font-medium leading-4 ${style.badge}`;
  const content = (
    <>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {sourceLabel(source)}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} title={`Only ${sourceLabel(source)} rules`} className={`${className} hover:bg-accent`}>
      {content}
    </button>
  ) : (
    <span className={className}>{content}</span>
  );
}
