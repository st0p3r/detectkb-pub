import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  BookOpen,
  Shield,
  Terminal,
  Database,
  Lightbulb,
  LayoutDashboard,
  Search,
  Settings,
  Link2Off,
  HardDrive,
  Plus,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Trash2,
  FileText,
  Users,
  Activity,
  Cpu,
  Grid3x3,
  Crosshair,
  Network,
  ScrollText,
  Skull,
  BookMarked,
} from 'lucide-react';
import { listCategories, createCategory, deleteCategory, type Category } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/features/auth/AuthContext';
import { SavedViewsNav } from '@/features/views/SavedViewsNav';

const DEFAULT_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444',
  '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6',
];

const navLinkClasses = (isActive: boolean, collapsed: boolean) =>
  cn(
    'group relative flex items-center rounded-md text-sm transition-all duration-150 outline-none',
    'focus-visible:ring-2 focus-visible:ring-[hsl(var(--sidebar-primary))]/50',
    collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-3 py-2',
    isActive
      ? 'bg-[hsl(var(--sidebar-active-bg))] text-white font-medium'
      : 'text-[hsl(var(--sidebar-foreground))] hover:text-white hover:bg-white/5'
  );

/** Left accent bar shown on the active nav item. */
function ActiveBar({ isActive }: { isActive: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r-full bg-[hsl(var(--sidebar-primary))] transition-opacity duration-150',
        isActive ? 'opacity-100' : 'opacity-0'
      )}
    />
  );
}

function CategoryItem({ cat, collapsed, onDelete }: { cat: Category; collapsed: boolean; onDelete: (cat: Category) => void }) {
  const navigate = useNavigate();
  if (collapsed) {
    return (
      <button
        onClick={() => navigate(`/pages?categoryId=${cat.id}`)}
        title={cat.name}
        aria-label={cat.name}
        className="w-full flex items-center justify-center py-1.5 rounded-md text-[hsl(var(--sidebar-foreground))] hover:text-white hover:bg-white/5 transition-colors"
      >
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: cat.color || '#6366f1' }}
        />
      </button>
    );
  }
  return (
    <div className="group flex items-center gap-1 pl-2 animate-slide-in-left">
      <button
        onClick={() => navigate(`/pages?categoryId=${cat.id}`)}
        className="flex-1 flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-[hsl(var(--sidebar-foreground))] hover:text-white hover:bg-white/5 transition-colors min-w-0"
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-white/5"
          style={{ backgroundColor: cat.color || '#6366f1' }}
        />
        <span className="truncate">{cat.name}</span>
      </button>
      <button
        onClick={() => onDelete(cat)}
        aria-label={`Delete ${cat.name}`}
        title="Delete category"
        className="p-1 rounded opacity-0 group-hover:opacity-100 text-[hsl(var(--sidebar-foreground))] hover:text-destructive hover:bg-destructive/10 transition-all focus-visible:opacity-100 outline-none"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function InlineCategoryForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLORS[0]);

  const mutation = useMutation({
    mutationFn: () => createCategory({ name: name.trim(), color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      onDone();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="px-3 mt-1 space-y-2 animate-fade-in">
      <input
        autoFocus
        type="text"
        placeholder="Category name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full px-2 py-1 rounded border border-[hsl(var(--sidebar-border))] bg-white/5 text-white text-xs placeholder:text-[hsl(var(--sidebar-foreground))]/60 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--sidebar-primary))]/40"
      />
      <div className="flex flex-wrap gap-1">
        {DEFAULT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={cn(
              'w-4 h-4 rounded-full border-2 transition-all',
              color === c ? 'border-white scale-110' : 'border-transparent'
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={mutation.isPending || !name.trim()}
          className="flex-1 px-2 py-1 rounded bg-[hsl(var(--sidebar-primary))] text-white text-xs font-medium disabled:opacity-50 hover:opacity-90 active:scale-[0.98] transition-all"
        >
          {mutation.isPending ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-2 py-1 rounded border border-[hsl(var(--sidebar-border))] text-xs text-[hsl(var(--sidebar-foreground))] hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const mainNavItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
];

const contentNavItems = [
  { to: '/pages', icon: BookOpen, label: 'All Pages' },
  { to: '/rules', icon: Shield, label: 'Detection Rules' },
  { to: '/attack-coverage', icon: Grid3x3, label: 'ATT&CK Coverage' },
  { to: '/spl-library', icon: Terminal, label: 'SPL Library' },
  { to: '/sysmon-events', icon: Cpu, label: 'Sysmon Events' },
  { to: '/log-sources', icon: ScrollText, label: 'Log Sources' },
  { to: '/threat-groups', icon: Skull, label: 'Threat Groups' },
  { to: '/analytic-stories', icon: BookMarked, label: 'Analytic Stories' },
  { to: '/attacker-tools', icon: Crosshair, label: 'Attacker Tools' },
  { to: '/data-sources', icon: Database, label: 'Data Sources' },
  { to: '/concepts', icon: Lightbulb, label: 'Concepts' },
  { to: '/docs', icon: FileText, label: 'Documentation' },
];

const toolsNavItems = [
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/graph', icon: Network, label: 'Knowledge Graph' },
  { to: '/broken-links', icon: Link2Off, label: 'Broken Links' },
  { to: '/backups', icon: HardDrive, label: 'Backups', permission: 'backups:create' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function SectionLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) {
    return <div className="my-2 mx-2 border-t border-[hsl(var(--sidebar-border))]" />;
  }
  return (
    <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold text-[hsl(var(--sidebar-foreground))]/50 uppercase tracking-[0.12em]">
      {label}
    </p>
  );
}

function NavSection({
  items,
  collapsed,
}: {
  items: { to: string; icon: React.ElementType; label: string; permission?: string }[];
  collapsed: boolean;
}) {
  const { hasPermission } = useAuth();
  return (
    <div className="space-y-0.5">
      {items.filter((item) => !item.permission || hasPermission(item.permission)).map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          title={collapsed ? label : undefined}
          aria-label={collapsed ? label : undefined}
          className={({ isActive }) => navLinkClasses(isActive, collapsed)}
        >
          {({ isActive }) => (
            <>
              <ActiveBar isActive={isActive} />
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>{label}</span>}
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
    staleTime: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setDeletingCategory(null);
    },
  });

  const sidebarWidth = collapsed ? 'w-14' : 'w-60';

  return (
    <>
    <aside
      className={cn(
        'fixed left-0 top-0 bottom-0 bg-[hsl(var(--sidebar))] border-r border-[hsl(var(--sidebar-border))] flex flex-col z-20 transition-all duration-200',
        sidebarWidth
      )}
    >
      {/* Brand */}
      <div className={cn('h-14 flex items-center border-b border-[hsl(var(--sidebar-border))] flex-shrink-0', collapsed ? 'justify-center px-2' : 'px-5')}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-900/40">
            <Shield className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <span className="font-semibold text-sm tracking-tight whitespace-nowrap text-white">DetectKB</span>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-scroll flex-1 overflow-y-auto py-2 px-2">
        <SectionLabel label="Main" collapsed={collapsed} />
        <NavSection items={mainNavItems} collapsed={collapsed} />

        <SectionLabel label="Content" collapsed={collapsed} />
        <NavSection items={contentNavItems} collapsed={collapsed} />

        <SavedViewsNav collapsed={collapsed} sectionLabel={<SectionLabel label="Saved views" collapsed={collapsed} />} />

        {/* Categories section */}
        {!collapsed && (
          <div className="mt-1">
            <div className="flex items-center justify-between px-3 pt-4 pb-1.5">
              <p className="text-[10px] font-semibold text-[hsl(var(--sidebar-foreground))]/50 uppercase tracking-[0.12em]">
                Categories
              </p>
              <button
                onClick={() => setShowCategoryForm((v) => !v)}
                className="w-5 h-5 rounded flex items-center justify-center text-[hsl(var(--sidebar-foreground))] hover:text-white hover:bg-white/10 transition-colors"
                title="Add category"
                aria-label="Add category"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {showCategoryForm && (
              <InlineCategoryForm onDone={() => setShowCategoryForm(false)} />
            )}

            {categoriesLoading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-[hsl(var(--sidebar-foreground))]/70">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading...
              </div>
            ) : categories.length === 0 && !showCategoryForm ? (
              <div className="text-xs text-[hsl(var(--sidebar-foreground))]/60 px-3 py-2">
                No categories yet
              </div>
            ) : (
              <div className="space-y-0.5 mt-1">
                {categories.map((cat) => (
                  <CategoryItem key={cat.id} cat={cat} collapsed={false} onDelete={setDeletingCategory} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tools */}
        <SectionLabel label="Tools" collapsed={collapsed} />
        <NavSection items={toolsNavItems} collapsed={collapsed} />

        {/* Admin */}
        {isAdmin() && (
          <>
            <SectionLabel label="Admin" collapsed={collapsed} />
            <NavSection items={[
              { to: '/settings/users', icon: Users, label: 'Users' },
              { to: '/activity', icon: Activity, label: 'Activity' },
            ]} collapsed={collapsed} />
          </>
        )}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-[hsl(var(--sidebar-border))] p-2">
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'w-full flex items-center rounded-md text-sm text-[hsl(var(--sidebar-foreground))] hover:text-white hover:bg-white/5 transition-colors focus-visible:ring-2 focus-visible:ring-[hsl(var(--sidebar-primary))]/50 outline-none',
            collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-3 py-2'
          )}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 flex-shrink-0" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4 flex-shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>

    <ConfirmDialog
      open={deletingCategory !== null}
      title="Delete Category"
      message={`Delete category "${deletingCategory?.name}"? Pages in this category will not be deleted — they will just become uncategorized.`}
      confirmLabel="Delete"
      onConfirm={() => deletingCategory && deleteMutation.mutate(deletingCategory.id)}
      onCancel={() => setDeletingCategory(null)}
    />
    </>
  );
}
