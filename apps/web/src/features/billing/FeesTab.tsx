import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Pencil, Plus, Power } from 'lucide-react';
import { FEE_ITEM_KINDS, PERMISSIONS, type DoctorDto, type FeeItemDto } from '@chamber/shared';
import { ActionMenu, Badge, Button, DataTable, EmptyState, Field, Input, Modal, Select, useToast, type Column } from '@/components/ui';
import { ApiError } from '@/services/api';
import { doctorFeesApi, feeItemsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDoctors } from '@/hooks/useChamber';
import { errorMessage, translateMessage } from '@/utils/errors';
import { CatalogPicker } from '@/features/consultations/components/CatalogPicker';
import { useMoney } from './money';

/** Fee schedule: doctor consultation fees and chamber charges for investigations, procedures and other items. */
export function FeesTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const editable = can(PERMISSIONS.BILLING_UPDATE);
  const doctors = useDoctors();
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">{t('billing.doctor_fees')}</h2>
        {!editable && <p className="mb-2 text-xs text-ink-muted">{t('billing.fees_read_only')}</p>}
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('appointments.doctor')}</th>
                <th className="text-right">{t('billing.fee_new')}</th>
                <th className="text-right">{t('billing.fee_follow')}</th>
                <th className="text-right">{t('billing.fee_report')}</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {(doctors.data ?? []).map((d) => (
                <DoctorFeeRow key={d.id} doctor={d} editable={editable} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <FeeItems editable={editable} />
    </div>
  );
}

function DoctorFeeRow({ doctor, editable }: { doctor: DoctorDto; editable: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const money = useMoney();
  const initial = () => ({ c: doctor.consultationFee?.toString() ?? '', f: doctor.followUpFee?.toString() ?? '', r: doctor.reportReviewFee?.toString() ?? '' });
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial()), [doctor]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(v) !== JSON.stringify(initial());
  const save = useMutation({
    mutationFn: () =>
      doctorFeesApi.update(doctor.id, { consultationFee: v.c === '' ? null : Number(v.c), followUpFee: v.f === '' ? null : Number(v.f), reportReviewFee: v.r === '' ? null : Number(v.r), version: doctor.version }),
    onSuccess: () => {
      toast.success(t('billing.fees_saved'));
      void queryClient.invalidateQueries({ queryKey: ['doctors'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const cell = (k: 'c' | 'f' | 'r', label: string) =>
    editable ? (
      <Input aria-label={`${doctor.fullName} — ${label}`} type="number" min={0} step="1" className="ml-auto !w-28 text-right" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    ) : (
      <span className="tabular-nums">{v[k] === '' ? '—' : money(Number(v[k]))}</span>
    );
  return (
    <tr>
      <td className="font-medium text-ink">{doctor.fullName}</td>
      <td className="text-right">{cell('c', t('billing.fee_new'))}</td>
      <td className="text-right">{cell('f', t('billing.fee_follow'))}</td>
      <td className="text-right">{cell('r', t('billing.fee_report'))}</td>
      <td className="text-right">
        {editable && dirty && (
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        )}
      </td>
    </tr>
  );
}

function FeeItems({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const money = useMoney();
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState<FeeItemDto | 'new' | null>(null);
  const list = useQuery({ queryKey: ['fee-items', 'admin', inactive], queryFn: () => feeItemsApi.list(inactive) });
  const toggle = useMutation({
    mutationFn: (f: FeeItemDto) => feeItemsApi.setStatus(f.id, !f.isActive),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['fee-items'] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const columns: Column<FeeItemDto>[] = [
    { key: 'name', header: t('catalog.name'), cell: (f) => <span className={clsx('font-medium', f.isActive ? 'text-ink' : 'text-ink-subtle line-through')}>{f.name}</span> },
    { key: 'kind', header: t('billing.type'), cell: (f) => <Badge tone={f.kind === 'INVESTIGATION' ? 'info' : 'neutral'}>{t(`invoiceItemType.${f.kind}`)}</Badge> },
    { key: 'amount', header: t('billing.amount'), className: 'text-right', cell: (f) => <span className="tabular-nums">{money(f.amount)}</span> },
    {
      key: 'actions',
      header: '',
      className: 'w-12 text-right',
      cell: (f) =>
        editable ? (
          <ActionMenu
            label={t('common.actions')}
            items={[
              { label: t('common.edit'), icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(f) },
              { label: f.isActive ? t('catalog.deactivate') : t('catalog.activate'), icon: <Power className="h-4 w-4" />, tone: f.isActive ? 'danger' : 'default', onSelect: () => toggle.mutate(f) },
            ]}
          />
        ) : null,
    },
  ];
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-ink">{t('billing.fee_schedule')}</h2>
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />
          {t('catalog.show_inactive')}
        </label>
        {editable && (
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            {t('billing.add_fee')}
          </Button>
        )}
      </div>
      <DataTable
        caption={t('billing.fee_schedule')}
        columns={columns}
        rows={list.data}
        rowKey={(f) => f.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={t('billing.no_fees')} />}
      />
      <FeeForm item={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

function FeeForm({ item, onClose }: { item: FeeItemDto | 'new' | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState({ kind: 'INVESTIGATION', name: '', amount: '', investigationId: null as string | null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!item) return;
    setErrors({});
    setF(item === 'new' ? { kind: 'INVESTIGATION', name: '', amount: '', investigationId: null } : { kind: item.kind, name: item.name, amount: String(item.amount), investigationId: item.investigationId });
  }, [item]);
  const save = async () => {
    setSaving(true);
    try {
      const body = { kind: f.kind, name: f.name.trim(), amount: Number(f.amount), investigationId: f.kind === 'INVESTIGATION' ? f.investigationId : null };
      if (item === 'new') await feeItemsApi.create(body);
      else if (item) await feeItemsApi.update(item.id, body);
      toast.success(t('billing.fee_saved'));
      void queryClient.invalidateQueries({ queryKey: ['fee-items'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={item === 'new' ? t('billing.add_fee') : t('billing.edit_fee')}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={saving} disabled={!f.name.trim() || f.amount === ''} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('billing.type')}>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {FEE_ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`invoiceItemType.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('billing.amount')} error={errors.amount ? translateMessage(errors.amount) : undefined}>
          <Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        {f.kind === 'INVESTIGATION' && (
          <div className="sm:col-span-2">
            <span className="label">{t('billing.link_investigation')}</span>
            <CatalogPicker
              kind="investigations"
              showFrequent={false}
              placeholder={t('consultation.investigation_placeholder')}
              onPick={(i) => setF({ ...f, investigationId: i.id, name: f.name || i.name })}
            />
            {f.investigationId && <p className="mt-1 text-2xs text-ink-subtle">{t('billing.linked')}</p>}
          </div>
        )}
        <Field label={t('catalog.name')} className="sm:col-span-2" error={errors.name ? translateMessage(errors.name) : undefined}>
          <Input value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
