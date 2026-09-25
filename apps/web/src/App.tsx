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
const PatientsPage = lazy(() => import('@/features/patients/PatientsPage').then((m) => ({ default: m.PatientsPage })));
const PatientFormPage = lazy(() => import('@/features/patients/PatientFormPage').then((m) => ({ default: m.PatientFormPage })));
const PatientProfilePage = lazy(() => import('@/features/patients/PatientProfilePage').then((m) => ({ default: m.PatientProfilePage })));
const AppointmentsPage = lazy(() => import('@/features/appointments/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })));
const QueuePage = lazy(() => import('@/features/appointments/QueuePage').then((m) => ({ default: m.QueuePage })));
const ConsultationsPage = lazy(() => import('@/features/consultations/ConsultationsPage').then((m) => ({ default: m.ConsultationsPage })));
const ConsultationPage = lazy(() => import('@/features/consultations/ConsultationPage').then((m) => ({ default: m.ConsultationPage })));
const CataloguePage = lazy(() => import('@/features/catalog/CataloguePage').then((m) => ({ default: m.CataloguePage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
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
          path="patients"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.PATIENTS_VIEW}>
                <PatientsPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="patients/new"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.PATIENTS_CREATE}>
                <PatientFormPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="patients/:id"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.PATIENTS_VIEW}>
                <PatientProfilePage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="patients/:id/edit"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.PATIENTS_UPDATE}>
                <PatientFormPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="appointments"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.APPOINTMENTS_VIEW}>
                <AppointmentsPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="queue"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.QUEUE_VIEW}>
                <QueuePage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.SETTINGS_VIEW}>
                <SettingsPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="consultations"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.CONSULTATIONS_VIEW}>
                <ConsultationsPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="consultations/:id"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.CONSULTATIONS_VIEW}>
                <ConsultationPage />
              </RequirePermission>
            </Suspense>
          }
        />
        <Route
          path="investigations"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <RequirePermission permission={PERMISSIONS.INVESTIGATIONS_VIEW}>
                <CataloguePage />
              </RequirePermission>
            </Suspense>
          }
        />
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
