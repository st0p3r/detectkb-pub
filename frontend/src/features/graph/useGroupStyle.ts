import { useCallback } from 'react';
import { usePageTypes } from '@/context/PageTypesContext';
import { ENTITY_GROUPS, isPageGroup } from './graphStyle';

/** Colour and label of a node group (page types use their configured colour). */
export function useGroupStyle() {
  const { getColorFor, getLabelFor } = usePageTypes();
  const colorOf = useCallback((g: string) => (isPageGroup(g) ? getColorFor(g) : ENTITY_GROUPS[g]?.color ?? '#94a3b8'), [getColorFor]);
  const labelOf = useCallback((g: string) => (isPageGroup(g) ? getLabelFor(g) : ENTITY_GROUPS[g]?.label ?? g), [getLabelFor]);
  return { colorOf, labelOf };
}
