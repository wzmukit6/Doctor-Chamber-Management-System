import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentUser, Permission } from '@chamber/shared';
import { ApiError, onUnauthorized } from '@/services/api';
import { authApi } from '@/services/endpoints';
import { setLanguage } from '@/i18n';

interface AuthContextValue {
  user: CurrentUser | null;
  isLoading: boolean;
  can: (permission: Permission) => boolean;
  canAny: (permissions: Permission[]) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * Holds the server-resolved current user. Permissions shown here only drive
 * UI visibility — the API re-checks every request independently.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      try {
        return await authApi.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });

  useEffect(
    () =>
      onUnauthorized(() => {
        queryClient.setQueryData(ME_QUERY_KEY, null);
      }),
    [queryClient],
  );

  const user = me.data ?? null;

  useEffect(() => {
    if (user?.preferredLanguage) setLanguage(user.preferredLanguage);
  }, [user?.preferredLanguage]);

  const permissionSet = useMemo(() => new Set<string>(user?.permissions ?? []), [user]);
  const can = useCallback((p: Permission) => permissionSet.has(p), [permissionSet]);
  const canAny = useCallback((ps: Permission[]) => ps.some((p) => permissionSet.has(p)), [permissionSet]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      queryClient.clear();
      queryClient.setQueryData(ME_QUERY_KEY, null);
    }
  }, [queryClient]);

  const value = useMemo(
    () => ({ user, isLoading: me.isLoading, can, canAny, refresh, signOut }),
    [user, me.isLoading, can, canAny, refresh, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
