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
}

export interface PageSysmonLink {
  source: 'auto' | 'manual';
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

export type RuleSortKey = 'title' | 'status' | 'severity' | 'updatedAt';

export interface RuleListParams {
  q?: string;
  status?: string;
  severity?: string;
  /** Import format, or "manual" for rules written here */
  source?: string;
  technique?: string;
  tactic?: string;
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
export type RuleBulkTarget = { ids: number[] } | { filter: RuleListFilter };

export type RuleBulkAction = 'status' | 'severity' | 'addTag' | 'removeTag';

export async function bulkUpdateRules(target: RuleBulkTarget, action: RuleBulkAction, value: string) {
  const { data } = await api.put('/api/rules/bulk', { ...target, action, value });
  return data as { matched: number; changed: number };
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
}

export interface CoveringRule {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
}

export interface AttackCoverage {
  attackVersion: string | null;
  tactics: AttackTactic[];
  techniques: AttackTechnique[];
  /** Rules per technique or sub-technique ID */
  counts: Record<string, number>;
  /** Rules per parent technique, counting its sub-techniques' rules once each */
  parentCounts: Record<string, number>;
  unknownTechniques: { id: string; rules: CoveringRule[] }[];
  retiredTechniques: { id: string; replacedBy: string; rules: CoveringRule[] }[];
  summary: { rulesAnalyzed: number; coveredTechniques: number; totalTechniques: number };
}

export async function getAttackCoverage(status?: string) {
  const { data } = await api.get('/api/attack/coverage', { params: { status: status || undefined } });
  return data as AttackCoverage;
}

/** Rules covering a technique and each of its sub-techniques, keyed by ID. */
export async function getTechniqueRules(id: string, status?: string) {
  const { data } = await api.get(`/api/attack/techniques/${encodeURIComponent(id)}/rules`, { params: { status: status || undefined } });
  return data as Record<string, CoveringRule[]>;
}

export async function downloadNavigatorLayer(status?: string) {
  const response = await api.get('/api/attack/navigator-layer', {
    params: { status: status || undefined },
    responseType: 'text',
  });
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

export type GraphLayer = 'pages' | 'rules' | 'technique' | 'sysmon' | 'tools' | 'tag' | 'category';

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
  sysmon: number[];
  tools: { kind: ReferenceKind; key: string; name: string }[];
}

export interface DetectionChain {
  technique: { id: string; name: string };
  tactics: AttackTactic[];
  techniques: { id: string; name: string; ruleCount: number }[];
  rules: ChainRule[];
  sysmon: { eventId: number; name: string; ruleCount: number }[];
  dataSources: { pageId: number; title: string; slug: string; sysmon: number[] }[];
}

export async function getGraphPaths(from: string, to: string, opts: { status?: string; links?: boolean } = {}) {
  const { data } = await api.get('/api/graph/path', { params: { from, to, status: opts.status || undefined, links: opts.links ? '1' : undefined } });
  return data as { paths: string[][]; nodes: GraphNode[]; edges: GraphEdge[]; linksWouldHelp: boolean };
}

export interface ImpactedRule {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  techniques: string[];
  sysmon: number[];
  /** lost: no telemetry left · atRisk: lists other sources that may feed it · partial: some events left */
  level: 'lost' | 'atRisk' | 'partial';
  lostEvents: number[];
  alternatives: string[];
}

export interface TechniqueImpact {
  id: string;
  name: string;
  rules: number;
  lost: number;
  atRisk: number;
}

export interface ImpactAnalysis {
  events: number[];
  rules: ImpactedRule[];
  counts: { activeRules: number; lost: number; atRisk: number; partial: number };
  uncovered: TechniqueImpact[];
  reduced: TechniqueImpact[];
}

/** What stops working if these Sysmon events (or a data source page's events) are lost. */
export async function getImpact(params: { sysmon?: number[]; dataSource?: number }) {
  const { data } = await api.get('/api/graph/impact', {
    params: { sysmon: params.sysmon?.length ? params.sysmon.join(',') : undefined, dataSource: params.dataSource },
  });
  return data as ImpactAnalysis;
}

export interface CoverageFlows {
  sources: { id: string; eventId: number | null; label: string; rules: number }[];
  targets: { id: string; label: string; rules: number }[];
  links: { source: string; target: string; rules: number }[];
  rules: number;
}

/** Rules per (Sysmon event → tactic), or → technique within one tactic. */
export async function getCoverageFlows(params: { status?: string; source?: string; tactic?: string; withoutSysmon?: '0' }) {
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
