import { ROLES, RoleKey } from './roles';

/**
 * Permission catalogue. Keys follow `<resource>.<action>`.
 * The backend is the single source of truth: every protected endpoint
 * declares the permission it requires and the server re-checks it on every request.
 */
export const PERMISSIONS = {
  // Users & access
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',
  ROLES_VIEW: 'roles.view',
  ROLES_MANAGE: 'roles.manage',

  // Tenancy
  ORGANIZATIONS_VIEW: 'organizations.view',
  ORGANIZATIONS_MANAGE: 'organizations.manage',
  CHAMBERS_VIEW: 'chambers.view',
  CHAMBERS_CREATE: 'chambers.create',
  CHAMBERS_UPDATE: 'chambers.update',
  CHAMBERS_DELETE: 'chambers.delete',

  // Patients
  PATIENTS_VIEW: 'patients.view',
  PATIENTS_CREATE: 'patients.create',
  PATIENTS_UPDATE: 'patients.update',
  PATIENTS_UPDATE_MEDICAL: 'patients.update_medical',
  PATIENTS_DELETE: 'patients.delete',

  // Appointments & queue
  APPOINTMENTS_VIEW: 'appointments.view',
  APPOINTMENTS_CREATE: 'appointments.create',
  APPOINTMENTS_UPDATE: 'appointments.update',
  APPOINTMENTS_CANCEL: 'appointments.cancel',
  QUEUE_VIEW: 'queue.view',
  QUEUE_MANAGE: 'queue.manage',

  // Clinical
  CONSULTATIONS_VIEW: 'consultations.view',
  CONSULTATIONS_CREATE: 'consultations.create',
  CONSULTATIONS_UPDATE: 'consultations.update',
  CONSULTATIONS_FINALIZE: 'consultations.finalize',
  CLINICAL_NOTES_VIEW: 'clinical_notes.view',
  PRESCRIPTIONS_VIEW: 'prescriptions.view',
  PRESCRIPTIONS_CREATE: 'prescriptions.create',
  PRESCRIPTIONS_UPDATE: 'prescriptions.update',
  PRESCRIPTIONS_FINALIZE: 'prescriptions.finalize',
  PRESCRIPTIONS_PRINT: 'prescriptions.print',
  PRESCRIPTIONS_REVISE: 'prescriptions.revise',
  TEMPLATES_MANAGE: 'templates.manage',

  // Master data
  MEDICINES_VIEW: 'medicines.view',
  MEDICINES_CREATE: 'medicines.create',
  MEDICINES_UPDATE: 'medicines.update',
  MEDICINES_DELETE: 'medicines.delete',
  MEDICINES_MANAGE_GLOBAL: 'medicines.manage_global',
  DIAGNOSIS_VIEW: 'diagnosis.view',
  DIAGNOSIS_MANAGE: 'diagnosis.manage',
  INVESTIGATIONS_VIEW: 'investigations.view',
  INVESTIGATIONS_MANAGE: 'investigations.manage',

  // Billing
  BILLING_VIEW: 'billing.view',
  BILLING_CREATE: 'billing.create',
  BILLING_UPDATE: 'billing.update',
  BILLING_REFUND: 'billing.refund',

  // Reports
  REPORTS_VIEW: 'reports.view',
  REPORTS_FINANCIAL: 'reports.financial',
  REPORTS_CLINICAL: 'reports.clinical',
  REPORTS_EXPORT: 'reports.export',

  // Settings & audit
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',
  SYSTEM_MANAGE: 'system.manage',
  AUDIT_LOGS_VIEW: 'audit_logs.view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

/** Permission groups used to render the permission matrix UI. */
export const PERMISSION_GROUPS: { key: string; permissions: Permission[] }[] = [
  {
    key: 'users',
    permissions: [
      PERMISSIONS.USERS_VIEW,
      PERMISSIONS.USERS_CREATE,
      PERMISSIONS.USERS_UPDATE,
      PERMISSIONS.USERS_DELETE,
      PERMISSIONS.ROLES_VIEW,
      PERMISSIONS.ROLES_MANAGE,
    ],
  },
  {
    key: 'tenancy',
    permissions: [
      PERMISSIONS.ORGANIZATIONS_VIEW,
      PERMISSIONS.ORGANIZATIONS_MANAGE,
      PERMISSIONS.CHAMBERS_VIEW,
      PERMISSIONS.CHAMBERS_CREATE,
      PERMISSIONS.CHAMBERS_UPDATE,
      PERMISSIONS.CHAMBERS_DELETE,
    ],
  },
  {
    key: 'patients',
    permissions: [
      PERMISSIONS.PATIENTS_VIEW,
      PERMISSIONS.PATIENTS_CREATE,
      PERMISSIONS.PATIENTS_UPDATE,
      PERMISSIONS.PATIENTS_UPDATE_MEDICAL,
      PERMISSIONS.PATIENTS_DELETE,
    ],
  },
  {
    key: 'appointments',
    permissions: [
      PERMISSIONS.APPOINTMENTS_VIEW,
      PERMISSIONS.APPOINTMENTS_CREATE,
      PERMISSIONS.APPOINTMENTS_UPDATE,
      PERMISSIONS.APPOINTMENTS_CANCEL,
      PERMISSIONS.QUEUE_VIEW,
      PERMISSIONS.QUEUE_MANAGE,
    ],
  },
  {
    key: 'clinical',
    permissions: [
      PERMISSIONS.CONSULTATIONS_VIEW,
      PERMISSIONS.CONSULTATIONS_CREATE,
      PERMISSIONS.CONSULTATIONS_UPDATE,
      PERMISSIONS.CONSULTATIONS_FINALIZE,
      PERMISSIONS.CLINICAL_NOTES_VIEW,
      PERMISSIONS.PRESCRIPTIONS_VIEW,
      PERMISSIONS.PRESCRIPTIONS_CREATE,
      PERMISSIONS.PRESCRIPTIONS_UPDATE,
      PERMISSIONS.PRESCRIPTIONS_FINALIZE,
      PERMISSIONS.PRESCRIPTIONS_PRINT,
      PERMISSIONS.PRESCRIPTIONS_REVISE,
      PERMISSIONS.TEMPLATES_MANAGE,
    ],
  },
  {
    key: 'master_data',
    permissions: [
      PERMISSIONS.MEDICINES_VIEW,
      PERMISSIONS.MEDICINES_CREATE,
      PERMISSIONS.MEDICINES_UPDATE,
      PERMISSIONS.MEDICINES_DELETE,
      PERMISSIONS.MEDICINES_MANAGE_GLOBAL,
      PERMISSIONS.DIAGNOSIS_VIEW,
      PERMISSIONS.DIAGNOSIS_MANAGE,
      PERMISSIONS.INVESTIGATIONS_VIEW,
      PERMISSIONS.INVESTIGATIONS_MANAGE,
    ],
  },
  {
    key: 'billing',
    permissions: [
      PERMISSIONS.BILLING_VIEW,
      PERMISSIONS.BILLING_CREATE,
      PERMISSIONS.BILLING_UPDATE,
      PERMISSIONS.BILLING_REFUND,
    ],
  },
  {
    key: 'reports',
    permissions: [
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.REPORTS_FINANCIAL,
      PERMISSIONS.REPORTS_CLINICAL,
      PERMISSIONS.REPORTS_EXPORT,
    ],
  },
  {
    key: 'administration',
    permissions: [
      PERMISSIONS.SETTINGS_VIEW,
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.SYSTEM_MANAGE,
      PERMISSIONS.AUDIT_LOGS_VIEW,
    ],
  },
];

const P = PERMISSIONS;

/**
 * Default permission matrix (spec §2, §50). Super admin may re-configure
 * role permissions at runtime, except for the grants in FORBIDDEN_GRANTS.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  [ROLES.SUPER_ADMIN]: [...ALL_PERMISSIONS],

  [ROLES.MANAGER]: [
    P.USERS_VIEW,
    P.USERS_CREATE,
    P.USERS_UPDATE,
    P.USERS_DELETE,
    P.ROLES_VIEW,
    P.CHAMBERS_VIEW,
    P.CHAMBERS_UPDATE,
    P.PATIENTS_VIEW,
    P.PATIENTS_CREATE,
    P.PATIENTS_UPDATE,
    P.PATIENTS_DELETE,
    P.APPOINTMENTS_VIEW,
    P.APPOINTMENTS_CREATE,
    P.APPOINTMENTS_UPDATE,
    P.APPOINTMENTS_CANCEL,
    P.QUEUE_VIEW,
    P.QUEUE_MANAGE,
    P.CONSULTATIONS_VIEW,
    P.PRESCRIPTIONS_VIEW,
    P.PRESCRIPTIONS_PRINT,
    P.TEMPLATES_MANAGE,
    P.MEDICINES_VIEW,
    P.MEDICINES_CREATE,
    P.MEDICINES_UPDATE,
    P.MEDICINES_DELETE,
    P.DIAGNOSIS_VIEW,
    P.DIAGNOSIS_MANAGE,
    P.INVESTIGATIONS_VIEW,
    P.INVESTIGATIONS_MANAGE,
    P.BILLING_VIEW,
    P.BILLING_CREATE,
    P.BILLING_UPDATE,
    P.BILLING_REFUND,
    P.REPORTS_VIEW,
    P.REPORTS_FINANCIAL,
    P.REPORTS_CLINICAL,
    P.REPORTS_EXPORT,
    P.SETTINGS_VIEW,
    P.SETTINGS_MANAGE,
    P.AUDIT_LOGS_VIEW,
  ],

  [ROLES.DOCTOR]: [
    P.CHAMBERS_VIEW,
    P.PATIENTS_VIEW,
    P.PATIENTS_CREATE,
    P.PATIENTS_UPDATE,
    P.PATIENTS_UPDATE_MEDICAL,
    P.APPOINTMENTS_VIEW,
    P.APPOINTMENTS_CREATE,
    P.APPOINTMENTS_UPDATE,
    P.APPOINTMENTS_CANCEL,
    P.QUEUE_VIEW,
    P.QUEUE_MANAGE,
    P.CONSULTATIONS_VIEW,
    P.CONSULTATIONS_CREATE,
    P.CONSULTATIONS_UPDATE,
    P.CONSULTATIONS_FINALIZE,
    P.CLINICAL_NOTES_VIEW,
    P.PRESCRIPTIONS_VIEW,
    P.PRESCRIPTIONS_CREATE,
    P.PRESCRIPTIONS_UPDATE,
    P.PRESCRIPTIONS_FINALIZE,
    P.PRESCRIPTIONS_PRINT,
    P.PRESCRIPTIONS_REVISE,
    P.TEMPLATES_MANAGE,
    P.MEDICINES_VIEW,
    P.MEDICINES_CREATE,
    P.MEDICINES_UPDATE,
    P.DIAGNOSIS_VIEW,
    P.INVESTIGATIONS_VIEW,
    P.BILLING_VIEW,
    P.REPORTS_VIEW,
    P.REPORTS_CLINICAL,
    P.SETTINGS_VIEW,
    P.AUDIT_LOGS_VIEW,
  ],

  [ROLES.ASSISTANT]: [
    P.CHAMBERS_VIEW,
    P.PATIENTS_VIEW,
    P.PATIENTS_CREATE,
    P.PATIENTS_UPDATE,
    P.APPOINTMENTS_VIEW,
    P.APPOINTMENTS_CREATE,
    P.APPOINTMENTS_UPDATE,
    P.APPOINTMENTS_CANCEL,
    P.QUEUE_VIEW,
    P.QUEUE_MANAGE,
    P.PRESCRIPTIONS_VIEW,
    P.PRESCRIPTIONS_PRINT,
    P.MEDICINES_VIEW,
    P.DIAGNOSIS_VIEW,
    P.INVESTIGATIONS_VIEW,
    P.BILLING_VIEW,
    P.BILLING_CREATE,
    P.REPORTS_VIEW,
  ],
};

/**
 * Grants that can never be given to a role, even by a super admin
 * reconfiguring the matrix (spec §2 "Assistant must NOT ...", "Doctor should
 * not have access to system administration functions").
 */
export const FORBIDDEN_GRANTS: Record<RoleKey, Permission[]> = {
  [ROLES.SUPER_ADMIN]: [],
  [ROLES.MANAGER]: [P.SYSTEM_MANAGE, P.ORGANIZATIONS_MANAGE, P.ROLES_MANAGE, P.MEDICINES_MANAGE_GLOBAL],
  [ROLES.DOCTOR]: [
    P.SYSTEM_MANAGE,
    P.ORGANIZATIONS_MANAGE,
    P.ROLES_MANAGE,
    P.USERS_CREATE,
    P.USERS_UPDATE,
    P.USERS_DELETE,
    P.SETTINGS_MANAGE,
    P.CHAMBERS_CREATE,
    P.CHAMBERS_DELETE,
    P.MEDICINES_MANAGE_GLOBAL,
  ],
  [ROLES.ASSISTANT]: [
    P.SYSTEM_MANAGE,
    P.ORGANIZATIONS_MANAGE,
    P.ROLES_MANAGE,
    P.USERS_CREATE,
    P.USERS_UPDATE,
    P.USERS_DELETE,
    P.SETTINGS_MANAGE,
    P.CHAMBERS_CREATE,
    P.CHAMBERS_UPDATE,
    P.CHAMBERS_DELETE,
    P.PATIENTS_UPDATE_MEDICAL,
    P.CONSULTATIONS_CREATE,
    P.CONSULTATIONS_UPDATE,
    P.CONSULTATIONS_FINALIZE,
    P.CLINICAL_NOTES_VIEW,
    P.PRESCRIPTIONS_CREATE,
    P.PRESCRIPTIONS_UPDATE,
    P.PRESCRIPTIONS_FINALIZE,
    P.PRESCRIPTIONS_REVISE,
    P.MEDICINES_MANAGE_GLOBAL,
    P.REPORTS_FINANCIAL,
    P.REPORTS_CLINICAL,
  ],
};

export function isGrantAllowed(role: RoleKey, permission: Permission): boolean {
  return !FORBIDDEN_GRANTS[role].includes(permission);
}

export function hasPermission(granted: Iterable<string>, required: Permission): boolean {
  for (const p of granted) if (p === required) return true;
  return false;
}
