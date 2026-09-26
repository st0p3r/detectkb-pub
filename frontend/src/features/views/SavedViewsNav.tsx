import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Bookmark, Network, Shield, X } from 'lucide-react';
import { deleteSavedView, listSavedViews } from '@/lib/api';
import { cn } from '@/lib/utils';

const ICONS: Record<string, React.ElementType> = { '/rules': Shield, '/pages': BookOpen, '/graph': Network };

/** The user's saved views, as sidebar links. */
export function SavedViewsNav({ collapsed, sectionLabel }: { collapsed: boolean; sectionLabel: React.ReactNode }) {
  const { pathname, search } = useLocation();
  const queryClient = useQueryClient();
  const { data: views = [] } = useQuery({ queryKey: ['saved-views'], queryFn: listSavedViews, staleTime: 60_000 });
  const remove = useMutation({
    mutationFn: deleteSavedView,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-views'] }),
  });
  if (!views.length) return null;

  const current = new URLSearchParams(search);
  current.delete('page');
  current.delete('preview');
  const currentQuery = current.toString();

  return (
    <>
      {sectionLabel}
      <div className="space-y-0.5">
        {views.map((v) => {
          const Icon = ICONS[v.path] ?? Bookmark;
          const active = pathname === v.path && currentQuery === v.query;
          return (
            <div key={v.id} className="group relative">
              <Link
                to={`${v.path}${v.query ? `?${v.query}` : ''}`}
                title={collapsed ? v.name : `${v.name} — ${v.path}${v.query ? `?${decodeURIComponent(v.query)}` : ''}`}
                aria-label={collapsed ? v.name : undefined}
                className={cn(
                  'relative flex items-center rounded-md text-sm transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sidebar-primary))]/50',
                  collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-3 py-2 pr-8',
                  active ? 'bg-[hsl(var(--sidebar-active-bg))] text-white font-medium' : 'text-[hsl(var(--sidebar-foreground))] hover:text-white hover:bg-white/5'
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0 opacity-80" />
                {!collapsed && <span className="truncate">{v.name}</span>}
              </Link>
              {!collapsed && (
                <button
                  onClick={() => remove.mutate(v.id)}
                  title="Remove saved view"
                  aria-label={`Remove saved view ${v.name}`}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 text-[hsl(var(--sidebar-foreground))] hover:text-white hover:bg-white/10"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
