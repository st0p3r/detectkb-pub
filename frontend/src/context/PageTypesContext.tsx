import React, { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listPageTypes, type PageTypeDefinition } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthContext';

interface PageTypesContextValue {
  types: PageTypeDefinition[];
  isLoading: boolean;
  getType: (name: string) => PageTypeDefinition | undefined;
  getLabelFor: (name: string) => string;
  getColorFor: (name: string) => string;
}

const PageTypesContext = createContext<PageTypesContextValue | null>(null);

export function PageTypesProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, mustChangePassword } = useAuth();
  const { data: types = [], isLoading } = useQuery({
    queryKey: ['page-types'],
    queryFn: listPageTypes,
    enabled: isAuthenticated && !mustChangePassword,
    staleTime: 5 * 60 * 1000,
  });

  const getType = (name: string) => types.find((t) => t.name === name);
  const getLabelFor = (name: string) => getType(name)?.label ?? name;
  const getColorFor = (name: string) => getType(name)?.color ?? '#6b7280';

  return (
    <PageTypesContext.Provider value={{ types, isLoading, getType, getLabelFor, getColorFor }}>
      {children}
    </PageTypesContext.Provider>
  );
}

export function usePageTypes(): PageTypesContextValue {
  const ctx = useContext(PageTypesContext);
  if (!ctx) throw new Error('usePageTypes must be used within a PageTypesProvider');
  return ctx;
}
