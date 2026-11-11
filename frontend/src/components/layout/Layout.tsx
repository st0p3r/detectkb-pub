import React, { Suspense, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Outlet, useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from '@/features/search/CommandPalette';
import { ShortcutsHelpModal } from '@/features/search/ShortcutsHelpModal';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { routeTitle } from '@/hooks/useDocumentTitle';
import { useSessionRefresh } from '@/hooks/useSessionRefresh';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

function PageLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground" role="status">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  );
}

interface LayoutProps {
  darkMode: boolean;
  onToggleDark: () => void;
}

function LayoutInner({ darkMode, onToggleDark, collapsed, onOpenMenu }: LayoutProps & { collapsed: boolean; onOpenMenu: () => void }) {
  const { slug } = useParams<{ slug?: string }>();
  const location = useLocation();
  const [showShortcuts, setShowShortcuts] = useState(false);

  useKeyboardShortcuts({
    onShowShortcuts: () => setShowShortcuts(true),
    onCloseModal: () => setShowShortcuts(false),
    currentPageSlug: slug,
  });

  // The tab says where you are; a page showing one item sets a more exact title after this
  useEffect(() => {
    document.title = routeTitle(location.pathname);
  }, [location.pathname]);

  const marginLeft = collapsed ? 'lg:ml-14' : 'lg:ml-60';

  return (
    <>
      <div data-app-shell className={`flex-1 min-w-0 ${marginLeft} flex flex-col bg-[hsl(var(--background))] transition-all duration-200`}>
        <TopBar darkMode={darkMode} onToggleDark={onToggleDark} collapsed={collapsed} onOpenMenu={onOpenMenu} />
        <main className="flex-1 overflow-y-auto mt-14 p-3 sm:p-6">
          <div key={location.pathname} className="animate-fade-in-up">
            {/* Pages are lazy-loaded chunks (see App.tsx) */}
            <ErrorBoundary resetKey={location.pathname}>
              <Suspense fallback={<PageLoading />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
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

  useSessionRefresh();
  // Small screens: the sidebar is a drawer, closed again when a link is followed
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="h-full flex">
      <Sidebar collapsed={collapsed} onToggleCollapse={handleToggleCollapse} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <LayoutInner darkMode={darkMode} onToggleDark={onToggleDark} collapsed={collapsed} onOpenMenu={() => setMobileOpen(true)} />
    </div>
  );
}
