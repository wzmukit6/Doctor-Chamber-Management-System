import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  Activity,
  Building2,
  CalendarPlus,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  FilePlus2,
  Hourglass,
  Network,
  Search,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  Users,
  CalendarClock,
  Wallet,
} from 'lucide-react';
import { PERMISSIONS, type RoleKey } from '@chamber/shared';
import { useAuth } from '@/stores/auth';
import { auditApi, organizationsApi, chambersApi, usersApi } from '@/services/endpoints';
import { Badge, Skeleton } from '@/components/ui';
import { formatLongDate, formatRelative } from '@/utils/format';
import { describeAction } from '@/features/audit/describe';

function StatCard({ label, value, icon, loading, hint, to }: { label: string; value?: ReactNode; icon: ReactNode; loading?: boolean; hint?: string; to?: string }) {
  const body = (
    <div className="card flex h-full items-start gap-4 p-4 transition-colors hover:border-primary-200">
      <div className="rounded-lg bg-primary-50 p-2.5 text-primary-700">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink-muted">{label}</p>
        {loading ? <Skeleton className="mt-1.5 h-6 w-12" /> : <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{value ?? '—'}</p>}
        {hint && <p className="mt-1 text-2xs text-ink-subtle">{hint}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function PendingCard({ label, icon, module }: { label: string; icon: ReactNode; module: string }) {
  const { t } = useTranslation();
  return (
    <div className="card flex items-start gap-4 border-dashed p-4">
      <div className="rounded-lg bg-canvas p-2.5 text-ink-subtle">{icon}</div>
      <div>
        <p className="text-xs font-medium text-ink-muted">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold text-ink-subtle">—</p>
        <p className="mt-1 text-2xs text-ink-subtle">{t('dashboard.module_pending', { module })}</p>
      </div>
    </div>
  );
}

function QuickAction({ label, icon, disabled, onClick }: { label: string; icon: ReactNode; disabled?: boolean; onClick?: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="card flex items-center gap-3 p-3 text-left text-sm font-medium text-ink transition-colors hover:border-primary-200 hover:bg-primary-50/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface"
    >
      <span className="rounded bg-primary-50 p-2 text-primary-700">{icon}</span>
      <span className="flex-1">{label}</span>
      {disabled && <Badge>{t('common.coming_soon')}</Badge>}
    </button>
  );
}

function RecentActivity() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const q = useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => auditApi.list({ pageSize: 8 }),
    enabled: can(PERMISSIONS.AUDIT_LOGS_VIEW),
  });
  if (!can(PERMISSIONS.AUDIT_LOGS_VIEW)) return null;
  return (
    <section className="card" aria-labelledby="recent-activity">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 id="recent-activity" className="text-sm font-semibold text-ink">
          {t('dashboard.recent_activity')}
        </h2>
        <Link to="/audit-logs" className="text-xs font-medium text-primary-700 hover:underline">
          {t('nav.audit_logs')}
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {q.isLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="px-4 py-3">
              <Skeleton className="h-4 w-2/3" />
            </li>
          ))}
        {q.data?.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-muted">{t('dashboard.no_activity')}</li>}
        {q.data?.items.map((row) => (
          <li key={row.id} className="flex items-start gap-3 px-4 py-2.5">
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">
                <span className="font-medium">{row.userName ?? t('audit.system')}</span> · {describeAction(row.action)}
              </p>
              <p className="text-2xs text-ink-subtle">{formatRelative(row.createdAt)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Activity feed (when the role may view audit logs) next to the delivery roadmap. */
function ActivityAndRoadmap() {
  const { can } = useAuth();
  if (!can(PERMISSIONS.AUDIT_LOGS_VIEW)) {
    return (
      <div className="lg:max-w-md">
        <Roadmap />
      </div>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <RecentActivity />
      </div>
      <Roadmap />
    </div>
  );
}

const ROADMAP: { phase: number; key: string; status: 'done' | 'next' | 'planned' }[] = [
  { phase: 1, key: 'Foundation — auth, users, RBAC, chambers, audit', status: 'done' },
  { phase: 2, key: 'Patient management — registration, search, profile, timeline', status: 'next' },
  { phase: 3, key: 'Appointments & queue', status: 'planned' },
  { phase: 4, key: 'Clinical workflow — consultation, vitals, diagnosis', status: 'planned' },
  { phase: 5, key: 'Prescriptions — builder, templates, versioning, PDF', status: 'planned' },
  { phase: 6, key: 'Billing & payments', status: 'planned' },
  { phase: 7, key: 'Reports, analytics & settings', status: 'planned' },
  { phase: 8, key: 'Hardening & deployment', status: 'planned' },
];

function Roadmap() {
  const { t } = useTranslation();
  return (
    <section className="card p-4" aria-labelledby="roadmap">
      <h2 id="roadmap" className="text-sm font-semibold text-ink">
        {t('dashboard.roadmap')}
      </h2>
      <p className="mt-0.5 text-xs text-ink-muted">{t('dashboard.roadmap_intro')}</p>
      <ol className="mt-3 space-y-2">
        {ROADMAP.map((r) => (
          <li key={r.phase} className="flex items-center gap-2.5 text-sm">
            {r.status === 'done' ? (
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            ) : (
              <CircleDashed className={clsx('h-4 w-4', r.status === 'next' ? 'text-primary-600' : 'text-ink-subtle')} aria-hidden />
            )}
            <span className={clsx(r.status === 'planned' ? 'text-ink-muted' : 'text-ink')}>
              {r.phase}. {r.key}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SuperAdminDashboard() {
  const { t } = useTranslation();
  const orgs = useQuery({ queryKey: ['dash', 'orgs'], queryFn: () => organizationsApi.list({ pageSize: 1 }) });
  const chambers = useQuery({ queryKey: ['dash', 'chambers'], queryFn: () => chambersApi.list({ pageSize: 1 }) });
  const users = useQuery({ queryKey: ['dash', 'users'], queryFn: () => usersApi.list({ pageSize: 1, status: 'active' }) });
  const doctors = useQuery({ queryKey: ['dash', 'doctors'], queryFn: () => usersApi.list({ pageSize: 1, role: 'DOCTOR', status: 'active' }) });
  const chain = useQuery({ queryKey: ['dash', 'chain'], queryFn: () => auditApi.verify() });
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('dashboard.total_organizations')} value={orgs.data?.meta.total} loading={orgs.isLoading} icon={<Network className="h-5 w-5" />} to="/organizations" />
        <StatCard label={t('dashboard.total_chambers')} value={chambers.data?.meta.total} loading={chambers.isLoading} icon={<Building2 className="h-5 w-5" />} to="/chambers" />
        <StatCard label={t('dashboard.doctors')} value={doctors.data?.meta.total} loading={doctors.isLoading} icon={<Stethoscope className="h-5 w-5" />} to="/users" />
        <StatCard label={t('dashboard.total_users')} value={users.data?.meta.total} loading={users.isLoading} icon={<Users className="h-5 w-5" />} to="/users" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentActivity />
        </div>
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-ink">{t('dashboard.system_health')}</h2>
            <div className="mt-3 flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 text-ink-muted">
                <ShieldCheck className="h-4 w-4" aria-hidden /> {t('dashboard.audit_chain')}
              </span>
              {chain.isLoading ? (
                <Skeleton className="h-4 w-20" />
              ) : chain.data?.valid ? (
                <Badge tone="success" dot>
                  {t('dashboard.audit_chain_ok', { count: chain.data.checked })}
                </Badge>
              ) : (
                <Badge tone="danger" dot>
                  {t('dashboard.audit_chain_broken', { seq: chain.data?.brokenAtSeq ?? '?' })}
                </Badge>
              )}
            </div>
          </section>
          <Roadmap />
        </div>
      </div>
    </>
  );
}

function ManagerDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const staff = useQuery({ queryKey: ['dash', 'staff'], queryFn: () => usersApi.list({ pageSize: 1, status: 'active' }) });
  const doctors = useQuery({ queryKey: ['dash', 'doctors'], queryFn: () => usersApi.list({ pageSize: 1, role: 'DOCTOR', status: 'active' }) });
  const assistants = useQuery({ queryKey: ['dash', 'assistants'], queryFn: () => usersApi.list({ pageSize: 1, role: 'ASSISTANT', status: 'active' }) });
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('dashboard.active_staff')} value={staff.data?.meta.total} loading={staff.isLoading} icon={<Users className="h-5 w-5" />} to="/users" />
        <StatCard label={t('dashboard.doctors')} value={doctors.data?.meta.total} loading={doctors.isLoading} icon={<Stethoscope className="h-5 w-5" />} to="/users" />
        <StatCard label={t('dashboard.assistants')} value={assistants.data?.meta.total} loading={assistants.isLoading} icon={<ClipboardCheck className="h-5 w-5" />} to="/users" />
        <StatCard
          label={t('dashboard.chamber_status')}
          value={<Badge tone="success" dot>{t('dashboard.open')}</Badge>}
          hint={user?.activeMembership.chamber?.name}
          icon={<Building2 className="h-5 w-5" />}
          to="/chambers"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <PendingCard label={t('dashboard.todays_appointments')} icon={<CalendarClock className="h-5 w-5" />} module={t('nav.appointments')} />
        <PendingCard label={t('dashboard.waiting_patients')} icon={<Hourglass className="h-5 w-5" />} module={t('nav.queue')} />
        <PendingCard label={t('dashboard.payment_status')} icon={<Wallet className="h-5 w-5" />} module={t('nav.billing')} />
      </div>
      <ActivityAndRoadmap />
    </>
  );
}

function ClinicalDashboard({ role, onSearch }: { role: RoleKey; onSearch: () => void }) {
  const { t } = useTranslation();
  const doctor = role === 'DOCTOR';
  return (
    <>
      <section aria-labelledby="quick-actions">
        <h2 id="quick-actions" className="mb-3 text-sm font-semibold text-ink">
          {t('dashboard.quick_actions')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction label={t('dashboard.search_patient')} icon={<Search className="h-4 w-4" />} onClick={onSearch} />
          <QuickAction label={t('dashboard.new_patient')} icon={<UserPlus className="h-4 w-4" />} disabled />
          <QuickAction label={t('dashboard.new_appointment')} icon={<CalendarPlus className="h-4 w-4" />} disabled />
          {doctor ? (
            <QuickAction label={t('dashboard.start_consultation')} icon={<Stethoscope className="h-4 w-4" />} disabled />
          ) : (
            <QuickAction label={t('dashboard.create_prescription')} icon={<FilePlus2 className="h-4 w-4" />} disabled />
          )}
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PendingCard label={t('dashboard.todays_appointments')} icon={<CalendarClock className="h-5 w-5" />} module={t('nav.appointments')} />
        <PendingCard label={t('dashboard.waiting_patients')} icon={<Hourglass className="h-5 w-5" />} module={t('nav.queue')} />
        {doctor ? (
          <>
            <PendingCard label={t('dashboard.completed_consultations')} icon={<ClipboardCheck className="h-5 w-5" />} module={t('nav.consultations')} />
            <PendingCard label={t('dashboard.followups_due')} icon={<CalendarClock className="h-5 w-5" />} module={t('nav.consultations')} />
          </>
        ) : (
          <>
            <PendingCard label={t('dashboard.checked_in')} icon={<ClipboardCheck className="h-5 w-5" />} module={t('nav.queue')} />
            <PendingCard label={t('dashboard.payment_status')} icon={<Wallet className="h-5 w-5" />} module={t('nav.billing')} />
          </>
        )}
      </div>
      <ActivityAndRoadmap />
    </>
  );
}

/** Role-specific dashboards (spec §4). Widgets for modules not yet delivered are shown as placeholders. */
export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (!user) return null;
  const role = user.activeMembership.role;
  const openSearch = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{t('dashboard.greeting', { name: user.fullName })}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t('dashboard.today', { date: formatLongDate(new Date()) })}
          {user.activeMembership.chamber && <> · {user.activeMembership.chamber.name}</>}
        </p>
      </div>
      {role === 'SUPER_ADMIN' && <SuperAdminDashboard />}
      {role === 'MANAGER' && <ManagerDashboard />}
      {(role === 'DOCTOR' || role === 'ASSISTANT') && <ClinicalDashboard role={role} onSearch={openSearch} />}
    </div>
  );
}
