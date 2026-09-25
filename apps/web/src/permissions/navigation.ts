import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  CalendarDays,
  CreditCard,
  FileText,
  FlaskConical,
  LayoutDashboard,
  ListOrdered,
  Network,
  Pill,
  ScrollText,
  Settings,
  ShieldCheck,
  Stethoscope,
  BarChart3,
  Users,
  UserRound,
} from 'lucide-react';
import { PERMISSIONS, type Permission } from '@chamber/shared';

export interface NavItem {
  key: string;
  to: string;
  icon: LucideIcon;
  /** Any of these permissions makes the item visible. Empty = everyone. */
  permissions: Permission[];
  /** Modules not yet delivered are shown disabled with a "Soon" badge. */
  available: boolean;
}

export interface NavSection {
  key: string | null;
  items: NavItem[];
}

const P = PERMISSIONS;

/** Primary navigation (spec §28), filtered by permission at render time. */
export const NAV_SECTIONS: NavSection[] = [
  {
    key: null,
    items: [{ key: 'dashboard', to: '/', icon: LayoutDashboard, permissions: [], available: true }],
  },
  {
    key: 'section_front_desk',
    items: [
      { key: 'patients', to: '/patients', icon: UserRound, permissions: [P.PATIENTS_VIEW], available: true },
      { key: 'appointments', to: '/appointments', icon: CalendarDays, permissions: [P.APPOINTMENTS_VIEW], available: true },
      { key: 'queue', to: '/queue', icon: ListOrdered, permissions: [P.QUEUE_VIEW], available: true },
    ],
  },
  {
    key: 'section_clinical',
    items: [
      { key: 'consultations', to: '/consultations', icon: Stethoscope, permissions: [P.CONSULTATIONS_VIEW], available: false },
      { key: 'prescriptions', to: '/prescriptions', icon: FileText, permissions: [P.PRESCRIPTIONS_VIEW], available: false },
    ],
  },
  {
    key: 'section_catalogue',
    items: [
      { key: 'medicines', to: '/medicines', icon: Pill, permissions: [P.MEDICINES_VIEW], available: false },
      { key: 'investigations', to: '/investigations', icon: FlaskConical, permissions: [P.INVESTIGATIONS_VIEW], available: false },
      { key: 'billing', to: '/billing', icon: CreditCard, permissions: [P.BILLING_VIEW], available: false },
      { key: 'reports', to: '/reports', icon: BarChart3, permissions: [P.REPORTS_VIEW], available: false },
    ],
  },
  {
    key: 'section_admin',
    items: [
      { key: 'users', to: '/users', icon: Users, permissions: [P.USERS_VIEW], available: true },
      { key: 'roles', to: '/roles', icon: ShieldCheck, permissions: [P.ROLES_VIEW], available: true },
      { key: 'organizations', to: '/organizations', icon: Network, permissions: [P.ORGANIZATIONS_VIEW], available: true },
      { key: 'chambers', to: '/chambers', icon: Building2, permissions: [P.CHAMBERS_VIEW], available: true },
      { key: 'settings', to: '/settings', icon: Settings, permissions: [P.SETTINGS_VIEW], available: true },
      { key: 'audit_logs', to: '/audit-logs', icon: ScrollText, permissions: [P.AUDIT_LOGS_VIEW], available: true },
    ],
  },
];

export function visibleSections(canAny: (p: Permission[]) => boolean): NavSection[] {
  return NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => i.permissions.length === 0 || canAny(i.permissions)),
  })).filter((s) => s.items.length > 0);
}

