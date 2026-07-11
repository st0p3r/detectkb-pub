import React, { useState, useRef, useEffect } from 'react';
import { LogOut, User, ChevronDown } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';

/**
 * UserMenu — shows the signed-in username and a logout button.
 *
 * Usage: import and render inside TopBar (or wherever suits the layout).
 * Phase 8 Note: Wire this into TopBar.tsx once that file is available.
 *
 * Example:
 *   import { UserMenu } from '@/components/layout/UserMenu';
 *   <UserMenu />
 */
export function UserMenu() {
  const { username, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="User menu"
        aria-expanded={open}
      >
        <User className="w-4 h-4 flex-shrink-0" />
        <span className="max-w-[120px] truncate">{username ?? 'admin'}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-44 rounded-md border border-border bg-popover shadow-md z-50 py-1">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="text-sm font-medium text-foreground truncate">{username ?? 'admin'}</p>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
