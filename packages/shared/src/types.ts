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
