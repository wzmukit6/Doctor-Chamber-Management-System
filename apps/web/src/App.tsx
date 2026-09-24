import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PERMISSIONS } from '@chamber/shared';
import { useAuth } from '@/stores/auth';
import { AppLayout } from '@/layouts/AppLayout';
import { RequirePermission } from '@/permissions/RequirePermission';
import { LoginPage } from '@/features/auth/LoginPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { ForceChangePasswordPage } from '@/features/auth/ForceChangePasswordPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// Code-split administrative screens (spec §44).
const UsersPage = lazy(() => import('@/features/users/UsersPage').then((m) => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import('@/features/roles/RolesPage').then((m) => ({ default: m.RolesPage })));
const OrganizationsPage = lazy(() => import('@/features/organizations/OrganizationsPage').then((m) => ({ default: m.OrganizationsPage })));
const ChambersPage = lazy(() => import('@/features/chambers/ChambersPage').then((m) => ({ default: m.ChambersPage })));
const AuditLogsPage = lazy(() => import('@/features/audit/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })));
const ProfilePage = lazy(() => import('@/features/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })));

function FullPageSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
      <Loader2 className="h-6 w-6 animate-spin text-primary-700" aria-hidden />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Redirects anonymous users to sign in and forces a password change when required. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword) return <ForceChangePasswordPage />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route
          path="users"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.USERS_VIEW}>
                <UsersPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="roles"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.ROLES_VIEW}>
                <RolesPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="organizations"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.ORGANIZATIONS_VIEW}>
                <OrganizationsPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="chambers"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.CHAMBERS_VIEW}>
                <ChambersPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="audit-logs"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.AUDIT_LOGS_VIEW}>
                <AuditLogsPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="profile"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <ProfilePage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
