import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, CheckCircle2, CloudOff, Loader2, Lock, Save } from 'lucide-react';
import { addDays, PERMISSIONS, type SaveConsultationInput } from '@chamber/shared';
import { Badge, Button, ConfirmDialog, ErrorState, Skeleton, Textarea, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { consultationsApi, vitalDefinitionsApi, type ConsultationDetail } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useToday } from '@/hooks/useChamber';
import { errorMessage } from '@/utils/errors';
import { formatRelative } from '@/utils/format';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PatientSummaryPanel } from './components/PatientSummaryPanel';
import { ConsultationView } from './components/ConsultationView';
import {
  ComplaintsSection,
  DiagnosisSection,
  ExaminationSection,
  FollowUpSection,
  HistorySection,
  InvestigationsSection,
  Section,
  type ComplaintRow,
  type DiagnosisRow,
  type InvestigationRow,
} from './components/ConsultationSections';

interface Draft {
  complaints: ComplaintRow[];
  history: Record<string, string>;
  vitals: Record<string, string>;
  examinationNotes: string;
  diagnoses: DiagnosisRow[];
  investigations: InvestigationRow[];
  clinicalNotes: string;
  followUpDate: string;
  followUpInstructions: string;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
const AUTOSAVE_MS = 1500;

function toDraft(c: ConsultationDetail): Draft {
  return {
    complaints: c.complaints.map((s) => ({ complaintId: s.complaintId, text: s.text, duration: s.duration ?? '', note: s.note ?? '' })),
    history: {
      presentIllness: c.presentIllness ?? '',
      pastHistory: c.pastHistory ?? '',
      familyHistory: c.familyHistory ?? '',
      medicationHistory: c.medicationHistory ?? '',
      otherHistory: c.otherHistory ?? '',
    },
    vitals: Object.fromEntries(c.vitals.map((v) => [v.definitionId, v.value])),
    examinationNotes: c.examinationNotes ?? '',
    diagnoses: c.diagnoses.map((d) => ({ diagnosisId: d.diagnosisId, name: d.name, code: d.code, isPrimary: d.isPrimary, certainty: d.certainty as DiagnosisRow['certainty'], note: d.note ?? '' })),
    investigations: c.investigations.map((i) => ({ investigationId: i.investigationId, name: i.name, instructions: i.instructions ?? '', priority: i.priority as InvestigationRow['priority'] })),
    clinicalNotes: c.clinicalNotes ?? '',
    followUpDate: c.followUpDate ?? '',
    followUpInstructions: c.followUpInstructions ?? '',
  };
}

function toPayload(d: Draft, version: number): SaveConsultationInput {
  const nul = (v: string) => (v.trim() ? v.trim() : null);
  return {
    complaints: d.complaints.map((s) => ({ complaintId: s.complaintId, text: s.text, duration: nul(s.duration), note: nul(s.note) })),
    presentIllness: nul(d.history.presentIllness ?? ''),
    pastHistory: nul(d.history.pastHistory ?? ''),
    familyHistory: nul(d.history.familyHistory ?? ''),
    medicationHistory: nul(d.history.medicationHistory ?? ''),
    otherHistory: nul(d.history.otherHistory ?? ''),
    vitals: Object.entries(d.vitals)
      .filter(([, v]) => v.trim())
      .map(([definitionId, value]) => ({ definitionId, value })),
    examinationNotes: nul(d.examinationNotes),
    diagnoses: d.diagnoses.map((x) => ({ diagnosisId: x.diagnosisId, name: x.name, code: x.code, isPrimary: x.isPrimary, certainty: x.certainty, note: nul(x.note) })),
    investigations: d.investigations.map((x) => ({ investigationId: x.investigationId, name: x.name, instructions: nul(x.instructions), priority: x.priority })),
    clinicalNotes: nul(d.clinicalNotes),
    followUpDate: d.followUpDate || null,
    followUpInstructions: nul(d.followUpInstructions),
    version,
  };
}

/**
 * Consultation workspace (spec §9, §31): patient summary beside chief complaints,
 * history, examination (configurable vitals), diagnosis, investigations, private
 * notes and follow-up. Drafts autosave; finalizing locks the record.
 */
export function ConsultationPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can, user } = useAuth();
  const today = useToday();

  const q = useQuery({ queryKey: ['consultations', id], queryFn: () => consultationsApi.get(id!), refetchOnWindowFocus: false });
  const defs = useQuery({ queryKey: ['vital-definitions'], queryFn: () => vitalDefinitionsApi.list(), staleTime: 10 * 60_000 });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<'finalize' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [addendum, setAddendum] = useState('');
  const versionRef = useRef(0);
  const draftRef = useRef<Draft | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (q.data && (!draft || q.data.id !== id)) {
      setDraft(toDraft(q.data));
      draftRef.current = toDraft(q.data);
      versionRef.current = q.data.version;
      setSaveState('idle');
    }
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = q.data;
  const editable = !!c?.canEdit;

  /** Saves the latest draft; resolves true when the server has everything. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!id || !draftRef.current) return false;
    if (inFlight.current) await inFlight.current;
    if (timer.current) window.clearTimeout(timer.current);
    const payload = toPayload(draftRef.current, versionRef.current);
    const snapshot = draftRef.current;
    setSaveState('saving');
    const run = (async () => {
      try {
        const saved = await consultationsApi.save(id, payload);
        versionRef.current = saved.version;
        setFieldErrors({});
        setSavedAt(saved.updatedAt);
        setSaveState(draftRef.current === snapshot ? 'saved' : 'dirty');
        queryClient.setQueryData<ConsultationDetail>(['consultations', id], (old) => (old ? { ...old, ...saved } : old));
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'STALE_VERSION') setSaveState('conflict');
        else if (err instanceof ApiError && err.status === 422) {
          const map: Record<string, string> = {};
          for (const d of err.details) {
            const m = /^vitals\.(\d+)\.value$/.exec(d.path);
            if (m) map[payload.vitals[Number(m[1])]!.definitionId] = d.message;
            else map[d.path] = d.message;
          }
          setFieldErrors(map);
          setSaveState('error');
        } else setSaveState('error');
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [id, queryClient]);

  const update = (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...(typeof patch === 'function' ? patch(d) : patch) };
      draftRef.current = next;
      return next;
    });
    setSaveState('dirty');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveNow(), AUTOSAVE_MS);
  };

  // Ctrl/⌘+S saves immediately; warn before leaving with unsaved changes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && editable) {
        e.preventDefault();
        void saveNow();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (saveState === 'dirty' || saveState === 'saving') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [editable, saveNow, saveState]);

  // Retry failed (non-validation) saves after a short pause.
  useEffect(() => {
    if (saveState !== 'error' || Object.keys(fieldErrors).length) return;
    const retry = window.setTimeout(() => void saveNow(), 5000);
    return () => window.clearTimeout(retry);
  }, [saveState, fieldErrors, saveNow]);

  const finalize = async () => {
    setBusy(true);
    try {
      if (!(await saveNow())) {
        setConfirm(null);
        return;
      }
      const done = await consultationsApi.finalize(id!, versionRef.current);
      toast.success(t('consultation.finalized_toast'));
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ['consultations'] });
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.setQueryData<ConsultationDetail>(['consultations', id], (old) => (old ? { ...old, ...done } : old));
    } catch (err) {
      if (err instanceof ApiError && err.details.length) setFieldErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      toast.error(errorMessage(err));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const cancelDraft = async (reason: string) => {
    setBusy(true);
    try {
      await saveNow();
      await consultationsApi.cancel(id!, reason, versionRef.current);
      toast.success(t('consultation.cancelled_toast'));
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
      navigate('/queue');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const addAddendum = async () => {
    if (!addendum.trim()) return;
    setBusy(true);
    try {
      const updated = await consultationsApi.addendum(id!, addendum.trim());
      queryClient.setQueryData<ConsultationDetail>(['consultations', id], (old) => (old ? { ...old, ...updated } : old));
      setAddendum('');
      toast.success(t('consultation.addendum_added'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const vitalDefs = useMemo(() => defs.data ?? [], [defs.data]);
  const recordedBy = useMemo(() => Object.fromEntries((c?.vitals ?? []).map((v) => [v.definitionId, v.recordedByName])), [c?.vitals]);

  if (q.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Skeleton className="h-96" />
        <Skeleton className="h-[40rem]" />
      </div>
    );
  }
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage />;
  if (q.isError || !c) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;

  const statusTone = c.status === 'FINALIZED' ? 'success' : c.status === 'CANCELLED' ? 'danger' : 'warning';

  return (
    <div>
      <div className="no-print sticky top-14 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b border-border bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Link to="/queue" className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('consultation.back_to_queue')}
        </Link>
        <h1 className="text-base font-semibold text-ink">
          {t('consultation.title')} · {c.patient.fullName}
        </h1>
        <Badge tone={statusTone} dot>
          {t(`consultation.${c.status.toLowerCase()}`)}
        </Badge>
        {editable && <SaveIndicator state={saveState} savedAt={savedAt} />}
        <div className="ml-auto flex gap-2">
          {editable && (
            <>
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirm('cancel')}>
                {t('consultation.cancel')}
              </Button>
              <Button variant="secondary" size="sm" icon={<Save className="h-4 w-4" />} onClick={() => void saveNow()} disabled={saveState === 'saving'}>
                {t('common.save')}
              </Button>
              {can(PERMISSIONS.CONSULTATIONS_FINALIZE) && (
                <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setConfirm('finalize')}>
                  {t('consultation.finalize')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {saveState === 'conflict' && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden /> {t('consultation.conflict')}
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => window.location.reload()}>
            {t('consultation.reload')}
          </Button>
        </div>
      )}
      {!editable && c.status === 'DRAFT' && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-canvas px-4 py-2 text-sm text-ink-muted">
          <Lock className="h-4 w-4" aria-hidden /> {t('consultation.read_only', { doctor: c.doctor.fullName })}
        </p>
      )}
      {c.status === 'FINALIZED' && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-success/20 bg-success-soft px-4 py-2 text-sm text-success">
          <Lock className="h-4 w-4" aria-hidden /> {t('consultation.locked', { time: formatRelative(c.finalizedAt!), name: c.finalizedByName ?? '' })}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <PatientSummaryPanel c={c} />
        </div>
        <div className="space-y-4">
          {editable && draft ? (
            <>
              <ComplaintsSection rows={draft.complaints} onChange={(complaints) => update({ complaints })} error={fieldErrors.complaints} />
              <HistorySection values={draft.history} onChange={(key, value) => update((d) => ({ history: { ...d.history, [key]: value } }))} />
              <ExaminationSection
                definitions={vitalDefs}
                values={draft.vitals}
                recordedBy={recordedBy}
                errors={fieldErrors}
                onChange={(definitionId, value) => update((d) => ({ vitals: { ...d.vitals, [definitionId]: value } }))}
                notes={draft.examinationNotes}
                onNotes={(examinationNotes) => update({ examinationNotes })}
              />
              <DiagnosisSection rows={draft.diagnoses} onChange={(diagnoses) => update({ diagnoses })} error={fieldErrors.diagnoses} />
              <InvestigationsSection rows={draft.investigations} onChange={(investigations) => update({ investigations })} />
              <Section id="sec-notes" title={t('consultation.notes')}>
                <Textarea rows={3} value={draft.clinicalNotes} maxLength={4000} onChange={(e) => update({ clinicalNotes: e.target.value })} aria-describedby="notes-hint" />
                <p id="notes-hint" className="mt-1 text-2xs text-ink-subtle">
                  {t('consultation.notes_hint')}
                </p>
              </Section>
              <FollowUpSection
                date={draft.followUpDate}
                instructions={draft.followUpInstructions}
                onDate={(followUpDate) => update({ followUpDate })}
                onInstructions={(followUpInstructions) => update({ followUpInstructions })}
                today={today}
                addDays={addDays}
                error={fieldErrors.followUpDate}
              />
              <p className="text-center text-2xs text-ink-subtle">
                {t('consultation.shortcut_hint')} · {t('consultation.prescription_next')}
              </p>
            </>
          ) : (
            <>
              <ConsultationView c={c} />
              {c.status === 'FINALIZED' && can(PERMISSIONS.CONSULTATIONS_UPDATE) && c.doctor.id === user?.doctorId && (
                <section className="card p-4 sm:p-5">
                  <h2 className="mb-2 text-sm font-semibold text-ink">{t('consultation.add_addendum')}</h2>
                  <Textarea rows={3} value={addendum} maxLength={4000} placeholder={t('consultation.addendum_placeholder')} onChange={(e) => setAddendum(e.target.value)} />
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" loading={busy} disabled={!addendum.trim()} onClick={() => void addAddendum()}>
                      {t('consultation.add_addendum')}
                    </Button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'finalize'}
        title={t('consultation.finalize_title')}
        body={t('consultation.finalize_body')}
        tone="primary"
        confirmLabel={t('consultation.finalize')}
        loading={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => void finalize()}
      >
        {draft && (
          <div className="space-y-1 rounded-lg bg-canvas p-3 text-sm">
            <p>
              <span className="text-ink-subtle">{t('consultation.complaints')}:</span> {draft.complaints.map((x) => x.text).join(', ') || '—'}
            </p>
            <p>
              <span className="text-ink-subtle">{t('consultation.diagnosis')}:</span>{' '}
              {draft.diagnoses.map((x) => (x.isPrimary ? `★ ${x.name}` : x.name)).join(', ') || '—'}
            </p>
            <p>
              <span className="text-ink-subtle">{t('consultation.investigations')}:</span> {draft.investigations.map((x) => x.name).join(', ') || '—'}
            </p>
            <p>
              <span className="text-ink-subtle">{t('consultation.follow_up')}:</span> {draft.followUpDate || t('consultation.no_follow_up')}
            </p>
          </div>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'cancel'}
        title={t('consultation.cancel_title')}
        body={t('consultation.cancel_body')}
        confirmLabel={t('consultation.cancel')}
        requireReason
        loading={busy}
        onClose={() => setConfirm(null)}
        onConfirm={(reason) => void cancelDraft(reason)}
      />
    </div>
  );
}

function SaveIndicator({ state, savedAt }: { state: SaveState; savedAt: string | null }) {
  const { t } = useTranslation();
  const content =
    state === 'saving' ? (
      <>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t('consultation.saving')}
      </>
    ) : state === 'dirty' ? (
      t('consultation.unsaved')
    ) : state === 'error' ? (
      <>
        <CloudOff className="h-3.5 w-3.5" aria-hidden /> {t('consultation.save_failed')}
      </>
    ) : state === 'saved' ? (
      <>
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {t('consultation.saved')}
        {savedAt && <span className="text-ink-subtle">· {formatRelative(savedAt)}</span>}
      </>
    ) : null;
  return (
    <span role="status" aria-live="polite" className={clsx('inline-flex items-center gap-1 text-xs', state === 'error' ? 'text-danger' : state === 'saved' ? 'text-success' : 'text-ink-muted')}>
      {content}
    </span>
  );
}
