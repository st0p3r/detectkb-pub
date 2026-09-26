import { useEffect, useRef } from 'react';

/** True while typing in a field or when a modal dialog is open. */
export function shortcutsBlocked(): boolean {
  const el = document.activeElement as HTMLElement | null;
  const tag = el?.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return true;
  return !!document.querySelector('[role="dialog"][aria-modal="true"]');
}

interface ListKeyboardOptions {
  /** Rows in the list */
  count: number;
  /** Index of the highlighted row, or -1 */
  active: number;
  setActive: (index: number) => void;
  /** Enter */
  onOpen?: (index: number) => void;
  /** o */
  onOpenFull?: (index: number) => void;
  /** e */
  onEdit?: (index: number) => void;
  /** x */
  onToggleSelect?: (index: number) => void;
  /** Esc; return true if it did something */
  onEscape?: () => boolean;
  enabled?: boolean;
}

/**
 * j / k move through a list, Enter / o / e / x act on the highlighted row,
 * Esc backs out. Ignored while typing or when a dialog is open.
 */
export function useListKeyboard(opts: ListKeyboardOptions) {
  // Latest options without re-binding the listener on every render
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const o = ref.current;
      if (o.enabled === false || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (!document.querySelector('[role="dialog"][aria-modal="true"]') && o.onEscape?.()) e.preventDefault();
        return;
      }
      if (shortcutsBlocked() || !o.count) return;
      const at = o.active;
      const act = (fn?: (i: number) => void) => {
        if (!fn || at < 0) return;
        e.preventDefault();
        fn(at);
      };
      switch (e.key) {
        case 'j':
          e.preventDefault();
          o.setActive(Math.min(at + 1, o.count - 1));
          break;
        case 'k':
          e.preventDefault();
          o.setActive(Math.max(at - 1, 0));
          break;
        case 'Enter':
          act(o.onOpen);
          break;
        case 'o':
          act(o.onOpenFull);
          break;
        case 'e':
          act(o.onEdit);
          break;
        case 'x':
          act(o.onToggleSelect);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
