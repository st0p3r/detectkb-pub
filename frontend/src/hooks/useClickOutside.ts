import { useEffect, useRef } from 'react';

/**
 * Closes a popover when the user clicks outside it or presses Esc. (Closing
 * on blur is not enough: clicking a label inside moves focus nowhere, and the
 * popover would close before the click arrives.)
 */
export function useClickOutside<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose is a fresh closure every render
  }, [open]);
  return ref;
}
