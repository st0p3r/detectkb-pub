import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    (el as HTMLElement).isContentEditable
  );
}

interface Options {
  onShowShortcuts: () => void;
  onCloseModal: () => void;
  currentPageSlug?: string;
}

export function useKeyboardShortcuts({ onShowShortcuts, onCloseModal, currentPageSlug }: Options) {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        onCloseModal();
        return;
      }

      if (isInputFocused()) return;

      switch (e.key) {
        case 'n':
          e.preventDefault();
          navigate('/pages/new');
          break;
        case 'e':
          if (currentPageSlug) {
            e.preventDefault();
            navigate(`/pages/${currentPageSlug}/edit`);
          }
          break;
        case '/':
          e.preventDefault();
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
          );
          break;
        case '?':
          e.preventDefault();
          onShowShortcuts();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, onShowShortcuts, onCloseModal, currentPageSlug]);
}
