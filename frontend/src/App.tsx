import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { PagesPage } from '@/features/pages/PagesPage';
import { PageEditorPage } from '@/features/pages/PageEditorPage';
import { PageViewPage } from '@/features/pages/PageViewPage';
import { RulesPage } from '@/features/rules/RulesPage';
import { SplLibraryPage } from '@/features/spl/SplLibraryPage';
import { BrokenLinksPage } from '@/features/links/BrokenLinksPage';
import { SearchPage } from '@/features/search/SearchPage';
import { BackupPage } from '@/features/backup/BackupPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { FilteredPagesPage } from '@/features/pages/FilteredPagesPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { AttackCoveragePage } from '@/features/attack/AttackCoveragePage';
import { AttackerToolsPage } from '@/features/references/AttackerToolsPage';

// Graph library is large: load it only when the page is opened
const KnowledgeGraphPage = lazy(() => import('@/features/graph/KnowledgeGraphPage'));
import { AuthProvider } from '@/features/auth/AuthContext';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { UserManagementPage } from '@/features/users/UserManagementPage';
import { TagManagementPage } from '@/features/tags/TagManagementPage';
import { DocumentationPage } from '@/features/docs/DocumentationPage';
import { CustomTypesPage } from '@/features/settings/CustomTypesPage';
import { PageTypesProvider } from '@/context/PageTypesContext';
import { SysmonEventsPage } from '@/features/sysmon/SysmonEventsPage';
import { ActivityPage } from '@/features/activity/ActivityPage';
import { Database, Lightbulb } from 'lucide-react';

export default function App() {
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('darkMode') === 'true';
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  return (
    <AuthProvider>
      <PageTypesProvider>
      <Routes>
        {/* Public route: login page (no sidebar layout) */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />

        {/* Protected routes: ProtectedRoute acts as guard, Layout provides <Outlet /> */}
        <Route element={<ProtectedRoute />}>
          <Route
            element={
              <Layout darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} />
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/pages" element={<PagesPage />} />
            <Route path="/pages/new" element={<PageEditorPage />} />
            <Route path="/pages/:slug" element={<PageViewPage />} />
            <Route path="/pages/:slug/edit" element={<PageEditorPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/attack-coverage" element={<AttackCoveragePage />} />
            <Route path="/attacker-tools" element={<AttackerToolsPage />} />
            <Route
              path="/graph"
              element={
                <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading graph…</div>}>
                  <KnowledgeGraphPage />
                </Suspense>
              }
            />
            <Route path="/spl-library" element={<SplLibraryPage />} />
            <Route path="/data-sources" element={
              <FilteredPagesPage
                type="DATA_SOURCE"
                title="Data Sources"
                icon={Database}
                newLabel="New Data Source"
                emptyMessage="Document your data sources — Windows Event Logs, Sysmon, network flows, and more."
              />
            } />
            <Route path="/concepts" element={
              <FilteredPagesPage
                type="CONCEPT"
                title="Concepts"
                icon={Lightbulb}
                newLabel="New Concept"
                emptyMessage="Capture key detection engineering concepts, techniques, and learning notes."
              />
            } />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/users" element={<UserManagementPage />} />
            <Route path="/settings/tags" element={<TagManagementPage />} />
            <Route path="/settings/types" element={<CustomTypesPage />} />
            <Route path="/docs" element={<DocumentationPage />} />
            <Route path="/sysmon-events" element={<SysmonEventsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/broken-links" element={<BrokenLinksPage />} />
            <Route path="/backups" element={<BackupPage />} />
          </Route>
        </Route>
      </Routes>
      </PageTypesProvider>
    </AuthProvider>
  );
}
