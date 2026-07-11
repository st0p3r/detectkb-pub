import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ShortcutsHelpModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['n'], description: 'Create a new page' },
  { keys: ['e'], description: 'Edit current page (when viewing a page)' },
  { keys: ['/'], description: 'Open search / command palette' },
  { keys: ['?'], description: 'Show this shortcuts help' },
  { keys: ['Esc'], description: 'Close any open modal or dialog' },
  { keys: ['Ctrl', 'K'], description: 'Open command palette' },
];

export function ShortcutsHelpModal({ open, onClose }: ShortcutsHelpModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4 rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="Close shortcuts help"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {SHORTCUTS.map(({ keys, description }) => (
                <tr key={description}>
                  <td className="py-2.5 pr-4 w-36">
                    <div className="flex items-center gap-1">
                      {keys.map((key) => (
                        <kbd
                          key={key}
                          className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono font-medium"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 text-muted-foreground">{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-xs text-muted-foreground">
            Shortcuts do not fire when an input or text area is focused.
          </p>
        </div>
      </div>
    </div>
  );
}
