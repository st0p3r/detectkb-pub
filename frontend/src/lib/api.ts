import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: attach auth token if present
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers = config.headers ?? {};
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: on 401 clear token and redirect to login;
// on a forced password change, send the user to the change-password screen.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const path = window.location.pathname;
    if (status === 401) {
      // Only redirect if this wasn't already a login attempt
      const isLoginEndpoint = error.config?.url?.includes('/api/auth/login');
      if (!isLoginEndpoint && path !== '/login') {
        // Come back to the same place after signing in again (an editor restores its draft)
        try {
          sessionStorage.setItem(NEXT_PATH_KEY, path + window.location.search);
        } catch {
          // no session storage: the dashboard it is
        }
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUsername');
        window.location.href = '/login';
      }
    } else if (status === 403 && error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      localStorage.setItem('authMustChangePassword', 'true');
      if (path !== '/change-password') window.location.href = '/change-password';
    }
    return Promise.reject(error);
  }
);

const NEXT_PATH_KEY = 'detectkb.next';

/** Where the user was when the session ended (once): the place to return to after signing in. */
export function takeNextPath(): string | null {
  try {
    const next = sessionStorage.getItem(NEXT_PATH_KEY);
    sessionStorage.removeItem(NEXT_PATH_KEY);
    return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : null;
  } catch {
    return null;
  }
}

/** A fresh token for the current session, so working on doesn't end in a sign-out. */
export async function refreshSession() {
  const { data } = await api.post('/api/auth/refresh');
  if (data?.token) localStorage.setItem('authToken', data.token);
}

/** Human-readable message from an API error. */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error || e?.message || fallback;
}

export async function getHealth() {
  const { data } = await api.get('/api/health');
  return data as { status: string; db: string; timestamp: string };
}

export type PageType = string;

export interface DetectionRuleData {
  id?: number;
  pageId: number;
  status: string;
  severity: string;
  splQuery: string;
  mitreTactics?: string;
  mitreTechniques?: string;
  dataSource?: string;
  falsePositives?: string;
  references?: string;
  testNotes?: string;
  sigmaId?: string | null;
  sigmaYaml?: string | null;
  sourceFormat?: RuleSourceFormat | null;
  sourceId?: string | null;
  sourceContent?: string | null;
  nativeQuery?: string | null;
  nativeLanguage?: string | null;
  /** For the analyst (Markdown): what to check first, and what to do when the alert is real */
  triage?: string | null;
  response?: string | null;
  ownerId?: number | null;
  owner?: RuleOwner | null;
  lastReviewedAt?: string | null;
  nextReviewAt?: string | null;
}

export interface RuleOwner {
  id: number;
  username: string;
}

export type RuleSourceFormat = 'sigma' | 'escu' | 'elastic' | 'sentinel';

export const SOURCE_FORMAT_LABELS: Record<RuleSourceFormat, string> = {
  sigma: 'Sigma',
  escu: 'Splunk ESCU',
  elastic: 'Elastic',
  sentinel: 'Microsoft Sentinel',
};

export const QUERY_LANGUAGE_LABELS: Record<string, string> = {
  kql: 'KQL',
  eql: 'EQL',
  esql: 'ES|QL',
  kuery: 'KQL (Kibana)',
  lucene: 'Lucene',
};

export interface RuleWithPage extends DetectionRuleData {
  /** Whether its logs are collected (the paged list, once collection is filled in) */
  feed?: RuleFeed;
  page: { id: number; title: string; slug: string; type: string; updatedAt: string; tags: { tag: { id: number; name: string } }[] };
}

export interface Page {
  id: number;
  title: string;
  slug: string;
  contentMd: string;
  type: PageType;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  tags: { tag: { id: number; name: string; color?: string } }[];
  category: { id: number; name: string; color?: string } | null;
  rule?: DetectionRuleData | null;
  splCommand?: SplCommandData | null;
  /** From GET /api/pages/:slug: lower-cased [[link]] title → slug (missing pages left out) */
  wikiLinks?: Record<string, string>;
  sysmonEvents?: PageSysmonLink[];
  /** Other telemetry (derived from the rule / data source page) */
  logEvents?: { basis: LinkBasis; logEvent: { key: string; source: string; sourceLabel: string; code: string; name: string } }[];
  /** Splunk analytic stories (ESCU rules) */
  stories?: { story: { id: number; name: string } }[];
}

/** Why a link exists — see LINK_BASIS in components/ui/BasisBadge */
export type LinkBasis = 'official' | 'declared' | 'inferred' | 'text-match' | 'manual';

export interface PageSysmonLink {
  source: 'auto' | 'manual';
  basis: LinkBasis;
  sysmonEvent: { id: number; eventId: number; name: string; category: string };
}

export interface Category {
  id: number;
  name: string;
  color?: string;
  parentId?: number | null;
}

/** A page as lists show it: no markdown or rule body (fetch the page for those). */
export type PageListItem = Pick<Page, 'id' | 'title' | 'slug' | 'type' | 'isPinned' | 'createdAt' | 'updatedAt' | 'tags' | 'category'> & {
  categoryId: number | null;
  rule: { status: string; severity: string } | null;
};

export async function listPages(params?: { type?: string; q?: string; categoryId?: number }) {
  const { data } = await api.get('/api/pages', { params });
  return data as PageListItem[];
}

export type PageSortKey = 'title' | 'type' | 'updatedAt';

export interface PageListParams {
  q?: string;
  type?: string;
  /** Comma-separated types to leave out, e.g. "RULE" */
  excludeType?: string;
  tag?: string;
  categoryId?: number;
  sort?: PageSortKey;
  dir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** One page of the page list, filtered and sorted on the server. */
export async function listPagesPage(params: PageListParams) {
  const { data } = await api.get('/api/pages', { params });
  return data as {
    items: PageListItem[];
    total: number;
    page: number;
    pageSize: number;
    /** Pages per type under the other filters (for the type chips) */
    typeCounts: Record<string, number>;
  };
}

/** Ids of every page matching the list filters ("select all matching"). */
export async function listPageIds(filter: Omit<PageListParams, 'sort' | 'dir' | 'page' | 'pageSize'>) {
  const { data } = await api.get('/api/pages/ids', { params: filter });
  return data as number[];
}

/** Page titles for [[wiki link]] autocomplete; titles starting with q first. */
export async function searchPageTitles(q: string, limit = 10) {
  const { data } = await api.get('/api/pages/titles', { params: { q, limit } });
  return data as { title: string; slug: string; type: string }[];
}

export async function getPage(slug: string) {
  const { data } = await api.get(`/api/pages/${slug}`);
  return data as Page;
}

export async function createPage(payload: Partial<Page> & { tagNames?: string[] }) {
  const { data } = await api.post('/api/pages', payload);
  return data as Page;
}

export async function updatePage(id: number, payload: Partial<Page> & { tagNames?: string[] }) {
  const { data } = await api.put(`/api/pages/${id}`, payload);
  return data as Page;
}

export interface PageSavePayload {
  title: string;
  contentMd: string;
  type: PageType;
  categoryId: number | null;
  isPinned: boolean;
  tagNames: string[];
  /** Rule fields (pages of type RULE) */
  rule?: Partial<DetectionRuleData>;
  splCommand?: Partial<SplCommandData>;
  /** Manual Sysmon links (event IDs) */
  sysmonEventIds?: number[];
  /** updatedAt of the page when it was loaded: the save is refused if someone saved since */
  expectedUpdatedAt?: string;
  /** Save even though someone else saved since */
  force?: boolean;
}

/** Saves a page with its rule / SPL command / Sysmon links in one step: all of it, or nothing. */
export async function savePage(id: number | null, payload: PageSavePayload) {
  const { data } = id ? await api.put(`/api/pages/${id}`, payload) : await api.post('/api/pages', payload);
  return data as Page;
}

export interface SaveConflict {
  updatedAt: string;
  updatedBy: string | null;
}

/** The other save, when a save was refused because the page changed in the meantime. */
export function saveConflict(err: unknown): SaveConflict | null {
  const res = (err as { response?: { status?: number; data?: { code?: string; updatedAt?: string; updatedBy?: string | null } } })?.response;
  return res?.status === 409 && res.data?.code === 'CONFLICT' ? { updatedAt: res.data.updatedAt ?? '', updatedBy: res.data.updatedBy ?? null } : null;
}

export type RevisionRule = Partial<
  Record<
    'status' | 'severity' | 'splQuery' | 'nativeQuery' | 'nativeLanguage' | 'sigmaYaml' | 'mitreTactics' | 'mitreTechniques' | 'dataSource' | 'falsePositives' | 'references' | 'testNotes' | 'triage' | 'response',
    string | null
  >
>;

export interface RevisionSummary {
  id: number;
  title: string;
  createdAt: string;
  /** Null: the page as it was before history started */
  author: string | null;
  /** What this version changed: "title", "content", or rule field names */
  changed: string[];
  current: boolean;
}

export interface RevisionDetail {
  id: number;
  createdAt: string;
  author: string | null;
  title: string;
  contentMd: string;
  rule: RevisionRule | null;
  /** The version before it */
  previous: { id: number; title: string; contentMd: string; rule: RevisionRule | null } | null;
}

export async function listPageRevisions(pageId: number) {
  const { data } = await api.get(`/api/pages/${pageId}/revisions`);
  return data as RevisionSummary[];
}

export async function getPageRevision(pageId: number, revisionId: number) {
  const { data } = await api.get(`/api/pages/${pageId}/revisions/${revisionId}`);
  return data as RevisionDetail;
}

/** Makes an earlier version the page again (as a new version). */
export async function restorePageRevision(pageId: number, revisionId: number) {
  const { data } = await api.put(`/api/pages/${pageId}/revisions/${revisionId}/restore`);
  return data as Page;
}

export async function deletePage(id: number) {
  await api.delete(`/api/pages/${id}`);
}

export interface PageSummary {
  id: number;
  title: string;
  slug: string;
  type: string;
  updatedAt: string;
}

export interface DashboardData {
  /** null when the user can't read pages */
  pages: { byType: Record<string, number>; pinned: PageSummary[]; recent: PageSummary[]; splCommands: number } | null;
  /** null when the user can't read rules */
  rules: {
    total: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    /** Import format, or "manual" */
    bySource: Record<string, number>;
    drafts: { id: number; status: string; severity: string; page: PageSummary }[];
    /** Parent ATT&CK techniques with a non-deprecated rule */
    coverage: { covered: number; total: number };
    /** Reviews due (dueSoon includes overdue), production rules nobody owns, and the caller's own rules */
    upkeep: { overdue: number; dueSoon: number; productionUnowned: number; mine: number; mineDue: number };
    /** Rules by whether their logs are collected; active: someone filled in what is collected */
    logs: { active: boolean; fed: number; blind: number; unknown: number; blindDeployed: number; blindProduction: number };
    /** Techniques with a deployed rule, per day */
    trend: { day: string; deployed: number; withLogs: number | null; validated: number; total: number }[];
  } | null;
}

export async function getDashboard() {
  const { data } = await api.get('/api/dashboard');
  return data as DashboardData;
}

export interface SavedView {
  id: number;
  name: string;
  /** /rules, /pages or /graph */
  path: string;
  /** URL query string, without "?" */
  query: string;
}

export async function listSavedViews() {
  const { data } = await api.get('/api/saved-views');
  return data as SavedView[];
}

export async function createSavedView(view: Omit<SavedView, 'id'>) {
  const { data } = await api.post('/api/saved-views', view);
  return data as SavedView;
}

export async function deleteSavedView(id: number) {
  await api.delete(`/api/saved-views/${id}`);
}

export async function listCategories() {
  const { data } = await api.get('/api/categories');
  return data as Category[];
}

export async function createCategory(payload: { name: string; color?: string; parentId?: number }) {
  const { data } = await api.post('/api/categories', payload);
  return data as Category;
}

export async function deleteCategory(id: number) {
  await api.delete(`/api/categories/${id}`);
}

export async function getBacklinks(slug: string) {
  const { data } = await api.get(`/api/pages/${slug}/backlinks`);
  return data as { id: number; title: string; slug: string; type: string }[];
}

export async function getBrokenLinks() {
  const { data } = await api.get('/api/links/broken');
  return data as { sourceSlug: string; sourceTitle: string; brokenTitle: string }[];
}

/** Every matching rule (list columns only — no queries or source content). */
export async function listRules(params?: { status?: string; severity?: string; technique?: string }) {
  const { data } = await api.get('/api/rules', { params });
  return data as RuleWithPage[];
}

export type RuleSortKey = 'title' | 'status' | 'severity' | 'updatedAt' | 'nextReviewAt';

export interface RuleListParams {
  q?: string;
  status?: string;
  severity?: string;
  /** Import format, or "manual" for rules written here */
  source?: string;
  technique?: string;
  tactic?: string;
  /** Analytic story ID */
  story?: number;
  /** Telemetry key (sysmon:1, windows-security:4688) or a whole log source */
  telemetry?: string;
  /** A user id, "me" or "none" */
  owner?: string;
  /** overdue | soon | none */
  review?: string;
  /** fed | blind | unknown: whether the rule's logs are collected */
  logs?: string;
  sort?: RuleSortKey;
  dir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface RulePage {
  items: RuleWithPage[];
  total: number;
  page: number;
  pageSize: number;
  /** Rules per status under the other filters (for the status chips) */
  statusCounts: Record<string, number>;
}

/** The list filters, without paging and sort (what bulk actions and export take). */
export type RuleListFilter = Omit<RuleListParams, 'sort' | 'dir' | 'page' | 'pageSize'>;

/** Target of a bulk action: explicit rule ids, or every rule matching a filter. */
export type RuleBulkTarget = { ids: number[] } | { pageIds: number[] } | { filter: RuleListFilter };

export type RuleBulkAction = 'status' | 'severity' | 'addTag' | 'removeTag' | 'replaceRetiredTechniques' | 'owner' | 'markReviewed';

export async function bulkUpdateRules(target: RuleBulkTarget, action: RuleBulkAction, value: string) {
  const { data } = await api.put('/api/rules/bulk', { ...target, action, value });
  return data as { matched: number; changed: number; replacements?: Record<string, string> };
}

/** Ids of every rule matching the list filters ("select all matching"). */
export async function listRuleIds(filter: RuleListFilter) {
  const { data } = await api.get('/api/rules/ids', { params: filter });
  return data as number[];
}

/** Deletes the rules' pages. */
export async function bulkDeleteRules(target: RuleBulkTarget) {
  const { data } = await api.delete('/api/rules/bulk', { data: target });
  return data as { deleted: number };
}

/** One page of rules, filtered, searched and sorted on the server. */
export async function listRulesPage(params: RuleListParams) {
  const { data } = await api.get('/api/rules', { params });
  return data as RulePage;
}

export async function upsertRule(payload: Omit<DetectionRuleData, 'id'>) {
  const { data } = await api.post('/api/rules', payload);
  return data as DetectionRuleData;
}

export async function updateRule(id: number, payload: Partial<DetectionRuleData>) {
  const { data } = await api.put(`/api/rules/${id}`, payload);
  return data as DetectionRuleData;
}

/** The rule still holds: review date = now, next review in the default interval (or the given date). */
export async function markRuleReviewed(id: number, nextReviewAt?: string | null) {
  const { data } = await api.put(`/api/rules/${id}/review`, nextReviewAt === undefined ? {} : { nextReviewAt });
  return data as { id: number; pageId: number; lastReviewedAt: string; nextReviewAt: string | null };
}

export interface RuleOwnerOption extends RuleOwner {
  name: string | null;
  rules: number;
}

/** People a rule can be assigned to, with how many rules each owns. */
export async function listRuleOwners() {
  const { data } = await api.get('/api/rules/owners');
  return data as { owners: RuleOwnerOption[]; unowned: number };
}

export interface RunbookSteps {
  /** rule: written on the rule · imported: from the investigation guide it was imported with */
  source: 'rule' | 'imported';
  markdown: string;
}

export interface Runbook {
  pageId: number;
  ruleId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  updatedAt: string;
  tags: { name: string; color?: string }[];
  owner: RuleOwner | null;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  overview: string;
  triage: RunbookSteps | null;
  response: RunbookSteps | null;
  falsePositives: string[];
  references: string[];
  queries: { spl: string | null; native: string | null; nativeLanguage: string | null };
  dataSource: string | null;
  techniques: {
    id: string;
    name: string;
    tactics: string[];
    platforms: string[];
    url: string;
    description: string | null;
    analytics: AttackAnalytic[];
    mitigations: { id: string; name: string; description: string; url: string }[];
  }[];
  logs: { known: boolean; feed: RuleFeed; telemetry: { key: string; label: string; state: CollectionState }[] };
  validation: { status: ValidationStatus; reason: string | null; testedAt: string | null };
  relatedTotal: number;
  related: { pageId: number; title: string; slug: string; status: string; severity: string }[];
}

export async function getRunbook(pageId: number) {
  const { data } = await api.get(`/api/rules/${pageId}/runbook`);
  return data as Runbook;
}

export interface SplCommandData {
  id?: number;
  pageId: number;
  command: string;
  group: string;
  syntax: string;
  description: string;
  examples: string;
  pitfalls?: string;
  isFavorite: boolean;
}

export interface SplCommandWithPage extends SplCommandData {
  page: { id: number; title: string; slug: string; updatedAt: string };
}

export async function listSplCommands(params?: { group?: string; q?: string; favorites?: boolean }) {
  const { data } = await api.get('/api/spl', { params });
  return data as SplCommandWithPage[];
}

export async function upsertSplCommand(payload: Omit<SplCommandData, 'id'>) {
  const { data } = await api.post('/api/spl', payload);
  return data as SplCommandData;
}

export async function updateSplCommand(id: number, payload: Partial<SplCommandData>) {
  const { data } = await api.put(`/api/spl/${id}`, payload);
  return data as SplCommandData;
}

export async function seedSplLibrary() {
  const { data } = await api.post('/api/spl/seed');
  return data;
}

export interface TagWithCount {
  id: number;
  name: string;
  color?: string;
  description?: string;
  category?: string;
  _count: { pages: number };
}

export async function getTags() {
  const { data } = await api.get('/api/tags');
  return data as TagWithCount[];
}

export interface SearchResult {
  id: number;
  title: string;
  slug: string;
  type: string;
  snippet: string;
}

export interface SearchResults {
  pages: SearchResult[];
  rules: SearchResult[];
  splCommands: SearchResult[];
}

export async function search(q: string) {
  const { data } = await api.get('/api/search', { params: { q } });
  return data as SearchResults;
}

export interface BackupLog {
  id: number;
  fileName: string;
  sizeBytes: number;
  type: string;
  createdAt: string;
}

export async function createJsonBackup() {
  const { data } = await api.post('/api/backup/json');
  return data as { fileName: string; sizeBytes: number; downloadUrl: string };
}

export async function listBackups() {
  const { data } = await api.get('/api/backup/list');
  return data as BackupLog[];
}

export async function deleteBackup(id: number) {
  await api.delete(`/api/backup/${id}`);
}

export async function downloadBackup(fileName: string) {
  const response = await api.get(`/api/backup/download/${encodeURIComponent(fileName)}`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function restoreFromJson(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post('/api/backup/restore/json', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data as { restored: number; skipped: number; errors: string[] };
}

// --- Tag management (with color/description/category) ---

export interface TagDetail {
  id: number;
  name: string;
  color: string;
  description?: string;
  category?: string;
  _count?: { pages: number };
}

export async function listTagsAll() {
  const { data } = await api.get('/api/tags', { params: { all: true } });
  return data as TagDetail[];
}

export async function createTag(payload: { name: string; color: string; description?: string; category?: string }) {
  const { data } = await api.post('/api/tags', payload);
  return data as TagDetail;
}

export async function updateTag(id: number, payload: Partial<{ name: string; color: string; description: string; category: string }>) {
  const { data } = await api.put(`/api/tags/${id}`, payload);
  return data as TagDetail;
}

export async function deleteTag(id: number) {
  await api.delete(`/api/tags/${id}`);
}

// --- User management ---

export interface UserData {
  id: number;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  isActive: boolean;
  createdAt: string;
  userRoles: { role: { id: number; name: string } }[];
}

export interface RoleData {
  id: number;
  name: string;
  description?: string;
  isSystemRole: boolean;
}

export async function listUsers() {
  const { data } = await api.get('/api/users');
  return data as UserData[];
}

export async function listRoles() {
  const { data } = await api.get('/api/users/roles');
  return data as RoleData[];
}

export async function createUser(payload: {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  roleIds?: number[];
}) {
  const { data } = await api.post('/api/users', payload);
  return data as UserData;
}

export async function updateUserRoles(userId: number, roleIds: number[]) {
  const { data } = await api.put(`/api/users/${userId}/roles`, { roleIds });
  return data as UserData;
}

export async function toggleUser(userId: number) {
  const { data } = await api.patch(`/api/users/${userId}/toggle`);
  return data as { id: number; username: string; isActive: boolean };
}

export async function resetUserPassword(userId: number, newPassword: string) {
  const { data } = await api.put(`/api/users/${userId}/password`, { newPassword });
  return data as { message: string };
}

export interface AuditEntry {
  id: number;
  action: string;
  resourceType: string;
  resourceId?: number;
  newValue?: unknown;
  oldValue?: unknown;
  ipAddress?: string;
  timestamp: string;
  user?: { username: string };
}

export async function listAuditLogs(page = 1) {
  const { data } = await api.get('/api/users/audit', { params: { page, limit: 50 } });
  return data as { logs: AuditEntry[]; total: number; page: number; limit: number };
}

// --- Documentation generation ---

export interface GeneratedDoc {
  id: number;
  title: string;
  format: string;
  fileSize?: number;
  isPublic: boolean;
  generatedAt: string;
  generatedBy?: { username: string };
}

export async function listGeneratedDocs() {
  const { data } = await api.get('/api/docs');
  return data as GeneratedDoc[];
}

export async function generateHTMLReport(payload: {
  title: string;
  pageIds: number[];
  ruleIds: number[];
  includeTableOfContents?: boolean;
}) {
  const { data } = await api.post('/api/docs/html', payload);
  return data as { document: GeneratedDoc; downloadUrl: string };
}

export async function generatePDFReport(payload: {
  title: string;
  pageIds: number[];
  ruleIds: number[];
}) {
  const { data } = await api.post('/api/docs/pdf', payload);
  return data as { document: GeneratedDoc; downloadUrl: string };
}

export async function generateDetectionMatrix(payload: { title?: string; tagIds?: number[] }) {
  const { data } = await api.post('/api/docs/matrix', payload);
  return data as { document: GeneratedDoc; downloadUrl: string };
}

export async function exportPageAsPDF(slug: string) {
  const { data } = await api.get(`/api/docs/page/${slug}/pdf`);
  return data as { document: GeneratedDoc; downloadUrl: string };
}

export async function downloadGeneratedDoc(docId: number, filename: string) {
  const response = await api.get(`/api/docs/${docId}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function deleteGeneratedDoc(docId: number) {
  await api.delete(`/api/docs/${docId}`);
}

// --- Page Types ---

export interface PageTypeDefinition {
  id: number;
  name: string;
  label: string;
  color: string;
  isBuiltIn: boolean;
  createdAt: string;
}

export async function listPageTypes() {
  const { data } = await api.get('/api/page-types');
  return data as PageTypeDefinition[];
}

export async function createPageType(payload: { name: string; label: string; color?: string }) {
  const { data } = await api.post('/api/page-types', payload);
  return data as PageTypeDefinition;
}

export async function deletePageType(name: string) {
  await api.delete(`/api/page-types/${encodeURIComponent(name)}`);
}

// --- Sysmon Events ---

export interface SysmonEvent {
  id: number;
  eventId: number;
  name: string;
  category: string;
  description: string;
  keyFields?: string | null;
  detectionTips?: string | null;
  attackPatterns?: string | null;
  detectionValue: string;
  isBuiltIn: boolean;
  createdAt: string;
  ruleCount: number;
  dataSourceCount: number;
  otherPageCount: number;
}

export interface SysmonEventPages {
  rules: SysmonLinkedPage[];
  dataSources: SysmonLinkedPage[];
  otherPages: SysmonLinkedPage[];
}

/** Pages linked to a Sysmon event (by event ID), loaded when its card opens. */
export async function getSysmonEventPages(eventId: number) {
  const { data } = await api.get(`/api/sysmon-events/${eventId}/pages`);
  return data as SysmonEventPages;
}

export interface SysmonLinkedPage {
  id: number;
  title: string;
  slug: string;
  type: string;
  source: 'auto' | 'manual';
  basis?: LinkBasis;
  status: string | null;
  severity: string | null;
}

export async function listSysmonEvents(params?: { category?: string; q?: string }) {
  const { data } = await api.get('/api/sysmon-events', { params });
  return data as SysmonEvent[];
}

/** Sets the manually chosen Sysmon events of a page (auto-detected links are kept). */
export async function setPageSysmonLinks(pageId: number, eventIds: number[]) {
  const { data } = await api.put(`/api/sysmon-events/links/${pageId}`, { eventIds });
  return data as PageSysmonLink[];
}

// --- Sigma ---

export interface SigmaTarget {
  id: string;
  label: string;
  language: string;
}

export interface SigmaConversion {
  target: SigmaTarget;
  queries: string[];
  pipelineApplied: boolean;
}

export interface SigmaImportResult {
  created: { title: string; slug: string; format?: RuleSourceFormat }[];
  updated: { title: string; slug: string; format?: RuleSourceFormat }[];
  skipped: { title: string; reason: string }[];
  errors: { file: string; error: string }[];
  warnings: string[];
}

export async function getSigmaTargets() {
  const { data } = await api.get('/api/sigma/targets');
  return data as { available: boolean; targets: SigmaTarget[]; error?: string };
}

export async function convertSigma(rule: string, target: string) {
  const { data } = await api.post('/api/sigma/convert', { rule, target });
  return data as SigmaConversion;
}

/** Imports Sigma / Splunk ESCU / Sentinel YAML and Elastic TOML rules (format detected per file). */
export async function importRules(payload: {
  files: { name: string; content: string }[];
  overwrite?: boolean;
  convertTo?: string | null;
  /** 'draft' (default): imported rules start as drafts; 'source': keep the vendor's status */
  status?: 'draft' | 'source';
  /** Entries (by `where`, as the preview names them) to leave out */
  skip?: string[];
}) {
  const { data } = await api.post('/api/rules-import', payload);
  return data as SigmaImportResult;
}

export interface ImportPreviewItem {
  /** File (and document) the rule came from; identifies it for `skip` */
  where: string;
  format?: RuleSourceFormat;
  title?: string;
  /** repeated: the same rule appears earlier in the upload */
  status: 'new' | 'changed' | 'unchanged' | 'repeated' | 'error';
  error?: string;
  existing?: { title: string; slug: string; status: string };
  changes?: { field: string; label: string; before: string; after: string }[];
  /** Existing rules with the same title (possibly the same detection from another source) */
  similar?: { title: string; slug: string; sourceFormat: RuleSourceFormat | null }[];
}

/** What importing these files would do, without saving anything. */
export async function previewRuleImport(files: { name: string; content: string }[]) {
  const { data } = await api.post('/api/rules-import/preview', { files });
  return data as { items: ImportPreviewItem[] };
}

export function saveBlob(data: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Downloads one rule as Sigma YAML; resolves to true when it was a generated skeleton. */
export async function downloadSigmaRule(pageId: number, slug: string) {
  const response = await api.get(`/api/sigma/export/${pageId}`, { responseType: 'text' });
  saveBlob(response.data, `${slug}.yml`, 'application/yaml');
  return response.headers['x-sigma-skeleton'] === 'true';
}

/** Downloads all rules as one multi-document Sigma YAML; resolves to the number of rules. */
/** Sigma export of every rule, the rules matching a list filter, or the given rule ids. */
export async function downloadSigmaRules(params: { skeletons?: boolean; ids?: number[]; filter?: RuleListFilter }) {
  const response = await api.get('/api/sigma/export', {
    params: {
      ...(params.ids ? { ids: params.ids.join(',') } : params.filter),
      skeletons: params.skeletons ? '1' : undefined,
    },
    responseType: 'text',
  });
  saveBlob(response.data, 'detectkb-sigma-rules.yml', 'application/yaml');
  return Number(response.headers['x-sigma-rule-count'] ?? 0);
}

// --- MITRE ATT&CK ---

export interface AttackTactic {
  id: string;
  shortname: string;
  name: string;
}

export interface AttackTechnique {
  id: string;
  name: string;
  tactics: string[];
  /** Windows, Linux, macOS, IaaS, … (empty: not known) */
  platforms: string[];
}

/** One of MITRE's analytics for a technique: what to look for on a platform and in which logs. */
export interface AttackAnalytic {
  id: string;
  platforms: string[];
  description: string;
  logSources: { name: string; channel: string; component: string }[];
  tunables: { field: string; description: string }[];
}

export interface DetectionStrategy {
  id: string;
  name: string;
  analytics: AttackAnalytic[];
}

export interface CoveringRule {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  validation: ValidationStatus;
  /** Whether its logs are collected */
  feed: RuleFeed;
}

export interface CoverageFilters {
  status?: string;
  /** Proven coverage: only rules whose latest lab test detected the attack */
  validatedOnly?: boolean;
  /** Leave out rules whose logs aren't collected */
  withLogs?: boolean;
  /** Only techniques on these ATT&CK platforms */
  platforms?: string[];
}

const coverageParams = (f: CoverageFilters) => ({
  status: f.status || undefined,
  validation: f.validatedOnly ? 'validated' : undefined,
  logs: f.withLogs ? 'collected' : undefined,
  platforms: f.platforms?.length ? f.platforms.join(',') : undefined,
});

export interface AttackCoverage {
  attackVersion: string | null;
  tactics: AttackTactic[];
  techniques: AttackTechnique[];
  /** Every platform ATT&CK names, most common first */
  platforms: string[];
  /** Parent cell → how many of its rules can't fire (logs not collected) */
  parentBlind: Record<string, number>;
  /** Rules per technique or sub-technique ID */
  counts: Record<string, number>;
  /** Rules per parent technique, counting its sub-techniques' rules once each */
  parentCounts: Record<string, number>;
  unknownTechniques: { id: string; rules: CoveringRule[] }[];
  retiredTechniques: { id: string; replacedBy: string; rules: CoveringRule[] }[];
  /** Best confidence among the rules of each technique / sub-technique, and of each parent cell */
  confidence: Record<string, CoverageConfidence | null>;
  parentConfidence: Record<string, CoverageConfidence | null>;
  summary: {
    rulesAnalyzed: number;
    coveredTechniques: number;
    totalTechniques: number;
    /** Covered (parent) techniques by their best rule's confidence */
    confidence: Record<CoverageConfidence, number>;
    /** Whether anyone said which logs are collected (Log Sources) */
    collectionActive: boolean;
    /** Matching rules whose logs aren't collected */
    blindRules: number;
    /** Covered techniques whose every rule is blind */
    blindTechniques: number;
  };
}

/**
 * How far a technique's coverage can be trusted, from its best rule: a deployed
 * (production / testing) rule proven in the lab, production, testing, draft.
 */
export type CoverageConfidence = 'validated' | 'production' | 'testing' | 'draft';

export async function getAttackCoverage(filters: CoverageFilters = {}) {
  const { data } = await api.get('/api/attack/coverage', { params: coverageParams(filters) });
  return data as AttackCoverage;
}

/** Rules covering a technique and each of its sub-techniques, keyed by ID. */
export async function getTechniqueRules(id: string, filters: CoverageFilters = {}) {
  const { data } = await api.get(`/api/attack/techniques/${encodeURIComponent(id)}/rules`, { params: coverageParams(filters) });
  return data as Record<string, CoveringRule[]>;
}

/** The coverage matrix's headline numbers as they were on a day. */
export interface CoverageSnapshot {
  day: string;
  attackVersion: string | null;
  totalTechniques: number;
  /** Parent techniques with a production or testing rule */
  deployed: number;
  production: number;
  validated: number;
  /** …with a deployed rule whose logs are collected (null before collection was filled in) */
  withLogs: number | null;
  anyRule: number;
  rules: { total: number; byStatus: Record<string, number>; blind: number };
  byTactic: Record<string, { covered: number; total: number }>;
}

export async function getCoverageHistory(days = 180) {
  const { data } = await api.get('/api/attack/coverage/history', { params: { days } });
  return data as CoverageSnapshot[];
}

export async function takeCoverageSnapshot() {
  const { data } = await api.post('/api/attack/coverage/snapshot');
  return data as CoverageSnapshot;
}

export async function downloadNavigatorLayer(filters: CoverageFilters = {}) {
  const response = await api.get('/api/attack/navigator-layer', { params: coverageParams(filters), responseType: 'text' });
  saveBlob(response.data, 'detectkb-attack-layer.json', 'application/json');
}

// --- Activity / Audit ---

export interface DailyLoginCount { date: string; count: number; }
export interface ActionBreakdown { action: string; count: number; }
export interface UserLoginCount { username: string; count: number; }
export interface ActivityLog {
  id: number;
  action: string;
  resourceType: string | null;
  timestamp: string;
  username: string | null;
  ipAddress: string | null;
}
export interface ActivityStats {
  dailyLogins: DailyLoginCount[];
  actionBreakdown: ActionBreakdown[];
  userLogins: UserLoginCount[];
  recentLogs: ActivityLog[];
  summary: { totalLogins: number; failedLogins: number; totalActions: number; activeUsers: number };
}

export async function getActivityStats(days = 30) {
  const { data } = await api.get('/api/activity/stats', { params: { days } });
  return data as ActivityStats;
}

// --- Attacker tool references (LOLBAS / GTFOBins / LOLDrivers) ---

export type ReferenceKind = 'lolbas' | 'gtfobins' | 'loldrivers';

export interface ReferenceDataset {
  kind: ReferenceKind;
  label: string;
  url: string;
  site: string;
  license: string;
  count: number;
  covered: number;
  fetchedAt: string | null;
  source: string | null;
}

export interface ReferenceSummary {
  key: string;
  name: string;
  description: string;
  categories: string[];
  mitre: string[];
  verified?: boolean;
  /** Rules mentioning it (the list itself is on the detail) */
  ruleCount: number;
}

export interface ReferenceDetail {
  kind: ReferenceKind;
  key: string;
  name: string;
  data: Record<string, unknown>;
  rules: CoveringRule[];
}

export async function listReferenceDatasets() {
  const { data } = await api.get('/api/references');
  return data as ReferenceDataset[];
}

export async function listReferences(kind: ReferenceKind, params?: { q?: string; covered?: 'yes' | 'no' }) {
  const { data } = await api.get(`/api/references/${kind}`, { params });
  return data as ReferenceSummary[];
}

export async function getReference(kind: ReferenceKind, key: string) {
  const { data } = await api.get(`/api/references/${kind}/${encodeURIComponent(key)}`);
  return data as ReferenceDetail;
}

export async function getPageReferences(pageId: number) {
  const { data } = await api.get(`/api/references/page/${pageId}`);
  return data as { kind: ReferenceKind; key: string; name: string }[];
}

export async function updateReferenceData(kinds?: ReferenceKind[]) {
  const { data } = await api.post('/api/references/update', { kinds });
  return data as { kind: ReferenceKind; count?: number; error?: string }[];
}

export async function uploadReferenceData(kind: ReferenceKind, fileName: string, content: string) {
  const { data } = await api.post('/api/references/upload', { kind, fileName, content });
  return data as { kind: ReferenceKind; count: number };
}

// --- Knowledge graph ---

export interface GraphNode {
  id: string;
  label: string;
  group: string;
  slug?: string;
  url?: string;
  status?: string;
  severity?: string;
  /** Techniques and tools: rules mapped to / mentioning it */
  ruleCount?: number;
  /** Technique or tool no rule covers */
  gap?: boolean;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: string;
  basis: LinkBasis;
}

/** Placeholder for neighbours not loaded yet ("+659 more"). */
export interface GraphMoreNode {
  id: string;
  label: string;
  group: 'more';
  center: string;
  targetGroup: string;
  remaining: number;
  offset: number;
  /** A whole neighbour group as one card ("58 rules"), opened on click */
  cluster?: boolean;
  /** Cluster members by status (rules) or gap / covered (tools, techniques) */
  breakdown?: Record<string, number>;
  degree: number;
}

export type GraphLayer =
  | 'pages'
  | 'rules'
  | 'technique'
  | 'sysmon'
  | 'logs'
  | 'tools'
  | 'tag'
  | 'category'
  | 'groups'
  | 'software'
  | 'mitigations'
  | 'stories';

export async function getGraph(layers: GraphLayer[]) {
  const { data } = await api.get('/api/graph', { params: { layers: layers.join(',') } });
  return data as { nodes: GraphNode[]; edges: GraphEdge[] };
}

export async function searchGraph(q: string) {
  const { data } = await api.get('/api/graph/search', { params: { q } });
  return data as GraphNode[];
}

export async function getGraphHubs() {
  const { data } = await api.get('/api/graph/hubs');
  return data as GraphNode[];
}

export async function getGraphNeighbours(id: string, page?: { group: string; offset: number; limit?: number }) {
  const { data } = await api.get('/api/graph/node', { params: { id, ...page } });
  return data as { center: GraphNode; nodes: GraphNode[]; more: GraphMoreNode[]; edges: GraphEdge[] };
}

export interface ChainRule {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  sourceFormat: RuleSourceFormat | null;
  dataSource: string | null;
  techniques: string[];
  /** Telemetry keys: sysmon:10, windows-security:4688, … */
  telemetry: string[];
  tools: { kind: ReferenceKind; key: string; name: string }[];
}

export interface ChainTelemetry {
  key: string;
  label: string;
  source: string;
  sourceLabel: string;
  ruleCount: number;
}

export interface DetectionChain {
  technique: { id: string; name: string };
  tactics: AttackTactic[];
  techniques: { id: string; name: string; ruleCount: number }[];
  rules: ChainRule[];
  telemetry: ChainTelemetry[];
  dataSources: { pageId: number; title: string; slug: string; telemetry: string[] }[];
}

export async function getGraphPaths(from: string, to: string, opts: { status?: string; links?: boolean; strict?: boolean } = {}) {
  const { data } = await api.get('/api/graph/path', {
    params: { from, to, status: opts.status || undefined, links: opts.links ? '1' : undefined, strict: opts.strict ? '1' : undefined },
  });
  return data as { paths: string[][]; nodes: GraphNode[]; edges: GraphEdge[]; linksWouldHelp: boolean };
}

export interface ImpactedRule {
  /** Telemetry needed all at once (from "A AND B" data sources) */
  groups: string[][];
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  techniques: string[];
  /** Telemetry keys the rule reads (any of them can feed it) */
  telemetry: string[];
  /** lost: no telemetry left · atRisk: names other sources that may feed it · partial: some telemetry left */
  level: 'lost' | 'atRisk' | 'partial';
  lostEvents: string[];
  alternatives: string[];
  /** blind: it already can't fire with what is collected today */
  feed: RuleFeed;
}

export interface TechniqueImpact {
  id: string;
  name: string;
  rules: number;
  lost: number;
  atRisk: number;
}

export interface ImpactAnalysis {
  /** Whole sources lost */
  sources: { key: string; label: string }[];
  /** Every telemetry key lost */
  events: string[];
  /** Labels of the telemetry keys the listed rules read */
  labels: Record<string, string>;
  rules: ImpactedRule[];
  counts: { activeRules: number; lost: number; atRisk: number; partial: number };
  uncovered: TechniqueImpact[];
  reduced: TechniqueImpact[];
}

/** What stops working if these log sources, events (telemetry keys) or a data source page's events are lost. */
export async function getImpact(params: { sources?: string[]; events?: string[]; dataSource?: number; collection?: boolean }) {
  const list = (v?: string[]) => (v?.length ? v.join(',') : undefined);
  const { data } = await api.get('/api/graph/impact', {
    params: { sources: list(params.sources), events: list(params.events), dataSource: params.dataSource, collection: params.collection ? 1 : undefined },
  });
  return data as ImpactAnalysis;
}

export interface FlowSource {
  /** src:<source> · ev:<telemetry key> · other:<source> (its small events) · none */
  id: string;
  kind: 'source' | 'event' | 'other' | 'none';
  /** Source key (source, other) or telemetry key (event) */
  key: string | null;
  label: string;
  rules: number;
}

export interface CoverageFlows {
  sources: FlowSource[];
  targets: { id: string; label: string; rules: number }[];
  links: { source: string; target: string; rules: number }[];
  rules: number;
}

/** Rules per (telemetry → tactic), or → technique within one tactic. */
export async function getCoverageFlows(params: {
  status?: string;
  source?: string;
  tactic?: string;
  groupBy?: 'source' | 'event';
  /** Only this log source's events */
  telemetry?: string;
  withoutTelemetry?: '0';
}) {
  const { data } = await api.get('/api/graph/flows', { params });
  return data as CoverageFlows;
}

export interface ToolGaps {
  summary: { tools: number; toolsWithoutRules: number; techniques: number; techniquesWithoutRules: number };
  techniques: {
    id: string;
    name: string;
    tactics: string[];
    /** Rules on the technique (and its sub-techniques) */
    rules: number;
    uncoveredTools: number;
    tools: { id: string; name: string; kind: string; ruleCount: number }[];
  }[];
}

export async function getToolGaps(kind?: string) {
  const { data } = await api.get('/api/graph/gaps', { params: { kind: kind || undefined } });
  return data as ToolGaps;
}

export async function getDetectionChain(technique: string, status?: string) {
  const { data } = await api.get('/api/graph/chain', { params: { technique, status: status || undefined } });
  return data as DetectionChain;
}

// ── Log sources (telemetry other than Sysmon for Windows) ─────────────────────

export interface LogSourceSummary {
  key: string;
  label: string;
  platform: string;
  /** Specific events (not counting "any event") */
  events: number;
  rules: number;
}

export interface LogEventRow {
  key: string;
  source: string;
  sourceLabel: string;
  /** Event ID or name; "*" = any event of the source */
  code: string;
  name: string;
  rules: number;
  dataSources: number;
}

export async function listLogSources() {
  const { data } = await api.get('/api/log-sources');
  return data as LogSourceSummary[];
}

export async function listLogEvents(source: string) {
  const { data } = await api.get(`/api/log-sources/${encodeURIComponent(source)}/events`);
  return data as LogEventRow[];
}

export async function getLogEventPages(key: string) {
  const { data } = await api.get('/api/log-sources/events/pages', { params: { key } });
  return data as { rules: SysmonLinkedPage[]; dataSources: SysmonLinkedPage[] };
}

// ── What is collected ────────────────────────────────────────────────────────

/** An answer for a log source ("sysmon") or one event ("sysmon:10"); an event's own answer overrides its source's. */
export type CollectionState = 'collected' | 'not-collected' | 'unknown';

/** fed: its logs are collected · blind: they aren't, it can't fire · unknown: not decided */
export type RuleFeed = 'fed' | 'blind' | 'unknown';

export interface CollectionInfo {
  /** Whether anything was answered yet */
  active: boolean;
  entries: { key: string; collected: boolean; note: string | null; updatedAt: string }[];
  /** Rules that aren't deprecated, by feed */
  rules: { fed: number; blind: number; unknown: number; blindDeployed: number; blindProduction: number };
}

export async function getCollection() {
  const { data } = await api.get('/api/log-sources/collection');
  return data as CollectionInfo;
}

/** `collected: null` removes the answer. */
export async function setCollection(items: { key: string; collected: boolean | null; note?: string }[]) {
  const { data } = await api.put('/api/log-sources/collection', { items });
  return data as { updated: number };
}

export interface CollectionOpportunities {
  active: boolean;
  readyTotal: number;
  readyFillingGaps: number;
  /** Draft rules whose logs are collected; `fills`: techniques nothing deployed covers */
  ready: { pageId: number; title: string; slug: string; status: string; severity: string; fills: { id: string; name: string }[] }[];
  /** Sources not (known to be) collected, by what collecting them would feed */
  sources: {
    source: string;
    label: string;
    state: CollectionState;
    rules: number;
    deployedRules: number;
    techniqueCount: number;
    techniques: { id: string; name: string }[];
  }[];
}

export async function getCollectionOpportunities() {
  const { data } = await api.get('/api/log-sources/collection/opportunities');
  return data as CollectionOpportunities;
}

export interface RuleCollection {
  active: boolean;
  feed: RuleFeed;
  telemetry: { key: string; label: string; state: CollectionState }[];
  /** Labels of the rule's telemetry marked as not collected */
  missing: string[];
}

export async function getRuleCollection(pageId: number) {
  const { data } = await api.get(`/api/log-sources/collection/rule/${pageId}`);
  return data as RuleCollection;
}

export async function getPageLogEvents(pageId: number) {
  const { data } = await api.get(`/api/log-sources/page/${pageId}`);
  return data as { key: string; source: string; sourceLabel: string; code: string; name: string }[];
}

// ── Threat intel: ATT&CK groups, software, mitigations, D3FEND ───────────────

export interface ActorSummary {
  id: string;
  name: string;
  aliases: string[];
  /** Techniques it uses */
  total: number;
  covered: number;
  /** Sub-techniques detected only by rules on the parent technique */
  parentOnly: number;
  pct: number;
}

export interface GroupSummary extends ActorSummary {
  software: number;
  /** On the organisation's watchlist */
  watched: boolean;
}

export interface SoftwareSummary extends ActorSummary {
  type: 'malware' | 'tool';
  platforms: string[];
}

export interface ActorTechnique {
  id: string;
  name: string;
  tactics: string[];
  rules: number;
  state: 'covered' | 'parent' | 'none';
}

export interface ActorCoverage {
  techniques: ActorTechnique[];
  total: number;
  covered: number;
  parentOnly: number;
  pct: number;
}

export interface GroupDetail {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  url: string;
  coverage: ActorCoverage;
  software: { id: string; name: string; type: 'malware' | 'tool'; total: number; covered: number; parentOnly: number; pct: number }[];
  watched: boolean;
  watchNote: string | null;
}

export interface SoftwareDetail {
  id: string;
  name: string;
  type: 'malware' | 'tool';
  aliases: string[];
  platforms: string[];
  description: string;
  url: string;
  coverage: ActorCoverage;
  groups: { id: string; name: string }[];
}

/** `inDescription`: also search the groups' descriptions (targeted sectors and countries) */
export async function listThreatGroups(params: { q?: string; status?: string; inDescription?: boolean } = {}) {
  const { data } = await api.get('/api/threat-intel/groups', {
    params: { q: params.q || undefined, status: params.status || undefined, desc: params.inDescription ? '1' : undefined },
  });
  return data as GroupSummary[];
}

export interface WatchTechnique {
  id: string;
  name: string;
  tactics: string[];
  /** Watched groups using it */
  groups: string[];
  /** By deployed (production / testing) rules */
  state: 'covered' | 'parent' | 'none';
  deployedRules: number;
  draftRules: number;
  /** Only in Reconnaissance / Resource Development: rarely detectable with your telemetry */
  preCompromise: boolean;
}

export interface WatchDraft {
  pageId: number;
  title: string;
  slug: string;
  severity: string;
  /** Gap (or parent-only) techniques it would cover */
  fills: string[];
  /** Watched groups whose gaps it would close */
  groups: string[];
  /** Already covered techniques it adds depth to */
  depth: string[];
}

export interface Watchlist {
  groups: (ActorSummary & { note: string | null; addedAt: string })[];
  summary: {
    techniques: number;
    covered: number;
    parentOnly: number;
    gaps: number;
    /** Open techniques before the attacker reaches your systems */
    preCompromise: number;
    /** Open techniques (not pre-compromise) without a draft either */
    openWithoutDraft: number;
    draftsFillingGaps: number;
    /** Rules left out because their logs aren't collected */
    rulesWithoutLogs: number;
  };
  techniques: WatchTechnique[];
  drafts: WatchDraft[];
}

export async function getWatchlist() {
  const { data } = await api.get('/api/threat-intel/watchlist');
  return data as Watchlist;
}

export async function watchGroup(id: string, note?: string) {
  await api.put(`/api/threat-intel/watchlist/${id}`, note === undefined ? {} : { note });
}

export async function unwatchGroup(id: string) {
  await api.delete(`/api/threat-intel/watchlist/${id}`);
}

export async function getThreatGroup(id: string, status?: string) {
  const { data } = await api.get(`/api/threat-intel/groups/${id}`, { params: { status: status || undefined } });
  return data as GroupDetail;
}

export async function listSoftware(params: { q?: string; type?: string; status?: string } = {}) {
  const { data } = await api.get('/api/threat-intel/software', {
    params: { q: params.q || undefined, type: params.type || undefined, status: params.status || undefined },
  });
  return data as SoftwareSummary[];
}

export async function getSoftware(id: string, status?: string) {
  const { data } = await api.get(`/api/threat-intel/software/${id}`, { params: { status: status || undefined } });
  return data as SoftwareDetail;
}

export interface TechniqueContext {
  id: string;
  name: string;
  platforms: string[];
  description: string | null;
  /** MITRE's detection strategy: analytics per platform with the log sources they read */
  detection: DetectionStrategy[];
  /** Free-text guidance of ATT&CK releases without detection strategies */
  detectionText: string | null;
  /** `via`: the technique IDs (the technique or its sub-techniques) the item lists */
  mitigations: { id: string; name: string; description: string; url: string; via: string[] }[];
  groups: { id: string; name: string; via: string[] }[];
  software: { id: string; name: string; type: 'malware' | 'tool'; via: string[] }[];
}

export async function getTechniqueContext(id: string) {
  const { data } = await api.get(`/api/threat-intel/techniques/${id}`);
  return data as TechniqueContext;
}

export interface D3fendResult {
  techniqueId: string;
  pageUrl: string;
  available: boolean;
  countermeasures: { name: string; tactic: string | null; artifact: string | null; url: string | null }[];
  fetchedAt: string | null;
  error?: string;
}

export async function getD3fend(id: string) {
  const { data } = await api.get(`/api/threat-intel/techniques/${id}/d3fend`);
  return data as D3fendResult;
}

// ── Analytic stories (Splunk) ─────────────────────────────────────────────────

export interface StorySummary {
  id: number;
  name: string;
  category: string | null;
  usecase: string | null;
  description: string | null;
  hasDetails: boolean;
  rules: number;
  activeRules: number;
  production: number;
  techniques: number;
}

export interface StoryDetail {
  id: number;
  name: string;
  externalId: string | null;
  description: string | null;
  narrative: string | null;
  references: string[];
  category: string | null;
  usecase: string | null;
  detailsFrom: string | null;
  rules: { pageId: number; title: string; slug: string; status: string; severity: string; techniques: string[] }[];
  techniques: { id: string; name: string; rules: number; activeRules: number }[];
  statusCounts: Record<string, number>;
}

export async function listStories(q?: string) {
  const { data } = await api.get('/api/stories', { params: { q: q || undefined } });
  return data as { source: string; stories: StorySummary[] };
}

export async function getStory(id: number) {
  const { data } = await api.get(`/api/stories/${id}`);
  return data as StoryDetail;
}

export async function importStoryFiles(files: { name: string; content: string }[]) {
  const { data } = await api.post('/api/stories/import', { files });
  return data as { imported: number; skipped: string[] };
}

export async function fetchStoryDetails(all = false) {
  const { data } = await api.post('/api/stories/fetch', { all });
  return data as { fetched: number; missing: string[] };
}

// ── Atomic Red Team ───────────────────────────────────────────────────────────

/**
 * How a rule relates to an atomic test of its technique: its telemetry is among
 * what the test should produce, it reads an EDR product, it reads other
 * telemetry, or it has no telemetry links.
 */
export type AtomicRuleMatch = 'telemetry' | 'edr' | 'other-telemetry' | 'unknown';

export interface AtomicTestSummary {
  guid: string;
  techniqueId: string;
  techniqueName: string | null;
  testNumber: number;
  name: string;
  platforms: string[];
  executor: string;
  elevationRequired: boolean;
  expectedTelemetry: string[];
  rules: Record<AtomicRuleMatch, number>;
}

export interface AtomicTestDetail {
  guid: string;
  techniqueId: string;
  techniqueName: string | null;
  testNumber: number;
  name: string;
  description: string | null;
  platforms: string[];
  executor: string;
  elevationRequired: boolean;
  command: string | null;
  cleanupCommand: string | null;
  resolvedCommand: string | null;
  resolvedCleanup: string | null;
  inputArguments: { name: string; description: string; type: string; default: string }[];
  dependencies: { description: string; prereqCommand: string; getPrereqCommand: string }[];
  dependencyExecutor: string | null;
  expectedTelemetry: { key: string; why: string; source: string; sourceLabel: string; label: string }[];
  invoke: string;
  fileUrl: string;
  source: string;
  updatedAt: string;
  rules: {
    pageId: number;
    title: string;
    slug: string;
    status: string;
    severity: string;
    relation: 'exact' | 'parent';
    match: AtomicRuleMatch;
    sharedTelemetry: string[];
  }[];
  ruleCounts: Record<AtomicRuleMatch, number>;
}

export interface AtomicList {
  repository: string;
  indexUrl: string;
  total: number;
  techniques: number;
  updatedAt: string | null;
  source: string | null;
  /** Tests matching the filters; `tests` holds the first `limit` of them */
  matching: number;
  tests: AtomicTestSummary[];
}

export async function listAtomicTests(params: { q?: string; technique?: string; platform?: string; executor?: string; match?: string; limit?: number } = {}) {
  const { data } = await api.get('/api/atomics', { params: Object.fromEntries(Object.entries(params).filter(([, v]) => v)) });
  return data as AtomicList;
}

export async function getAtomicTest(guid: string) {
  const { data } = await api.get(`/api/atomics/${encodeURIComponent(guid)}`);
  return data as AtomicTestDetail;
}

export async function getTechniqueAtomics(techniqueId: string) {
  const { data } = await api.get(`/api/atomics/technique/${encodeURIComponent(techniqueId)}`);
  return data as { techniqueId: string; tests: AtomicTestSummary[] };
}

export interface RuleAtomicTest {
  guid: string;
  techniqueId: string;
  testNumber: number;
  name: string;
  platforms: string[];
  executor: string;
  relation: 'exact' | 'parent';
  match: AtomicRuleMatch;
  sharedTelemetry: string[];
  invoke: string;
}

export async function getRuleAtomics(pageId: number) {
  const { data } = await api.get(`/api/atomics/rule/${pageId}`);
  return data as { pageId: number; techniques: string[]; tests: RuleAtomicTest[] };
}

export interface AtomicImportResult {
  added: number;
  updated: number;
  removed: number;
  techniques: number;
  tests: number;
  skipped?: string[];
}

export async function importAtomicFiles(files: { name: string; content: string }[]) {
  const { data } = await api.post('/api/atomics/import', { files });
  return data as AtomicImportResult;
}

export async function fetchAtomicIndex() {
  const { data } = await api.post('/api/atomics/fetch');
  return data as AtomicImportResult;
}

// ── Lab validation ────────────────────────────────────────────────────────────

export type RunResult = 'detected' | 'not-detected' | 'partial' | 'blocked' | 'error';
export type ValidationStatus = 'validated' | 'partial' | 'failed' | 'stale' | 'never';

export interface TestRun {
  id: number;
  pageId: number;
  atomicGuid: string | null;
  techniqueId: string | null;
  testName: string;
  result: RunResult;
  executedAt: string;
  environment: string | null;
  evidence: string | null;
  notes: string | null;
  createdAt: string;
  recordedBy: { username: string } | null;
}

export interface RuleValidationInfo {
  pageId: number;
  status: ValidationStatus;
  reason?: 'query-changed' | 'too-old';
  lastRun?: { result: RunResult; executedAt: string };
  runs: (TestRun & { queryChangedSince: boolean })[];
}

export async function getRuleValidation(pageId: number) {
  const { data } = await api.get(`/api/validation/rule/${pageId}`);
  return data as RuleValidationInfo;
}

export async function getAtomicRuns(guid: string) {
  const { data } = await api.get(`/api/validation/atomic/${encodeURIComponent(guid)}`);
  return data as { runs: (TestRun & { page: { title: string; slug: string } })[] };
}

export interface RecordRunInput {
  atomicGuid?: string;
  testName?: string;
  executedAt?: string;
  environment?: string;
  notes?: string;
  results: { pageId: number; result: RunResult; evidence?: string }[];
}

export async function recordTestRun(input: RecordRunInput) {
  const { data } = await api.post('/api/validation/runs', input);
  return data as { recorded: number };
}

export async function deleteTestRun(id: number) {
  await api.delete(`/api/validation/runs/${id}`);
}

export async function getValidationSummary() {
  const { data } = await api.get('/api/validation/summary');
  return data as { byRuleStatus: Record<string, Record<ValidationStatus, number>> };
}

/** The rules as savedsearches.conf for the lab Splunk; returns how many rules it holds. */
export async function downloadSavedSearches(params: { status?: string; scope?: 'all' | 'with-tests'; pageIds?: number[] }) {
  const response = await api.get('/api/validation/export/savedsearches', {
    params: { status: params.status || undefined, scope: params.scope, pageIds: params.pageIds?.length ? params.pageIds.join(',') : undefined },
    responseType: 'text',
  });
  saveBlob(response.data, 'savedsearches.conf', 'text/plain');
  return Number(response.headers['x-rule-count'] ?? 0);
}

// ── Upstream updates ──────────────────────────────────────────────────────────

export interface UpstreamCheckStats {
  files: number;
  rules: number;
  new: number;
  relevantNew: number;
  changed: number;
  unchanged: number;
  dismissed: number;
  errors: number;
}

export interface UpstreamSourceInfo {
  key: string;
  label: string;
  format: string;
  repository: string | null;
  downloadable: boolean;
  options: { value: string; label: string }[];
  option: string | null;
  enabled: boolean;
  running: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  stats: UpstreamCheckStats | null;
  items: { new: number; relevantNew: number; changed: number };
}

export interface UpstreamItem {
  id: number;
  sourceKey: string;
  kind: 'new' | 'changed';
  format: RuleSourceFormat;
  externalId: string | null;
  title: string;
  path: string;
  pageId: number | null;
  changes: { field: string; label: string; before: string; after: string }[] | null;
  severity: string | null;
  sourceStatus: string | null;
  techniques: string | null;
  telemetry: string[];
  relevant: boolean;
  checkedAt: string;
  existing: { title: string; slug: string; status: string | null } | null;
}

export async function getUpstreamSources() {
  const { data } = await api.get('/api/upstream');
  return data as { autoCheckDays: number; sources: UpstreamSourceInfo[] };
}

export async function listUpstreamItems(params: { source?: string; kind?: string; relevant?: boolean; q?: string; page?: number }) {
  const { data } = await api.get('/api/upstream/items', {
    params: { source: params.source || undefined, kind: params.kind, relevant: params.relevant ? 1 : undefined, q: params.q || undefined, page: params.page },
  });
  return data as { total: number; page: number; pageSize: number; items: UpstreamItem[] };
}

export async function getUpstreamItemContent(id: number) {
  const { data } = await api.get(`/api/upstream/items/${id}/content`);
  return data as { path: string; content: string };
}

export async function checkUpstreamSource(source: string) {
  await api.post('/api/upstream/check', { source });
}

export async function checkUpstreamUpload(files: { name: string; content: string }[]) {
  const { data } = await api.post('/api/upstream/check-upload', { files });
  return data as UpstreamCheckStats;
}

export async function updateUpstreamSource(key: string, body: { enabled?: boolean; option?: string }) {
  await api.put(`/api/upstream/sources/${key}`, body);
}

export async function importUpstreamItems(ids: number[], opts: { status?: 'draft' | 'source'; convertTo?: string | null }) {
  const { data } = await api.post('/api/upstream/import', { ids, ...opts });
  return data as SigmaImportResult;
}

export async function dismissUpstreamItems(ids: number[]) {
  const { data } = await api.post('/api/upstream/dismiss', { ids });
  return data as { dismissed: number };
}

// ── Data health ───────────────────────────────────────────────────────────────

export interface HealthCheck {
  id: string;
  title: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  count: number;
  /** ruleId: the item can be fixed in place (false positives) */
  items: { title: string; slug: string; detail?: string; ruleId?: number }[];
  link?: string;
}

export interface DataHealth {
  generatedAt: string;
  rules: number;
  provenance: {
    sysmon: Record<string, number>;
    logs: Record<string, number>;
    tools: { inQuery: number; outsideQuery: number };
  };
  checks: HealthCheck[];
}

export async function getDataHealth() {
  const { data } = await api.get('/api/data-health');
  return data as DataHealth;
}

// ── Similar rules ───────────────────────────────────────────────────────────

export interface SimilarRule {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  sourceFormat: RuleSourceFormat | null;
  /** The most similar other rule of the group (0–1) */
  closest: { pageId: number; similarity: number } | null;
}

export interface SimilarGroup {
  key: string;
  techniques: string[];
  telemetry: { key: string; label: string }[];
  /** Highest similarity between two of its rules (0–1) */
  similarity: number;
  crossSource: boolean;
  rules: SimilarRule[];
}

export interface SimilarRulesResponse {
  summary: { groups: number; rules: number; likely: number; likelyThreshold: number; crossSource: number };
  matching: number;
  groups: SimilarGroup[];
}

export async function listSimilarRules(params: { min?: number; crossSource?: boolean; q?: string }) {
  const { data } = await api.get('/api/similar-rules', {
    params: { min: params.min || undefined, crossSource: params.crossSource ? '1' : undefined, q: params.q || undefined },
  });
  return data as SimilarRulesResponse;
}

export interface ComparedRule {
  pageId: number;
  status: string;
  severity: string;
  sourceFormat: RuleSourceFormat | null;
  dataSource: string | null;
  mitreTechniques: string | null;
  falsePositives: string | null;
  splQuery: string;
  nativeQuery: string | null;
  nativeLanguage: string | null;
  page: { title: string; slug: string; updatedAt: string };
}

export async function compareRules(a: number, b: number) {
  const { data } = await api.get('/api/similar-rules/compare', { params: { a, b } });
  return data as [ComparedRule, ComparedRule];
}

// ── ATT&CK data (in-app update) ─────────────────────────────────────────────

export interface AttackDataInfo {
  version: string | null;
  bundledVersion: string | null;
  /** Set when the data in use was imported in the app */
  imported: { source: string; importedAt: string } | null;
  techniques: number;
  /** False for a release imported before descriptions, platforms and detection strategies were kept */
  hasDetails: boolean;
  groups: number;
  software: number;
  downloadUrl: string;
}

export interface AttackImportResult {
  from: string | null;
  to: string | null;
  techniques: { added: string[]; removed: string[] };
  newlyRevoked: Record<string, string>;
  groups: { added: number; removed: number };
  software: { added: number; removed: number };
  ruleMappings: { added: number; removed: number };
}

export async function getAttackDataInfo() {
  const { data } = await api.get('/api/attack/data');
  return data as AttackDataInfo;
}

export async function downloadAttackData() {
  const { data } = await api.post('/api/attack/data/download', {}, { timeout: 300_000 });
  return data as AttackImportResult;
}

/** enterprise-attack.json from github.com/mitre-attack/attack-stix-data */
export async function uploadAttackData(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post('/api/attack/data/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300_000 });
  return data as AttackImportResult;
}

export async function resetAttackData() {
  const { data } = await api.post('/api/attack/data/reset');
  return data as AttackDataInfo;
}

// ── Data source pages from the log sources rules read ───────────────────────

export interface DataSourcePlan {
  source: string;
  label: string;
  platform: string;
  /** Active rules reading the source */
  rules: number;
  events: { key: string; label: string; rules: number }[];
  /** Data source pages already linked to its events */
  pages: { title: string; slug: string }[];
}

export async function planDataSourcePages() {
  const { data } = await api.get('/api/log-sources/data-source-pages');
  return data as DataSourcePlan[];
}

export async function createDataSourcePages(sources: string[]) {
  const { data } = await api.post('/api/log-sources/data-source-pages', { sources });
  return data as { created: { source: string; title: string; slug: string }[] };
}
