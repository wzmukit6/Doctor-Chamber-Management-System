import type { PrescriptionSettings } from './schemas/prescriptions';
import type { BillingSettings } from './schemas/billing';
import type { Permission } from './permissions';
import type { RoleKey } from './roles';

export interface MembershipSummary {
  id: string;
  role: RoleKey;
  organization: { id: string; name: string } | null;
  chamber: { id: string; name: string; code: string; timezone: string } | null;
}

export interface CurrentUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  preferredLanguage: 'en' | 'bn';
  mustChangePassword: boolean;
  activeMembership: MembershipSummary;
  memberships: MembershipSummary[];
  permissions: Permission[];
  doctorId: string | null;
}

export interface UserDto {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  preferredLanguage: 'en' | 'bn';
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  version: number;
  memberships: MembershipSummary[];
  doctorProfile: {
    id: string;
    qualifications: string | null;
    specialty: string | null;
    registrationNo: string | null;
    consultationFee: number | null;
    followUpFee: number | null;
    bio: string | null;
  } | null;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  isDemo: boolean;
  createdAt: string;
  version: number;
  chamberCount: number;
}

export interface ChamberDto {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  isActive: boolean;
  isDemo: boolean;
  createdAt: string;
  version: number;
  staffCount: number;
}

export interface RoleDto {
  id: string;
  key: RoleKey;
  name: string;
  description: string | null;
  permissions: Permission[];
  forbidden: Permission[];
  userCount: number;
}

export interface AuditLogDto {
  id: string;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  role: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  chamberId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface EmergencyContactDto {
  id: string;
  name: string;
  relation: string | null;
  phone: string;
}

export interface AllergyDto {
  id: string;
  allergen: string;
  reaction: string | null;
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'UNKNOWN';
  createdAt: string;
}

export interface MedicalHistoryDto {
  existingConditions: string | null;
  previousSurgeries: string | null;
  currentMedications: string | null;
  relevantHistory: string | null;
  familyHistory: string | null;
  lifestyle: string | null;
  version: number;
  updatedAt: string | null;
  updatedByName: string | null;
}

/** Row in patient lists and search results. */
export interface PatientSummaryDto {
  id: string;
  patientCode: string;
  fullName: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'UNDISCLOSED';
  dateOfBirth: string | null;
  dobEstimated: boolean;
  age: number | null;
  phone: string | null;
  bloodGroup: string | null;
  registeredAt: string;
  isDemo: boolean;
}

export interface PatientDto extends PatientSummaryDto {
  chamberId: string;
  email: string | null;
  address: string | null;
  occupation: string | null;
  nationality: string | null;
  emergencyContacts: EmergencyContactDto[];
  version: number;
  registeredByName: string | null;
  updatedAt: string;
  /** Present only when the viewer holds `patients.view_medical`. */
  medical: { history: MedicalHistoryDto; allergies: AllergyDto[] } | null;
}

export interface DuplicateCandidateDto extends PatientSummaryDto {
  matchReasons: ('phone' | 'name' | 'dob')[];
}

export interface TimelineEventDto {
  id: string;
  type: 'registration' | 'record' | 'appointment' | 'consultation' | 'diagnosis' | 'prescription' | 'investigation' | 'payment' | 'follow_up';
  occurredAt: string;
  title: string;
  /** Translation key + params so the client can localize. */
  titleKey: string;
  details: Record<string, string | number | null>;
  actorName: string | null;
}

export interface DoctorScheduleWindowDto {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface DoctorDto {
  id: string;
  userId: string;
  fullName: string;
  specialty: string | null;
  qualifications: string | null;
  consultationFee: number | null;
  followUpFee: number | null;
  reportReviewFee: number | null;
  registrationNo: string | null;
  hasSignature: boolean;
  isActive: boolean;
  schedule: DoctorScheduleWindowDto[];
  slotMinutes: number | null;
  maxDailyPatients: number | null;
  version: number;
}

export interface AppointmentDto {
  id: string;
  chamberId: string;
  patient: { id: string; patientCode: string; fullName: string; gender: string; age: number | null; phone: string | null };
  doctor: { id: string; fullName: string; specialty: string | null };
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: import('./appointments').AppointmentStatus;
  visitType: import('./appointments').VisitType;
  reason: string | null;
  notes: string | null;
  token: { number: number; label: string; onHold: boolean; calledAt: string | null; callCount: number } | null;
  checkedInAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledReason: string | null;
  createdByName: string | null;
  createdAt: string;
  version: number;
  /** Consultation started from this appointment, if any. */
  consultationId: string | null;
  /** The visit's bill (not void), when the viewer may see billing. */
  billing?: AppointmentBillingDto | null;
}

export interface AppointmentHistoryDto {
  id: string;
  action: 'CREATED' | 'STATUS_CHANGED' | 'RESCHEDULED' | 'UPDATED';
  fromStatus: string | null;
  toStatus: string | null;
  details: Record<string, unknown> | null;
  reason: string | null;
  changedByName: string | null;
  createdAt: string;
}

export interface AvailabilitySlotDto {
  startsAt: string;
  endsAt: string;
  time: string;
  available: boolean;
  past: boolean;
}

export interface AvailabilityDto {
  date: string;
  timezone: string;
  slotMinutes: number;
  windows: { startTime: string; endTime: string }[];
  slots: AvailabilitySlotDto[];
  bookedCount: number;
  maxDailyPatients: number | null;
}

export interface QueueEntryDto extends AppointmentDto {
  waitingSince: string | null;
}

export interface QueueDto {
  date: string;
  timezone: string;
  entries: QueueEntryDto[];
  summary: { waiting: number; onHold: number; inConsultation: number; completed: number; checkedIn: number; booked: number };
}

export interface CatalogItemDto {
  id: string;
  name: string;
  code?: string | null;
  codeSystem?: string | null;
  shortName?: string | null;
  category: string | null;
  description?: string | null;
  sampleType?: string | null;
  instructions?: string | null;
  keywords?: string | null;
  isActive: boolean;
  isGlobal: boolean;
  usageCount?: number;
}

export interface VitalDefinitionDto {
  id: string;
  key: string;
  label: string;
  unit: string | null;
  type: 'NUMBER' | 'BLOOD_PRESSURE' | 'TEXT';
  minValue: number | null;
  maxValue: number | null;
  decimals: number;
  sortOrder: number;
  isActive: boolean;
  isGlobal: boolean;
}

export interface ConsultationVitalDto {
  definitionId: string;
  key: string;
  label: string;
  unit: string | null;
  value: string;
  recordedByName: string | null;
  recordedAt: string;
}

export interface ConsultationDto {
  id: string;
  chamberId: string;
  status: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
  visitNumber: number;
  patient: {
    id: string;
    patientCode: string;
    fullName: string;
    gender: string;
    age: number | null;
    dobEstimated: boolean;
    bloodGroup: string | null;
    phone: string | null;
  };
  doctor: { id: string; fullName: string; specialty: string | null; qualifications: string | null; registrationNo: string | null };
  appointmentId: string | null;
  complaints: { id: string; complaintId: string | null; text: string; duration: string | null; note: string | null }[];
  presentIllness: string | null;
  pastHistory: string | null;
  familyHistory: string | null;
  medicationHistory: string | null;
  otherHistory: string | null;
  vitals: ConsultationVitalDto[];
  examinationNotes: string | null;
  diagnoses: { id: string; diagnosisId: string | null; name: string; code: string | null; isPrimary: boolean; certainty: string; note: string | null }[];
  investigations: { id: string; investigationId: string | null; name: string; instructions: string | null; priority: string }[];
  /** null when the viewer lacks `clinical_notes.view`. */
  clinicalNotes: string | null;
  clinicalNotesHidden: boolean;
  addenda: { id: string; text: string; createdByName: string | null; createdAt: string }[];
  followUpDate: string | null;
  followUpInstructions: string | null;
  startedAt: string;
  finalizedAt: string | null;
  finalizedByName: string | null;
  cancelledReason: string | null;
  updatedAt: string;
  version: number;
  /** Can the current user edit / finalize this consultation? */
  canEdit: boolean;
  /** The visit's prescription: draft content while editing, the current version once finalized. */
  prescription: ConsultationPrescriptionDto | null;
}

export interface ConsultationPrescriptionDto {
  id: string;
  rxNumber: string | null;
  status: 'DRAFT' | 'FINALIZED' | 'REVISED' | 'CANCELLED';
  versionNumber: number;
  items: PrescriptionItemDto[];
  advice: string | null;
}

export interface ConsultationSummaryDto {
  id: string;
  status: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
  visitNumber: number;
  patient: { id: string; patientCode: string; fullName: string; age: number | null; gender: string };
  doctor: { id: string; fullName: string };
  primaryDiagnosis: string | null;
  diagnosisCount: number;
  complaints: string[];
  investigationCount: number;
  followUpDate: string | null;
  startedAt: string;
  finalizedAt: string | null;
}

/** Patient context shown beside the consultation form (spec §9 "Patient Summary"). */
export interface ConsultationContextDto {
  allergies: AllergyDto[];
  existingConditions: string | null;
  currentMedications: string | null;
  previousVisits: ConsultationSummaryDto[];
  medicalHidden: boolean;
}

// ───────────── Prescriptions (Phase 5) ─────────────

export interface MedicineDto {
  id: string;
  genericName: string;
  brandName: string | null;
  manufacturer: string | null;
  form: string;
  strength: string | null;
  category: string | null;
  route: string | null;
  defaultDose: string | null;
  commonFrequencies: string[];
  commonDurations: string[];
  keywords: string | null;
  isActive: boolean;
  isGlobal: boolean;
  isFavorite: boolean;
  usageCount?: number;
}

export interface MedicineSuggestionsDto {
  favorites: MedicineDto[];
  frequent: MedicineDto[];
  recent: MedicineDto[];
}

export interface PrescriptionItemDto {
  id?: string;
  medicineId: string | null;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  durationValue: number | null;
  durationUnit: string | null;
  quantity: number | null;
  mealInstruction: string | null;
  timing: string | null;
  instructions: string | null;
}

export interface PrescriptionVersionDto {
  id: string;
  versionNumber: number;
  status: 'DRAFT' | 'FINALIZED' | 'SUPERSEDED' | 'DISCARDED';
  advice: string | null;
  revisionReason: string | null;
  items: PrescriptionItemDto[];
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
  finalizedByName: string | null;
  finalizedAt: string | null;
  supersededAt: string | null;
  discardedAt: string | null;
  /** Only for finalized/superseded versions and viewers who may print. */
  verificationToken: string | null;
  contentHash: string | null;
}

export interface PrescriptionSummaryDto {
  id: string;
  rxNumber: string | null;
  status: 'DRAFT' | 'FINALIZED' | 'REVISED' | 'CANCELLED';
  currentVersion: number;
  hasDraftRevision: boolean;
  patient: { id: string; patientCode: string; fullName: string; age: number | null; gender: string };
  doctor: { id: string; fullName: string };
  consultationId: string;
  itemCount: number;
  primaryDiagnosis: string | null;
  issuedAt: string | null;
  createdAt: string;
}

export interface PrescriptionDto extends PrescriptionSummaryDto {
  versions: PrescriptionVersionDto[];
  version: number;
  /** Current user is the prescribing doctor and holds `prescriptions.revise`. */
  canRevise: boolean;
}

export interface PrescriptionTemplateDto {
  id: string;
  name: string;
  description: string | null;
  shared: boolean;
  ownerName: string | null;
  isOwn: boolean;
  canEdit: boolean;
  diagnoses: { diagnosisId?: string | null; name: string; code?: string | null; isPrimary?: boolean; certainty?: string; note?: string | null }[];
  investigations: { investigationId?: string | null; name: string; instructions?: string | null; priority?: string }[];
  items: PrescriptionItemDto[];
  advice: string | null;
  followUpInstructions: string | null;
  updatedAt: string;
  version: number;
}

/** Everything needed to render the printable prescription (spec §13). */
export interface PrescriptionPrintDto {
  prescriptionId: string;
  rxNumber: string | null;
  status: PrescriptionDto['status'];
  version: PrescriptionVersionDto;
  latestVersionNumber: number;
  chamber: { name: string; address: string | null; phone: string | null; email: string | null; timezone: string; logoDataUrl: string | null; tagline: string | null };
  doctor: { fullName: string; qualifications: string | null; specialty: string | null; registrationNo: string | null; signatureDataUrl: string | null; prescriptionFooter: string | null };
  patient: { patientCode: string; fullName: string; age: number | null; gender: string; phone: string | null };
  visit: {
    visitNumber: number;
    date: string;
    complaints: { text: string; duration: string | null }[];
    vitals: { label: string; value: string; unit: string | null }[];
    examinationNotes: string | null;
    diagnoses: { name: string; code: string | null; isPrimary: boolean; certainty: string }[];
    investigations: { name: string; instructions: string | null; priority: string }[];
    followUpDate: string | null;
    followUpInstructions: string | null;
  };
  settings: PrescriptionSettings;
}

/** Public verification result — deliberately contains no patient information (spec §14). */
export interface PrescriptionVerificationDto {
  valid: boolean;
  status: 'VALID' | 'SUPERSEDED' | 'CANCELLED';
  rxNumber: string | null;
  versionNumber: number;
  latestVersionNumber: number;
  issuedAt: string | null;
  supersededAt: string | null;
  doctor: { fullName: string; qualifications: string | null; registrationNo: string | null };
  chamber: { name: string };
  contentHash: string | null;
}

// ───────────── Billing (Phase 6) ─────────────

export interface InvoiceItemDto {
  id: string;
  type: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  feeItemId: string | null;
}

export interface PaymentDto {
  id: string;
  kind: 'PAYMENT' | 'REFUND';
  receiptNumber: string;
  amount: number;
  method: string;
  provider: string | null;
  reference: string | null;
  note: string | null;
  reason: string | null;
  receivedByName: string | null;
  receivedAt: string;
}

export interface InvoiceSummaryDto {
  id: string;
  invoiceNumber: string;
  status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
  patient: { id: string; patientCode: string; fullName: string; phone: string | null };
  doctor: { id: string; fullName: string } | null;
  appointmentId: string | null;
  total: number;
  paid: number;
  due: number;
  issuedAt: string;
  createdByName: string | null;
}

export interface InvoiceDto extends InvoiceSummaryDto {
  items: InvoiceItemDto[];
  subtotal: number;
  discountAmount: number;
  discountPercent: number | null;
  discountReason: string | null;
  refunded: number;
  notes: string | null;
  payments: PaymentDto[];
  voidedAt: string | null;
  voidReason: string | null;
  version: number;
}

/** Suggested bill for a visit (fees from the doctor and the chamber fee schedule). */
export interface InvoiceSuggestionDto {
  patient: { id: string; patientCode: string; fullName: string };
  doctor: { id: string; fullName: string } | null;
  appointmentId: string | null;
  visitType: string | null;
  existingInvoiceId: string | null;
  items: { type: string; description: string; quantity: number; unitPrice: number; feeItemId: string | null }[];
  /** Investigations ordered in the consultation that have a chamber fee (optional extras). */
  suggestedExtras: { type: string; description: string; quantity: number; unitPrice: number; feeItemId: string | null }[];
}

export interface FeeItemDto {
  id: string;
  kind: string;
  name: string;
  amount: number;
  investigationId: string | null;
  isActive: boolean;
}

export interface BillingSummaryDto {
  from: string;
  to: string;
  /** Net cash in: payments minus refunds received in the period. */
  collected: number;
  refunded: number;
  paymentsCount: number;
  billed: number;
  invoicesCount: number;
  discounts: number;
  byMethod: { method: string; amount: number; count: number }[];
  byDoctor: { doctorId: string | null; doctorName: string | null; billed: number; collected: number }[];
  byCollector: { userName: string | null; amount: number; count: number }[];
  /** Outstanding dues across all open invoices (not limited to the period). */
  outstanding: number;
  outstandingCount: number;
}

export interface InvoicePrintDto {
  invoice: InvoiceDto;
  chamber: { name: string; address: string | null; phone: string | null; email: string | null; timezone: string; logoDataUrl: string | null };
  settings: BillingSettings;
}

export interface AppointmentBillingDto {
  invoiceId: string;
  invoiceNumber: string;
  status: InvoiceSummaryDto['status'];
  due: number;
}

// ───────────── Reports & analytics (Phase 7) ─────────────

export interface LocalizedText {
  en: string;
  bn: string;
}

export type ReportValueType = 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime' | 'minutes';

export interface ReportColumnDto {
  key: string;
  label: LocalizedText;
  type: ReportValueType;
  /** Display labels for coded values (status, gender, method…). */
  options?: Record<string, LocalizedText>;
}

export interface ReportResultDto {
  key: string;
  group: 'operational' | 'clinical' | 'financial';
  title: LocalizedText;
  params: { from: string; to: string; doctorId: string | null; scope: 'doctor' | 'chamber' | 'platform'; chamberName: string | null };
  columns: ReportColumnDto[];
  rows: Record<string, string | number | null>[];
  summary: { label: LocalizedText; value: string | number | null; type: ReportValueType }[];
  chart: { type: 'column' | 'line' | 'hbar' | 'stacked'; x: string; series: { key: string; label: LocalizedText }[] } | null;
  /** The report reflects the current state and ignores the date range (e.g. outstanding dues). */
  ignoresRange: boolean;
  truncated: boolean;
  generatedAt: string;
}

export interface ReportCatalogEntryDto {
  key: string;
  group: 'operational' | 'clinical' | 'financial';
  title: LocalizedText;
  description: LocalizedText;
  canExport: boolean;
  /** Doctors see their own data only. */
  personal: boolean;
}

export interface DashboardAnalyticsDto {
  from: string;
  to: string;
  scope: 'doctor' | 'chamber' | 'platform';
  appointmentsPerDay: { date: string; total: number; completed: number }[] | null;
  patientsPerDay: { date: string; new: number; returning: number }[] | null;
  revenuePerDay: { date: string; collected: number; billed: number }[] | null;
  topDiagnoses: { name: string; count: number }[] | null;
  appointmentStatus: { status: string; count: number }[] | null;
  doctorWorkload: { doctorName: string; completed: number }[] | null;
}

export interface DoctorProfileDto {
  id: string;
  fullName: string;
  qualifications: string | null;
  specialty: string | null;
  registrationNo: string | null;
  bio: string | null;
  signatureDataUrl: string | null;
  prescriptionFooter: string | null;
  version: number;
  canEdit: boolean;
}
