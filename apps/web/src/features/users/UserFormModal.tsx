import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  createUserSchema,
  MANAGEABLE_ROLES,
  updateUserSchema,
  type RoleKey,
  type UserDto,
} from '@chamber/shared';
import { Button, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { chambersApi, usersApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { applyServerErrors, errorMessage } from '@/utils/errors';

type CreateForm = z.input<typeof createUserSchema>;
type EditForm = z.input<typeof updateUserSchema>;

const toNumberOrNull = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));

function DoctorProfileFields({ register, errors, prefix }: { register: any; errors: any; prefix: string }) {
  const { t } = useTranslation();
  const e = errors?.doctorProfile ?? {};
  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-xs font-semibold text-ink-muted">{t('users.doctor_profile')}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('users.qualifications')} error={e.qualifications?.message} optional>
          <Input placeholder="MBBS, FCPS" {...register(`${prefix}.qualifications`)} />
        </Field>
        <Field label={t('users.specialty')} error={e.specialty?.message} optional>
          <Input {...register(`${prefix}.specialty`)} />
        </Field>
        <Field label={t('users.registration_no')} error={e.registrationNo?.message} optional>
          <Input {...register(`${prefix}.registrationNo`)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('users.consultation_fee')} error={e.consultationFee?.message} optional>
            <Input type="number" min={0} inputMode="numeric" {...register(`${prefix}.consultationFee`, { setValueAs: toNumberOrNull })} />
          </Field>
          <Field label={t('users.follow_up_fee')} error={e.followUpFee?.message} optional>
            <Input type="number" min={0} inputMode="numeric" {...register(`${prefix}.followUpFee`, { setValueAs: toNumberOrNull })} />
          </Field>
        </div>
        <Field label={t('users.bio')} error={e.bio?.message} optional className="sm:col-span-2">
          <Textarea rows={2} {...register(`${prefix}.bio`)} />
        </Field>
      </div>
    </fieldset>
  );
}

export function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const actorRole = user!.activeMembership.role;
  const isSuperAdmin = actorRole === 'SUPER_ADMIN';
  const roles = MANAGEABLE_ROLES[actorRole];

  const chambers = useQuery({
    queryKey: ['chambers', 'options'],
    queryFn: () => chambersApi.list({ pageSize: 100, sort: 'name', order: 'asc' }),
    enabled: open && isSuperAdmin,
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { role: roles.includes('DOCTOR') ? 'DOCTOR' : roles[0], preferredLanguage: 'en' },
  });
  const role = useWatch({ control, name: 'role' }) as RoleKey;

  useEffect(() => {
    if (open) reset({ role: roles.includes('DOCTOR') ? 'DOCTOR' : roles[0], preferredLanguage: 'en' });
  }, [open, reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => {
      toast.success(t('users.created'));
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const input = createUserSchema.parse(values);
    try {
      await mutation.mutateAsync({
        ...input,
        chamberId: input.role === 'SUPER_ADMIN' ? null : isSuperAdmin ? input.chamberId : null,
        doctorProfile: input.role === 'DOCTOR' ? input.doctorProfile : undefined,
      });
    } catch (err) {
      if (!applyServerErrors(err, setError)) toast.error(errorMessage(err));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('users.new')}
      size="lg"
      busy={isSubmitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="create-user-form" loading={isSubmitting}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('users.full_name')} error={errors.fullName?.message}>
            <Input data-autofocus autoComplete="off" {...register('fullName')} />
          </Field>
          <Field label={t('common.email')} error={errors.email?.message}>
            <Input type="email" autoComplete="off" {...register('email')} />
          </Field>
          <Field label={t('common.phone')} error={errors.phone?.message} optional>
            <Input type="tel" placeholder="01XXXXXXXXX" {...register('phone', { setValueAs: (v) => (v === '' ? null : v) })} />
          </Field>
          <Field label={t('users.role')} error={errors.role?.message}>
            <Select {...register('role')}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          {role !== 'SUPER_ADMIN' && (
            <Field label={t('users.chamber')} error={errors.chamberId?.message}>
              {isSuperAdmin ? (
                <Select {...register('chamberId', { setValueAs: (v) => (v === '' ? null : v) })}>
                  <option value="">—</option>
                  {chambers.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={user!.activeMembership.chamber?.name ?? ''} disabled readOnly />
              )}
            </Field>
          )}
          <Field label={t('users.preferred_language')}>
            <Select {...register('preferredLanguage')}>
              <option value="en">{t('common.english')}</option>
              <option value="bn">{t('common.bangla')}</option>
            </Select>
          </Field>
          <Field label={t('users.initial_password')} error={errors.password?.message} hint={`${t('auth.password_policy')} ${t('users.initial_password_hint')}`} className="sm:col-span-2">
            <Input type="password" autoComplete="new-password" {...register('password')} />
          </Field>
        </div>
        {role === 'DOCTOR' && <DoctorProfileFields register={register} errors={errors} prefix="doctorProfile" />}
      </form>
    </Modal>
  );
}

export function EditUserModal({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EditForm>({ resolver: zodResolver(updateUserSchema) });

  useEffect(() => {
    if (user) {
      reset({
        fullName: user.fullName,
        phone: user.phone,
        preferredLanguage: user.preferredLanguage,
        version: user.version,
        doctorProfile: user.doctorProfile
          ? {
              qualifications: user.doctorProfile.qualifications,
              specialty: user.doctorProfile.specialty,
              registrationNo: user.doctorProfile.registrationNo,
              consultationFee: user.doctorProfile.consultationFee,
              followUpFee: user.doctorProfile.followUpFee,
              bio: user.doctorProfile.bio,
            }
          : undefined,
      });
    }
  }, [user, reset]);

  const onSubmit = handleSubmit(async (values) => {
    if (!user) return;
    try {
      await usersApi.update(user.id, updateUserSchema.parse(values));
      toast.success(t('users.updated'));
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (err) {
      if (!applyServerErrors(err, setError)) toast.error(errorMessage(err));
    }
  });

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={t('users.edit')}
      description={user?.email}
      size="lg"
      busy={isSubmitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="edit-user-form" loading={isSubmitting}>
            {t('common.save_changes')}
          </Button>
        </>
      }
    >
      <form id="edit-user-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('users.full_name')} error={errors.fullName?.message}>
            <Input data-autofocus {...register('fullName')} />
          </Field>
          <Field label={t('common.phone')} error={errors.phone?.message} optional>
            <Input type="tel" {...register('phone', { setValueAs: (v) => (v === '' ? null : v) })} />
          </Field>
          <Field label={t('users.preferred_language')}>
            <Select {...register('preferredLanguage')}>
              <option value="en">{t('common.english')}</option>
              <option value="bn">{t('common.bangla')}</option>
            </Select>
          </Field>
        </div>
        {user?.doctorProfile && <DoctorProfileFields register={register} errors={errors} prefix="doctorProfile" />}
      </form>
    </Modal>
  );
}
