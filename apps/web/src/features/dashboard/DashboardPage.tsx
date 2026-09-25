import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  Hourglass,
  ListOrdered,
  Network,
  Search,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  UserRound,
  Users,
  CalendarClock,
  Wallet,
} from 'lucide-react';
import { addDays, PERMISSIONS, zonedDate, type RoleKey } from '@chamber/shared';
import { useAuth } from '@/stores/auth';
import { useMoney } from '@/features/billing/money';
import { AnalyticsOverview } from '@/features/reports/AnalyticsOverview';
import { appointmentsApi, auditApi, systemApi, consultationsApi, organizationsApi, chambersApi, invoicesApi, patientsApi, prescriptionsApi, queueApi, usersApi } from '@/services/endpoints';
import { useChamberTz, useToday } from '@/hooks/useChamber';
import { BookAppointmentModal } from '@/features/appointments/components/BookAppointmentModal';
import { PatientLine } from '@/features/patients/components/PatientBits';
import { Badge, Skeleton } from '@/components/ui';
import { formatDateIn, formatLongDate, formatRelative, formatTimeIn } from '@/utils/format';
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
function ActivityAndRoadmap({ compact }: { compact?: boolean }) {
  const { can } = useAuth();
  if (compact) return can(PERMISSIONS.AUDIT_LOGS_VIEW) ? <RecentActivity /> : <Roadmap />;
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

function RecentPatients() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['patients', 'recent'], queryFn: patientsApi.recent, enabled: can(PERMISSIONS.PATIENTS_VIEW) });
  if (!can(PERMISSIONS.PATIENTS_VIEW)) return null;
  return (
    <section className="card" aria-labelledby="recent-patients-dash">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 id="recent-patients-dash" className="text-sm font-semibold text-ink">
          {t('dashboard.recent_patients')}
        </h2>
        <Link to="/patients" className="text-xs font-medium text-primary-700 hover:underline">
          {t('nav.patients')}
        </Link>
      </div>
      <div className="p-2">
        {q.isLoading && <Skeleton className="m-2 h-8 w-2/3" />}
        {q.data?.length === 0 && <p className="px-2 py-4 text-center text-sm text-ink-muted">{t('patients.no_recent')}</p>}
        {q.data?.slice(0, 6).map((p) => <PatientLine key={p.id} patient={p} to={`/patients/${p.id}`} />)}
      </div>
    </section>
  );
}

const ROADMAP: { phase: number; key: string; status: 'done' | 'next' | 'planned' }[] = [
  { phase: 1, key: 'Foundation — auth, users, RBAC, chambers, audit', status: 'done' },
  { phase: 2, key: 'Patient management — registration, search, profile, timeline', status: 'done' },
  { phase: 3, key: 'Appointments & queue', status: 'done' },
  { phase: 4, key: 'Clinical workflow — consultation, vitals, diagnosis', status: 'done' },
  { phase: 5, key: 'Prescriptions — builder, templates, versioning, PDF', status: 'done' },
  { phase: 6, key: 'Billing & payments', status: 'done' },
  { phase: 7, key: 'Reports, analytics & settings', status: 'done' },
  { phase: 8, key: 'Hardening & deployment', status: 'done' },
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
          <li key={r.phase} className="flex items-start gap-2.5 text-sm">
            {r.status === 'done' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            ) : (
              <CircleDashed className={clsx('mt-0.5 h-4 w-4 shrink-0', r.status === 'next' ? 'text-primary-600' : 'text-ink-subtle')} aria-hidden />
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
  const status = useQuery({ queryKey: ['dash', 'system'], queryFn: () => systemApi.status(), refetchInterval: 30_000 });
  const s = status.data;
  const rows: [string, ReactNode, 'success' | 'warning' | 'danger' | null][] = s
    ? [
        [t('dashboard.sys_database'), t('dashboard.sys_db_value', { ms: s.database.latencyMs, mb: s.database.sizeMb }), s.database.latencyMs > 200 ? 'warning' : 'success'],
        [t('dashboard.sys_latency'), s.traffic.p95Ms === null ? '—' : `${Math.round(s.traffic.p95Ms)} ms`, s.traffic.p95Ms !== null && s.traffic.p95Ms > 1000 ? 'warning' : null],
        [t('dashboard.sys_errors'), t('dashboard.sys_errors_value', { errors: s.traffic.serverErrors, requests: s.traffic.requests }), s.traffic.serverErrors > 0 ? 'danger' : null],
        [t('dashboard.sys_failed_logins'), t('dashboard.sys_failed_value', { failed: s.security.failedLogins24h, locked: s.security.lockouts24h }), s.security.lockouts24h > 0 ? 'warning' : null],
        [t('dashboard.sys_sessions'), s.security.activeSessions, null],
        [t('dashboard.sys_version'), `${s.version} · ${s.environment} · ${t('dashboard.sys_uptime', { h: Math.floor(s.uptimeSeconds / 3600), m: Math.floor((s.uptimeSeconds % 3600) / 60) })}`, null],
      ]
    : [];
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
            {status.isLoading ? (
              <Skeleton className="mt-3 h-24 w-full" />
            ) : (
              <dl className="mt-2 divide-y divide-border text-sm">
                {rows.map(([label, value, tone]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-1.5">
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="text-right tabular-nums text-ink">
                      {tone ? (
                        <Badge tone={tone} dot>
                          {value}
                        </Badge>
                      ) : (
                        value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="mt-2 text-2xs text-ink-subtle">{t('dashboard.sys_window', { n: s?.traffic.windowMinutes ?? 15 })}</p>
          </section>
          <Roadmap />
        </div>
      </div>
    </>
  );
}

function ManagerDashboard() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const staff = useQuery({ queryKey: ['dash', 'staff'], queryFn: () => usersApi.list({ pageSize: 1, status: 'active' }) });
  const doctors = useQuery({ queryKey: ['dash', 'doctors'], queryFn: () => usersApi.list({ pageSize: 1, role: 'DOCTOR', status: 'active' }) });
  const assistants = useQuery({ queryKey: ['dash', 'assistants'], queryFn: () => usersApi.list({ pageSize: 1, role: 'ASSISTANT', status: 'active' }) });
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const patients = useQuery({ queryKey: ['dash', 'patients'], queryFn: () => patientsApi.list({ pageSize: 1 }) });
  const queue = useTodayQueue();
  const newPatients = useQuery({ queryKey: ['dash', 'patients-30d', since], queryFn: () => patientsApi.list({ pageSize: 1, registeredFrom: since }) });
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('dashboard.patients_total')} value={patients.data?.meta.total} loading={patients.isLoading} icon={<UserRound className="h-5 w-5" />} to="/patients" />
        <StatCard label={t('dashboard.new_patients_30d')} value={newPatients.data?.meta.total} loading={newPatients.isLoading} icon={<UserPlus className="h-5 w-5" />} to="/patients" />
        <StatCard
          label={t('dashboard.appointments_today')}
          value={queue.data?.entries.length}
          loading={queue.isLoading}
          hint={queue.data ? `${t('queue.waiting')}: ${queue.data.summary.waiting} · ${t('queue.completed')}: ${queue.data.summary.completed}` : undefined}
          icon={<CalendarClock className="h-5 w-5" />}
          to="/queue"
        />
        <PaymentsCard />
      </div>
      {can(PERMISSIONS.REPORTS_VIEW) && <AnalyticsOverview compact only={['appointments', 'revenue']} />}
      <ActivityAndRoadmap />
    </>
  );
}

/** Today's queue numbers (own queue for doctors, whole chamber otherwise). */
function useTodayQueue(doctorId?: string) {
  const { can } = useAuth();
  const today = useToday();
  return useQuery({
    queryKey: ['queue', today, doctorId ?? ''],
    queryFn: () => queueApi.get({ date: today, doctorId }),
    enabled: can(PERMISSIONS.QUEUE_VIEW),
    refetchInterval: 30_000,
  });
}

function UpcomingAppointments({ doctorId }: { doctorId?: string }) {
  const { t } = useTranslation();
  const tz = useChamberTz();
  const today = useToday();
  const q = useQuery({
    queryKey: ['appointments', 'upcoming', doctorId ?? ''],
    queryFn: () => appointmentsApi.list({ from: today, to: addDays(today, 7), doctorId, status: 'BOOKED,CONFIRMED' }),
  });
  const rows = (q.data ?? []).filter((a) => new Date(a.endsAt).getTime() > Date.now()).slice(0, 6);
  return (
    <section className="card" aria-labelledby="upcoming-appts">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 id="upcoming-appts" className="text-sm font-semibold text-ink">
          {t('appointments.upcoming')}
        </h2>
        <Link to="/appointments" className="text-xs font-medium text-primary-700 hover:underline">
          {t('appointments.view_calendar')}
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {q.isLoading && <li className="p-4"><Skeleton className="h-6 w-2/3" /></li>}
        {!q.isLoading && rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-muted">{t('appointments.no_upcoming')}</li>}
        {rows.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="w-28 shrink-0 text-xs text-ink-muted">
              {zonedDate(new Date(a.startsAt), tz) === today ? t('appointments.today') : formatDateIn(a.startsAt, tz)} {formatTimeIn(a.startsAt, tz)}
            </span>
            <Link to={`/patients/${a.patient.id}`} className="min-w-0 flex-1 truncate font-medium text-ink hover:underline">
              {a.patient.fullName}
            </Link>
            <span className="hidden text-xs text-ink-subtle sm:inline">{t(`visitType.${a.visitType}`)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Today's collections and outstanding dues (spec §4 "Payment status", "Pending payments"). */
function PaymentsCard() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const today = useToday();
  const money = useMoney();
  const q = useQuery({ queryKey: ['invoices', 'summary', today, today], queryFn: () => invoicesApi.summary({ from: today, to: today }), enabled: can(PERMISSIONS.BILLING_VIEW) });
  if (!can(PERMISSIONS.BILLING_VIEW)) return null;
  return (
    <StatCard
      label={t('dashboard.collected_today')}
      value={q.data ? money(q.data.collected) : undefined}
      loading={q.isLoading}
      hint={q.data ? t('dashboard.pending_dues', { amount: money(q.data.outstanding), count: q.data.outstandingCount }) : undefined}
      icon={<Wallet className="h-5 w-5" />}
      to="/billing"
    />
  );
}

/** Latest issued prescriptions (spec §4 "Recent prescriptions"); one click to print. */
function RecentPrescriptions({ doctorId }: { doctorId?: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['prescriptions', 'list', 'recent', doctorId ?? ''],
    queryFn: () => prescriptionsApi.list({ pageSize: 6, doctorId }),
  });
  const rows = (q.data?.items ?? []).filter((p) => p.rxNumber);
  return (
    <section className="card" aria-labelledby="recent-rx">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 id="recent-rx" className="text-sm font-semibold text-ink">
          {t('dashboard.recent_prescriptions')}
        </h2>
        <Link to="/prescriptions" className="text-xs font-medium text-primary-700 hover:underline">
          {t('dashboard.view_all')}
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {q.isLoading && <li className="p-4"><Skeleton className="h-6 w-2/3" /></li>}
        {!q.isLoading && rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-muted">{t('rx.empty')}</li>}
        {rows.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <Link to={`/prescriptions/${p.id}`} className="w-24 shrink-0 font-mono text-xs text-primary-800 hover:underline">
              {p.rxNumber}
            </Link>
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{p.patient.fullName}</span>
            <span className="hidden text-xs text-ink-subtle sm:inline">{t('rx.medicine_count', { count: p.itemCount })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClinicalDashboard({ role, onSearch }: { role: RoleKey; onSearch: () => void }) {
  const { t } = useTranslation();
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const doctor = role === 'DOCTOR';
  const [booking, setBooking] = useState(false);
  const queue = useTodayQueue(doctor ? (user?.doctorId ?? undefined) : undefined);
  const today = useToday();
  const followUps = useQuery({
    queryKey: ['consultations', 'follow-ups', today, user?.doctorId ?? ''],
    queryFn: () => consultationsApi.followUps({ from: today, to: addDays(today, 7), doctorId: user?.doctorId ?? undefined }),
    enabled: doctor && can(PERMISSIONS.CONSULTATIONS_VIEW),
  });
  const s = queue.data?.summary;
  const total = queue.data?.entries.length;
  return (
    <>
      <section aria-labelledby="quick-actions">
        <h2 id="quick-actions" className="mb-3 text-sm font-semibold text-ink">
          {t('dashboard.quick_actions')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction label={t('dashboard.search_patient')} icon={<Search className="h-4 w-4" />} onClick={onSearch} />
          <QuickAction
            label={t('dashboard.new_patient')}
            icon={<UserPlus className="h-4 w-4" />}
            disabled={!can(PERMISSIONS.PATIENTS_CREATE)}
            onClick={() => navigate('/patients/new')}
          />
          <QuickAction
            label={t('dashboard.new_appointment')}
            icon={<CalendarPlus className="h-4 w-4" />}
            disabled={!can(PERMISSIONS.APPOINTMENTS_CREATE)}
            onClick={() => setBooking(true)}
          />
          {doctor ? (
            <QuickAction label={t('dashboard.start_consultation')} icon={<Stethoscope className="h-4 w-4" />} onClick={() => navigate('/queue')} />
          ) : (
            <QuickAction label={t('nav.queue')} icon={<ListOrdered className="h-4 w-4" />} onClick={() => navigate('/queue')} />
          )}
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('dashboard.todays_appointments')} value={total} loading={queue.isLoading} icon={<CalendarClock className="h-5 w-5" />} to="/appointments" />
        <StatCard label={t('dashboard.waiting_patients')} value={s?.waiting} loading={queue.isLoading} icon={<Hourglass className="h-5 w-5" />} to="/queue" hint={s?.onHold ? `${t('queue.on_hold')}: ${s.onHold}` : undefined} />
        {doctor ? (
          <>
            <StatCard label={t('dashboard.completed_consultations')} value={s?.completed} loading={queue.isLoading} icon={<ClipboardCheck className="h-5 w-5" />} to="/queue" />
            <StatCard
              label={t('dashboard.followups_due')}
              value={followUps.data?.length}
              loading={followUps.isLoading}
              hint={t('dashboard.follow_ups_week')}
              icon={<CalendarClock className="h-5 w-5" />}
              to="/consultations"
            />
          </>
        ) : (
          <>
            <StatCard label={t('dashboard.checked_in')} value={s?.checkedIn} loading={queue.isLoading} icon={<ClipboardCheck className="h-5 w-5" />} to="/queue" />
            <PaymentsCard />
          </>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {doctor ? <UpcomingAppointments doctorId={user?.doctorId ?? undefined} /> : <UpcomingAppointments />}
        <RecentPatients />
        {can(PERMISSIONS.PRESCRIPTIONS_VIEW) && <RecentPrescriptions doctorId={doctor ? (user?.doctorId ?? undefined) : undefined} />}
      </div>
      {doctor && can(PERMISSIONS.REPORTS_CLINICAL) && <AnalyticsOverview compact only={['patients', 'diagnoses']} />}
      <ActivityAndRoadmap />
      <BookAppointmentModal open={booking} onClose={() => setBooking(false)} />
    </>
  );
}

/** Role-specific dashboards (spec §4). */
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
