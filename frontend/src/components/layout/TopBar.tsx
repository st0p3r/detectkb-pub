import React, { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHealth } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Plus, Sun, Moon, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface TopBarProps {
  darkMode: boolean;
  onToggleDark: () => void;
  collapsed?: boolean;
}

export function TopBar({ darkMode, onToggleDark, collapsed = false }: TopBarProps) {
  const navigate = useNavigate();
  const { data: health, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 30000,
  });

  const openCommandPalette = useCallback(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
    );
  }, []);

  const isConnected = health?.db === 'connected';
  const leftOffset = collapsed ? 'left-14' : 'left-60';

  return (
    <header
      className={cn(
        'fixed top-0 right-0 h-14 bg-card/80 backdrop-blur-md border-b border-border flex items-center justify-between gap-4 px-6 z-10 transition-all duration-200',
        leftOffset
      )}
    >
      {/* Left: status pill */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1">
          {isLoading ? (
            <span className="text-xs text-muted-foreground">Checking...</span>
          ) : isConnected ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-subtle-pulse" role="status" aria-label="Database connected" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-destructive font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive" role="status" aria-label="Database disconnected" />
              Disconnected
            </span>
          )}
        </div>
      </div>

      {/* Center: search hint */}
      <button
        onClick={openCommandPalette}
        aria-label="Open search"
        className="hidden sm:flex flex-1 max-w-md items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted/40 text-sm text-muted-foreground hover:bg-muted hover:border-primary/40 transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 outline-none active:scale-[0.99]"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="flex-1 text-left">Search...</span>
        <kbd className="ml-1 inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-xs font-mono">
          ⌘K
        </kbd>
      </button>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleDark}
          className="h-8 w-8 focus-visible:ring-2 focus-visible:ring-primary/30 active:scale-[0.96] transition-transform"
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
        <Button
          size="sm"
          onClick={() => navigate('/pages/new')}
          className="gap-1.5 focus-visible:ring-2 focus-visible:ring-primary/30 active:scale-[0.98] transition-transform"
        >
          <Plus className="w-4 h-4" />
          New Page
        </Button>
      </div>
    </header>
  );
}
