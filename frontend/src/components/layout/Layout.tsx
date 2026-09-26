import React, { useState } from 'react';
import { Outlet, useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from '@/features/search/CommandPalette';
import { ShortcutsHelpModal } from '@/features/search/ShortcutsHelpModal';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

interface LayoutProps {
  darkMode: boolean;
  onToggleDark: () => void;
}

function LayoutInner({ darkMode, onToggleDark, collapsed }: LayoutProps & { collapsed: boolean }) {
  const { slug } = useParams<{ slug?: string }>();
  const location = useLocation();
  const [showShortcuts, setShowShortcuts] = useState(false);

  useKeyboardShortcuts({
    onShowShortcuts: () => setShowShortcuts(true),
    onCloseModal: () => setShowShortcuts(false),
    currentPageSlug: slug,
  });

  const marginLeft = collapsed ? 'ml-14' : 'ml-60';

  return (
    <>
      <div className={`flex-1 min-w-0 ${marginLeft} flex flex-col bg-[hsl(var(--background))] transition-all duration-200`}>
        <TopBar darkMode={darkMode} onToggleDark={onToggleDark} collapsed={collapsed} />
        <main className="flex-1 overflow-y-auto mt-14 p-6">
          <div key={location.pathname} className="animate-fade-in-up">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
      <ShortcutsHelpModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </>
  );
}

export function Layout({ darkMode, onToggleDark }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });

  function handleToggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebarCollapsed', String(next));
      return next;
    });
  }

  return (
    <div className="h-full flex">
      <Sidebar collapsed={collapsed} onToggleCollapse={handleToggleCollapse} />
      <LayoutInner darkMode={darkMode} onToggleDark={onToggleDark} collapsed={collapsed} />
    </div>
  );
}
