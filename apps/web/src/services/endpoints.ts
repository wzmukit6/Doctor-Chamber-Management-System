import type {
  ChamberProfile,
  DashboardAnalyticsDto,
  DoctorProfileDto,
  DoctorSelfProfileInput,
  PasswordPolicyRules,
  ReportCatalogEntryDto,
  ReportResultDto,
  SecuritySettings,
  UpdateChamberProfileInput,
  UpdateSecuritySettingsInput,
  BillingSettings,
  BillingSummaryDto,
  CreateInvoiceInput,
  DoctorFeesInput,
  FeeItemDto,
  InvoiceDto,
  InvoicePrintDto,
  InvoiceSuggestionDto,
  InvoiceSummaryDto,
  RecordPaymentInput,
  RefundInput,
  UpdateBillingSettingsInput,
  UpdateInvoiceInput,
  MedicineDto,
  MedicineSuggestionsDto,
  PrescriptionDto,
  PrescriptionPrintDto,
  PrescriptionSettings,
  PrescriptionSummaryDto,
  PrescriptionTemplateDto,
  PrescriptionVerificationDto,
  PrescriptionVersionDto,
  PrescriptionItemInput,
  UpdatePrescriptionSettingsInput,
  CatalogItemDto,
  ConsultationContextDto,
  ConsultationDto,
  ConsultationSummaryDto,
  ConsultationVitalDto,
  SaveConsultationInput,
  VitalDefinitionDto,
  AppointmentAction,
  AppointmentDto,
  AppointmentHistoryDto,
  AppointmentSettings,
  AvailabilityDto,
  CreateAppointmentInput,
  DoctorDto,
  DoctorScheduleInput,
  QueueDto,
  QueueEntryDto,
  RescheduleAppointmentInput,
  UpdateAppointmentSettingsInput,
  AdminResetPasswordInput,
  AllergyInput,
  CreatePatientInput,
  DuplicateCandidateDto,
  DuplicateCheckInput,
  PatientDto,
  PatientSummaryDto,
  TimelineEventDto,
  UpdateMedicalHistoryInput,
  UpdatePatientInput,
  AuditLogDto,
  ChamberDto,
  ChangePasswordInput,
  CreateChamberInput,
  CreateOrganizationInput,
  CreateUserInput,
  CurrentUser,
  OrganizationDto,
  Permission,
  RoleDto,
  SetUserStatusInput,
  UpdateChamberInput,
  UpdateOrganizationInput,
  UpdateProfileInput,
  UpdateUserInput,
  UserDto,
  SystemStatusDto,
} from '@chamber/shared';
import { api, API_BASE, ApiError } from './api';

export type ListParams = Record<string, string | number | boolean | undefined>;

export const authApi = {
  me: () => api.get<CurrentUser>('/auth/me'),
  login: (email: string, password: string) => api.post<{ csrfToken: string }>('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  switchChamber: (membershipId: string) => api.post('/auth/switch-chamber', { membershipId }),
  changePassword: (input: ChangePasswordInput) => api.post('/auth/change-password', input),
  forgotPassword: (email: string) => api.post<{ message: string }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) => api.post('/auth/reset-password', { token, newPassword }),
  updateProfile: (input: UpdateProfileInput) => api.patch<CurrentUser>('/auth/profile', input),
  sessions: () =>
    api.get<{ id: string; ipAddress: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }[]>(
      '/auth/sessions',
    ),
  revokeSession: (id: string) => api.delete(`/auth/sessions/${id}`),
};

export const usersApi = {
  list: (params: ListParams) => api.page<UserDto>('/users', params),
  get: (id: string) => api.get<UserDto>(`/users/${id}`),
  create: (input: CreateUserInput) => api.post<UserDto>('/users', input),
  update: (id: string, input: UpdateUserInput) => api.patch<UserDto>(`/users/${id}`, input),
  setStatus: (id: string, input: SetUserStatusInput) => api.post<UserDto>(`/users/${id}/status`, input),
  resetPassword: (id: string, input: AdminResetPasswordInput) => api.post(`/users/${id}/reset-password`, input),
  unlock: (id: string) => api.post<UserDto>(`/users/${id}/unlock`),
  remove: (id: string, reason: string) => api.delete(`/users/${id}`, { reason }),
};

export const rolesApi = {
  list: () => api.get<RoleDto[]>('/roles'),
  groups: () => api.get<{ key: string; permissions: Permission[] }[]>('/roles/permission-groups'),
  updatePermissions: (id: string, permissions: Permission[], reason: string) =>
    api.put<RoleDto>(`/roles/${id}/permissions`, { permissions, reason }),
};

export const organizationsApi = {
  list: (params: ListParams) => api.page<OrganizationDto>('/organizations', params),
  create: (input: CreateOrganizationInput) => api.post<OrganizationDto>('/organizations', input),
  update: (id: string, input: UpdateOrganizationInput) => api.patch<OrganizationDto>(`/organizations/${id}`, input),
  remove: (id: string, reason: string) => api.delete(`/organizations/${id}`, { reason }),
};

export const chambersApi = {
  list: (params: ListParams) => api.page<ChamberDto>('/chambers', params),
  get: (id: string) => api.get<ChamberDto>(`/chambers/${id}`),
  create: (input: CreateChamberInput) => api.post<ChamberDto>('/chambers', input),
  update: (id: string, input: UpdateChamberInput) => api.patch<ChamberDto>(`/chambers/${id}`, input),
  remove: (id: string, reason: string) => api.delete(`/chambers/${id}`, { reason }),
};

export const systemApi = {
  status: () => api.get<SystemStatusDto>('/system/status'),
};

export const auditApi = {
  list: (params: ListParams) => api.page<AuditLogDto>('/audit-logs', params),
  verify: () => api.get<{ valid: boolean; checked: number; brokenAtSeq: string | null }>('/audit-logs/verify'),
};

export const patientsApi = {
  list: (params: ListParams) => api.page<PatientSummaryDto>('/patients', params),
  search: (q: string, limit = 8) => api.get<PatientSummaryDto[]>('/patients/search', { q, limit }),
  recent: () => api.get<PatientSummaryDto[]>('/patients/recent'),
  get: (id: string) => api.get<PatientDto>(`/patients/${id}`),
  duplicates: (input: DuplicateCheckInput) => api.post<DuplicateCandidateDto[]>('/patients/duplicates', input),
  create: (input: CreatePatientInput) => api.post<PatientDto>('/patients', input),
  update: (id: string, input: UpdatePatientInput) => api.patch<PatientDto>(`/patients/${id}`, input),
  updateMedical: (id: string, input: UpdateMedicalHistoryInput) => api.put<PatientDto>(`/patients/${id}/medical-history`, input),
  addAllergy: (id: string, input: AllergyInput) => api.post<PatientDto>(`/patients/${id}/allergies`, input),
  removeAllergy: (id: string, allergyId: string, reason: string) => api.delete<PatientDto>(`/patients/${id}/allergies/${allergyId}`, { reason }),
  remove: (id: string, reason: string) => api.delete(`/patients/${id}`, { reason }),
  timeline: (id: string, params: { types?: string; before?: string; limit?: number }) =>
    api.get<{ events: TimelineEventDto[]; hasMore: boolean }>(`/patients/${id}/timeline`, params),
};

export const doctorsApi = {
  list: () => api.get<DoctorDto[]>('/doctors'),
  updateSchedule: (id: string, input: DoctorScheduleInput) => api.put<DoctorDto>(`/doctors/${id}/schedule`, input),
};

export type AppointmentDetail = AppointmentDto & { history: AppointmentHistoryDto[] };

export const appointmentsApi = {
  list: (params: { from: string; to: string; doctorId?: string; patientId?: string; status?: string }) => api.get<AppointmentDto[]>('/appointments', params),
  get: (id: string) => api.get<AppointmentDetail>(`/appointments/${id}`),
  availability: (doctorId: string, date: string, excludeAppointmentId?: string) =>
    api.get<AvailabilityDto>('/appointments/availability', { doctorId, date, excludeAppointmentId }),
  create: (input: CreateAppointmentInput) => api.post<AppointmentDto>('/appointments', input),
  reschedule: (id: string, input: RescheduleAppointmentInput) => api.post<AppointmentDto>(`/appointments/${id}/reschedule`, input),
  act: (id: string, action: AppointmentAction, body: { reason?: string | null; version?: number } = {}) =>
    api.post<AppointmentDto>(`/appointments/${id}/actions/${action}`, body),
};

export const queueApi = {
  get: (params: { date?: string; doctorId?: string }) => api.get<QueueDto>('/queue', params),
  callNext: (doctorId: string) => api.post<QueueEntryDto | null>('/queue/call-next', { doctorId }),
  call: (appointmentId: string) => api.post<QueueEntryDto>(`/queue/${appointmentId}/call`),
  hold: (appointmentId: string) => api.post<QueueEntryDto>(`/queue/${appointmentId}/hold`),
  resume: (appointmentId: string) => api.post<QueueEntryDto>(`/queue/${appointmentId}/resume`),
};

export const settingsApi = {
  appointments: () => api.get<AppointmentSettings & { version: number }>('/settings/appointments'),
  updateAppointments: (input: UpdateAppointmentSettingsInput) => api.put<AppointmentSettings & { version: number }>('/settings/appointments', input),
  prescriptions: () => api.get<PrescriptionSettings & { version: number }>('/settings/prescriptions'),
  updatePrescriptions: (input: UpdatePrescriptionSettingsInput) => api.put<PrescriptionSettings & { version: number }>('/settings/prescriptions', input),
  billing: () => api.get<BillingSettings & { version: number }>('/settings/billing'),
  chamberProfile: () => api.get<ChamberProfile & { version: number }>('/settings/chamber-profile'),
  updateChamberProfile: (input: UpdateChamberProfileInput) => api.put<ChamberProfile & { version: number }>('/settings/chamber-profile', input),
  security: () => api.get<SecuritySettings & { version: number }>('/settings/security'),
  updateSecurity: (input: UpdateSecuritySettingsInput) => api.put<SecuritySettings & { version: number }>('/settings/security', input),
  updateBilling: (input: UpdateBillingSettingsInput) => api.put<BillingSettings & { version: number }>('/settings/billing', input),
};

export type CatalogKind = 'diagnoses' | 'investigations' | 'complaints';
export type ConsultationDetail = ConsultationDto & { context: ConsultationContextDto };

export const catalogApi = {
  search: (kind: CatalogKind, params: { q?: string; scope?: string; includeInactive?: boolean; limit?: number }) => api.get<CatalogItemDto[]>(`/${kind}`, params),
  frequent: (kind: CatalogKind) => api.get<CatalogItemDto[]>(`/${kind}/frequent`),
  create: (kind: CatalogKind, input: Record<string, unknown>) => api.post<CatalogItemDto>(`/${kind}`, input),
  update: (kind: CatalogKind, id: string, input: Record<string, unknown>) => api.patch<CatalogItemDto>(`/${kind}/${id}`, input),
  setStatus: (kind: CatalogKind, id: string, isActive: boolean) => api.post<CatalogItemDto>(`/${kind}/${id}/status`, { isActive }),
};

export const vitalDefinitionsApi = {
  list: (includeInactive = false) => api.get<VitalDefinitionDto[]>('/vital-definitions', { includeInactive }),
  create: (input: Record<string, unknown>) => api.post<VitalDefinitionDto>('/vital-definitions', input),
  update: (id: string, input: Record<string, unknown>) => api.patch<VitalDefinitionDto>(`/vital-definitions/${id}`, input),
};

export const consultationsApi = {
  list: (params: ListParams) => api.page<ConsultationSummaryDto>('/consultations', params),
  followUps: (params: { from: string; to: string; doctorId?: string }) => api.get<ConsultationSummaryDto[]>('/consultations/follow-ups', params),
  get: (id: string) => api.get<ConsultationDetail>(`/consultations/${id}`),
  start: (patientId: string, appointmentId?: string) => api.post<ConsultationDetail>('/consultations', { patientId, appointmentId }),
  save: (id: string, input: SaveConsultationInput) => api.put<ConsultationDto>(`/consultations/${id}`, input),
  finalize: (id: string, version: number) => api.post<ConsultationDto>(`/consultations/${id}/finalize`, { version }),
  cancel: (id: string, reason: string, version: number) => api.post<ConsultationDto>(`/consultations/${id}/cancel`, { reason, version }),
  addendum: (id: string, text: string) => api.post<ConsultationDto>(`/consultations/${id}/addenda`, { text }),
  preVitals: (appointmentId: string) => api.get<ConsultationVitalDto[]>(`/appointments/${appointmentId}/vitals`),
  recordVitals: (appointmentId: string, vitals: { definitionId: string; value: string }[]) =>
    api.put<ConsultationVitalDto[]>(`/appointments/${appointmentId}/vitals`, { vitals }),
};

export const medicinesApi = {
  search: (params: { q?: string; form?: string; scope?: string; includeInactive?: boolean; limit?: number }) => api.get<MedicineDto[]>('/medicines', params),
  suggestions: () => api.get<MedicineSuggestionsDto>('/medicines/suggestions'),
  create: (input: Record<string, unknown>) => api.post<MedicineDto>('/medicines', input),
  update: (id: string, input: Record<string, unknown>) => api.patch<MedicineDto>(`/medicines/${id}`, input),
  setStatus: (id: string, isActive: boolean) => api.post<MedicineDto>(`/medicines/${id}/status`, { isActive }),
  favorite: (id: string, on: boolean) => (on ? api.put<MedicineDto>(`/medicines/${id}/favorite`, {}) : api.delete<MedicineDto>(`/medicines/${id}/favorite`)),
};

export type LatestPrescription = PrescriptionVersionDto & { rxNumber: string | null; issuedAt: string | null };

export const prescriptionsApi = {
  list: (params: ListParams) => api.page<PrescriptionSummaryDto>('/prescriptions', params),
  get: (id: string) => api.get<PrescriptionDto>(`/prescriptions/${id}`),
  latest: (patientId: string, excludeConsultationId?: string) => api.get<LatestPrescription | null>('/prescriptions/latest', { patientId, excludeConsultationId }),
  printData: (id: string, version?: number) => api.get<PrescriptionPrintDto>(`/prescriptions/${id}/print`, { version }),
  logPrint: (id: string, versionNumber: number) => api.post(`/prescriptions/${id}/print-log`, { versionNumber }),
  revise: (id: string, reason: string, version: number) => api.post<PrescriptionDto>(`/prescriptions/${id}/revisions`, { reason, version }),
  saveDraft: (id: string, input: { items: PrescriptionItemInput[]; advice: string | null; version: number }) => api.put<PrescriptionDto>(`/prescriptions/${id}/draft`, input),
  finalize: (id: string, version: number) => api.post<PrescriptionDto>(`/prescriptions/${id}/finalize`, { version }),
  discard: (id: string, version: number) => api.post<PrescriptionDto>(`/prescriptions/${id}/discard`, { version }),
  verify: (token: string) => api.get<PrescriptionVerificationDto>(`/public/prescriptions/verify/${encodeURIComponent(token)}`),
};

export const templatesApi = {
  list: () => api.get<PrescriptionTemplateDto[]>('/prescription-templates'),
  create: (input: Record<string, unknown>) => api.post<PrescriptionTemplateDto>('/prescription-templates', input),
  update: (id: string, input: Record<string, unknown>) => api.patch<PrescriptionTemplateDto>(`/prescription-templates/${id}`, input),
  remove: (id: string) => api.delete(`/prescription-templates/${id}`),
};

export const invoicesApi = {
  list: (params: ListParams) => api.page<InvoiceSummaryDto>('/invoices', params),
  get: (id: string) => api.get<InvoiceDto>(`/invoices/${id}`),
  suggest: (params: { appointmentId?: string; patientId?: string }) => api.get<InvoiceSuggestionDto>('/invoices/suggest', params),
  summary: (params: { from: string; to: string; doctorId?: string }) => api.get<BillingSummaryDto>('/invoices/summary', params),
  create: (input: CreateInvoiceInput) => api.post<InvoiceDto>('/invoices', input),
  update: (id: string, input: UpdateInvoiceInput) => api.patch<InvoiceDto>(`/invoices/${id}`, input),
  pay: (id: string, input: RecordPaymentInput) => api.post<InvoiceDto>(`/invoices/${id}/payments`, input),
  refund: (id: string, input: RefundInput) => api.post<InvoiceDto>(`/invoices/${id}/refunds`, input),
  void: (id: string, reason: string, version: number) => api.post<InvoiceDto>(`/invoices/${id}/void`, { reason, version }),
  printData: (id: string) => api.get<InvoicePrintDto>(`/invoices/${id}/print`),
  logPrint: (id: string) => api.post(`/invoices/${id}/print-log`),
};

export const feeItemsApi = {
  list: (includeInactive = false) => api.get<FeeItemDto[]>('/fee-items', { includeInactive }),
  create: (input: Record<string, unknown>) => api.post<FeeItemDto>('/fee-items', input),
  update: (id: string, input: Record<string, unknown>) => api.patch<FeeItemDto>(`/fee-items/${id}`, input),
  setStatus: (id: string, isActive: boolean) => api.post<FeeItemDto>(`/fee-items/${id}/status`, { isActive }),
};

export const doctorProfileApi = {
  get: (doctorId: string) => api.get<DoctorProfileDto>(`/doctors/${doctorId}/profile`),
  update: (doctorId: string, input: DoctorSelfProfileInput) => api.put<DoctorProfileDto>(`/doctors/${doctorId}/profile`, input),
};

export const passwordPolicyApi = {
  get: () => api.get<PasswordPolicyRules>('/auth/password-policy'),
};

export type ReportParams = { from: string; to: string; doctorId?: string };

export const reportsApi = {
  catalog: () => api.get<ReportCatalogEntryDto[]>('/reports'),
  run: (key: string, params: ReportParams) => api.get<ReportResultDto>(`/reports/${key}`, params),
  dashboard: (days: number) => api.get<DashboardAnalyticsDto>('/reports/dashboard', { days }),
  /** Downloads a CSV/Excel export (the server audits every export). */
  download: async (key: string, params: ReportParams & { format: 'csv' | 'xlsx'; lang: string }) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]);
    const res = await fetch(`${API_BASE}/reports/${key}/export?${qs}`, { credentials: 'include' });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
      throw new ApiError(res.status, (body?.error?.code ?? 'INTERNAL_ERROR') as never, body?.error?.message ?? 'Export failed');
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${key}.${params.format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export const doctorFeesApi = {
  update: (doctorId: string, input: DoctorFeesInput) => api.put<DoctorDto>(`/doctors/${doctorId}/fees`, input),
};
