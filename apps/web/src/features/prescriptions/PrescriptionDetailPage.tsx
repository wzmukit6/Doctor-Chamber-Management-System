import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ArrowLeft, CheckCircle2, FilePenLine, History, Loader2, Lock, Printer, Stethoscope, Trash2 } from 'lucide-react';
import { PERMISSIONS, type PrescriptionDto, type PrescriptionVersionDto } from '@chamber/shared';
import { Badge, Button, ConfirmDialog, ErrorState, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { prescriptionsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { errorMessage } from '@/utils/errors';
import { formatDateTime, formatRelative } from '@/utils/format';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PrescriptionBuilder } from './components/PrescriptionBuilder';
import { RxItemsView } from './components/RxItemsView';
import { RX_STATUS_TONE } from './PrescriptionsPage';
import { contentPayload, draftFrom, type RxDraft } from './rx';

const VERSION_TONE = { DRAFT: 'warning', FINALIZED: 'success', SUPERSEDED: 'neutral', DISCARDED: 'danger' } as const;

/**
 * Prescription detail with immutable version history (spec §12, §39). The
 * prescribing doctor revises by creating a new version with a reason; the
 * previous version is kept and marked superseded.
 */
export function PrescriptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['prescriptions', id], queryFn: () => prescriptionsApi.get(id!) });
  const [selected, setSelected] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<'revise' | 'finalize' | 'discard' | null>(null);
  const [busy, setBusy] = useState(false);
  const rx = q.data;
  const draft = rx?.status !== 'DRAFT' ? rx?.versions.find((v) => v.status === 'DRAFT') : undefined;
  const editingRevision = !!draft && !!rx?.canRevise;

  const setData = (data: PrescriptionDto) => {
    queryClient.setQueryData(['prescriptions', id], data);
    void queryClient.invalidateQueries({ queryKey: ['prescriptions', 'list'] });
  };

  const run = async (fn: () => Promise<PrescriptionDto>, success: string) => {
    setBusy(true);
    try {
      const data = await fn();
      setData(data);
      toast.success(success);
      setSelected(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (q.isLoading) return <Skeleton className="h-[32rem] w-full" />;
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage />;
  if (q.isError || !rx) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;

  const history = rx.versions.filter((v) => v.status !== 'DRAFT' || rx.status === 'DRAFT');
  const current = history.find((v) => v.versionNumber === (selected ?? rx.currentVersion)) ?? history[0];

  return (
    <div>
      <Link to="/prescriptions" className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('rx.back_to_list')}
      </Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-ink">
          {t('rx.title')} <span className="font-mono">{rx.rxNumber ?? t('rx.unissued')}</span>
        </h1>
        <Badge tone={RX_STATUS_TONE[rx.status]} dot>
          {t(`rxStatus.${rx.status}`)}
        </Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          {can(PERMISSIONS.CONSULTATIONS_VIEW) && (
            <Link to={`/consultations/${rx.consultationId}`} className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-canvas">
              <Stethoscope className="h-4 w-4" aria-hidden /> {t('rx.open_consultation')}
            </Link>
          )}
          {rx.canRevise && !draft && (
            <Button size="sm" variant="secondary" icon={<FilePenLine className="h-4 w-4" />} onClick={() => setConfirm('revise')}>
              {t('rx.revise')}
            </Button>
          )}
          {can(PERMISSIONS.PRESCRIPTIONS_PRINT) && rx.rxNumber && (
            <Link to={`/prescriptions/${rx.id}/print`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded bg-primary-700 px-3 text-xs font-medium text-white hover:bg-primary-800">
              <Printer className="h-4 w-4" aria-hidden /> {t('rx.print')}
            </Link>
          )}
        </div>
      </div>

      <div className="card mb-4 grid gap-3 p-4 text-sm sm:grid-cols-4">
        <Info label={t('appointments.patient')}>
          {can(PERMISSIONS.PATIENTS_VIEW) ? (
            <Link to={`/patients/${rx.patient.id}`} className="font-medium text-ink hover:underline">
              {rx.patient.fullName}
            </Link>
          ) : (
            rx.patient.fullName
          )}
          <span className="block font-mono text-2xs text-ink-subtle">{rx.patient.patientCode}</span>
        </Info>
        <Info label={t('appointments.doctor')}>{rx.doctor.fullName}</Info>
        <Info label={t('rx.issued')}>{rx.issuedAt ? formatDateTime(rx.issuedAt) : '—'}</Info>
        <Info label={t('consultation.primary_dx')}>{rx.primaryDiagnosis ?? '—'}</Info>
      </div>

      {rx.status === 'DRAFT' && (
        <p className="mb-4 rounded-lg bg-canvas px-4 py-2 text-sm text-ink-muted">{t('rx.draft_in_consultation')}</p>
      )}

      {editingRevision && draft && <RevisionEditor rx={rx} draft={draft} onSaved={setData} onFinalize={() => setConfirm('finalize')} onDiscard={() => setConfirm('discard')} />}
      {draft && !rx.canRevise && <p className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning">{t('rx.revision_in_progress_other')}</p>}

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <section className="card p-3" aria-labelledby="versions-title">
          <h2 id="versions-title" className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold text-ink">
            <History className="h-4 w-4" aria-hidden /> {t('rx.versions')}
          </h2>
          <ol className="space-y-1">
            {history.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setSelected(v.versionNumber)}
                  aria-current={current?.id === v.id ? 'true' : undefined}
                  className={clsx('w-full rounded-lg px-3 py-2 text-left', current?.id === v.id ? 'bg-primary-50 ring-1 ring-primary-200' : 'hover:bg-canvas')}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{t('rx.version_n', { n: v.versionNumber })}</span>
                    <Badge tone={VERSION_TONE[v.status]}>{t(`rxVersionStatus.${v.status}`)}</Badge>
                  </span>
                  <span className="mt-0.5 block text-2xs text-ink-subtle">
                    {v.finalizedAt ? t('rx.finalized_by', { name: v.finalizedByName ?? '', time: formatRelative(v.finalizedAt) }) : v.discardedAt ? formatRelative(v.discardedAt) : formatRelative(v.createdAt)}
                  </span>
                  {v.revisionReason && <span className="mt-0.5 block truncate text-2xs italic text-ink-muted">“{v.revisionReason}”</span>}
                </button>
              </li>
            ))}
          </ol>
        </section>
        {current && <VersionView rx={rx} v={current} />}
      </div>

      <ConfirmDialog
        open={confirm === 'revise'}
        title={t('rx.revise_title')}
        body={t('rx.revise_body')}
        tone="primary"
        requireReason
        confirmLabel={t('rx.revise')}
        loading={busy}
        onClose={() => setConfirm(null)}
        onConfirm={(reason) => void run(() => prescriptionsApi.revise(rx.id, reason, rx.version), t('rx.revision_started'))}
      />
      <ConfirmDialog
        open={confirm === 'finalize'}
        title={t('rx.finalize_revision_title')}
        body={t('rx.finalize_revision_body', { n: draft?.versionNumber ?? '', current: rx.currentVersion })}
        tone="primary"
        confirmLabel={t('rx.finalize_revision')}
        loading={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => void run(() => prescriptionsApi.finalize(rx.id, queryClient.getQueryData<PrescriptionDto>(['prescriptions', id])!.version), t('rx.revision_finalized'))}
      />
      <ConfirmDialog
        open={confirm === 'discard'}
        title={t('rx.discard_title')}
        body={t('rx.discard_body')}
        confirmLabel={t('rx.discard')}
        loading={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => void run(() => prescriptionsApi.discard(rx.id, queryClient.getQueryData<PrescriptionDto>(['prescriptions', id])!.version), t('rx.revision_discarded'))}
      />
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-subtle">{label}</p>
      <div className="text-ink">{children}</div>
    </div>
  );
}

function VersionView({ rx, v }: { rx: PrescriptionDto; v: PrescriptionVersionDto }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const issued = v.status === 'FINALIZED' || v.status === 'SUPERSEDED';
  return (
    <section className="card p-4 sm:p-5" aria-label={t('rx.version_n', { n: v.versionNumber })}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{t('rx.version_n', { n: v.versionNumber })}</h2>
        <Badge tone={VERSION_TONE[v.status]}>{t(`rxVersionStatus.${v.status}`)}</Badge>
        {issued && <Lock className="h-3.5 w-3.5 text-ink-subtle" aria-label={t('rx.locked')} />}
        {issued && can(PERMISSIONS.PRESCRIPTIONS_PRINT) && v.versionNumber !== rx.currentVersion && (
          <Link to={`/prescriptions/${rx.id}/print?version=${v.versionNumber}`} target="_blank" rel="noopener" className="ml-auto text-xs font-medium text-primary-700 hover:underline">
            {t('rx.print_version')}
          </Link>
        )}
      </div>
      {v.revisionReason && (
        <p className="mb-3 rounded bg-canvas px-3 py-2 text-xs text-ink-muted">
          <span className="font-medium text-ink">{t('rx.revision_reason')}:</span> {v.revisionReason}
        </p>
      )}
      <RxItemsView items={v.items} advice={v.advice} />
      <dl className="mt-4 grid gap-x-4 gap-y-1 border-t border-border pt-3 text-2xs text-ink-subtle sm:grid-cols-2">
        <div>
          {t('rx.created_by', { name: v.createdByName ?? '—', time: formatDateTime(v.createdAt) })}
        </div>
        {v.finalizedAt && <div>{t('rx.finalized_at', { name: v.finalizedByName ?? '—', time: formatDateTime(v.finalizedAt) })}</div>}
        {v.supersededAt && <div>{t('rx.superseded_at', { time: formatDateTime(v.supersededAt) })}</div>}
        {v.contentHash && <div className="font-mono sm:col-span-2">SHA-256 {v.contentHash}</div>}
      </dl>
    </section>
  );
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** Editor for the open revision draft, autosaved with optimistic locking. */
function RevisionEditor({
  rx,
  draft,
  onSaved,
  onFinalize,
  onDiscard,
}: {
  rx: PrescriptionDto;
  draft: PrescriptionVersionDto;
  onSaved: (d: PrescriptionDto) => void;
  onFinalize: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<RxDraft>(() => draftFrom(draft.items, draft.advice));
  const [state, setState] = useState<SaveState>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const valueRef = useRef(value);
  const versionRef = useRef(rx.version);
  const timer = useRef<number | null>(null);
  versionRef.current = Math.max(versionRef.current, rx.version);

  const save = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    setState('saving');
    try {
      const saved = await prescriptionsApi.saveDraft(rx.id, { ...contentPayload(valueRef.current), version: versionRef.current });
      versionRef.current = saved.version;
      setErrors({});
      setState('saved');
      onSaved(saved);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.details.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      setState('error');
      return false;
    }
  }, [rx.id, onSaved]);

  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  const change = (next: RxDraft) => {
    setValue(next);
    valueRef.current = next;
    setState('dirty');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 1500);
  };

  const finalize = async () => {
    if (state === 'dirty' || state === 'error') {
      if (!(await save())) return;
    }
    onFinalize();
  };

  return (
    <section className="card mb-4 border-warning/40 p-4 sm:p-5" aria-labelledby="revision-title">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="revision-title" className="text-sm font-semibold text-ink">
          {t('rx.revision_editor', { n: draft.versionNumber })}
        </h2>
        <span role="status" aria-live="polite" className={clsx('inline-flex items-center gap-1 text-xs', state === 'error' ? 'text-danger' : state === 'saved' ? 'text-success' : 'text-ink-muted')}>
          {state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {state === 'saving' ? t('consultation.saving') : state === 'dirty' ? t('consultation.unsaved') : state === 'saved' ? t('consultation.saved') : state === 'error' ? t('consultation.save_failed') : null}
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={onDiscard}>
            {t('rx.discard')}
          </Button>
          <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => void finalize()}>
            {t('rx.finalize_revision')}
          </Button>
        </div>
      </div>
      <p className="mb-3 rounded bg-warning-soft px-3 py-2 text-xs text-warning">
        <span className="font-medium">{t('rx.revision_reason')}:</span> {draft.revisionReason}
      </p>
      <PrescriptionBuilder value={value} onChange={change} errors={errors} errorPrefix="" />
    </section>
  );
}
