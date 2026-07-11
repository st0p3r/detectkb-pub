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

// Response interceptor: on 401 clear token and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Only redirect if this wasn't already a login attempt
      const isLoginEndpoint = error.config?.url?.includes('/api/auth/login');
      if (!isLoginEndpoint) {
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUsername');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

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
}

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
}

export interface Category {
  id: number;
  name: string;
  color?: string;
  parentId?: number | null;
}

export async function listPages(params?: { type?: string; q?: string; categoryId?: number }) {
  const { data } = await api.get('/api/pages', { params });
  return data as Page[];
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

export async function listRules(params?: { status?: string; severity?: string; technique?: string }) {
  const { data } = await api.get('/api/rules', { params });
  return data as RuleWithPage[];
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
}

export async function listSysmonEvents(params?: { category?: string; q?: string }) {
  const { data } = await api.get('/api/sysmon-events', { params });
  return data as SysmonEvent[];
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
