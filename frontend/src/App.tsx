import React, { lazy, useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';

import { AuthProvider } from '@/features/auth/AuthContext';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { PageTypesProvider } from '@/context/PageTypesContext';
import { Database, Lightbulb } from 'lucide-react';

// Each page is its own chunk, loaded when first opened (the Markdown editor,
// graph and ATT&CK data made one ~2 MB bundle). The dashboard and login stay
// in the main bundle; Layout shows a fallback while a page loads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any props; each page keeps its own
const named = <M extends Record<K, React.ComponentType<any>>, K extends keyof M & string>(load: () => Promise<M>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const PagesPage = named(() => import('@/features/pages/PagesPage'), 'PagesPage');
const PageEditorPage = named(() => import('@/features/pages/PageEditorPage'), 'PageEditorPage');
const PageViewPage = named(() => import('@/features/pages/PageViewPage'), 'PageViewPage');
const RulesPage = named(() => import('@/features/rules/RulesPage'), 'RulesPage');
const SplLibraryPage = named(() => import('@/features/spl/SplLibraryPage'), 'SplLibraryPage');
const BrokenLinksPage = named(() => import('@/features/links/BrokenLinksPage'), 'BrokenLinksPage');
const SearchPage = named(() => import('@/features/search/SearchPage'), 'SearchPage');
const BackupPage = named(() => import('@/features/backup/BackupPage'), 'BackupPage');
const SettingsPage = named(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const FilteredPagesPage = named(() => import('@/features/pages/FilteredPagesPage'), 'FilteredPagesPage');
const AttackCoveragePage = named(() => import('@/features/attack/AttackCoveragePage'), 'AttackCoveragePage');
const AttackerToolsPage = named(() => import('@/features/references/AttackerToolsPage'), 'AttackerToolsPage');
const UserManagementPage = named(() => import('@/features/users/UserManagementPage'), 'UserManagementPage');
const TagManagementPage = named(() => import('@/features/tags/TagManagementPage'), 'TagManagementPage');
const DocumentationPage = named(() => import('@/features/docs/DocumentationPage'), 'DocumentationPage');
const CustomTypesPage = named(() => import('@/features/settings/CustomTypesPage'), 'CustomTypesPage');
const SysmonEventsPage = named(() => import('@/features/sysmon/SysmonEventsPage'), 'SysmonEventsPage');
const ActivityPage = named(() => import('@/features/activity/ActivityPage'), 'ActivityPage');
const LogSourcesPage = named(() => import('@/features/logs/LogSourcesPage'), 'LogSourcesPage');
const ThreatGroupsPage = named(() => import('@/features/threat/ThreatGroupsPage'), 'ThreatGroupsPage');
const AnalyticStoriesPage = named(() => import('@/features/stories/AnalyticStoriesPage'), 'AnalyticStoriesPage');
const DataHealthPage = named(() => import('@/features/health/DataHealthPage'), 'DataHealthPage');
const KnowledgeGraphPage = lazy(() => import('@/features/graph/KnowledgeGraphPage'));

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
            <Route path="/graph" element={<KnowledgeGraphPage />} />
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
            <Route path="/log-sources" element={<LogSourcesPage />} />
            <Route path="/threat-groups" element={<ThreatGroupsPage />} />
            <Route path="/analytic-stories" element={<AnalyticStoriesPage />} />
            <Route path="/data-health" element={<DataHealthPage />} />
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
