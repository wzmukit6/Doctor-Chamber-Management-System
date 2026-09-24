import type {
  AdminResetPasswordInput,
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
} from '@chamber/shared';
import { api } from './api';

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

export const auditApi = {
  list: (params: ListParams) => api.page<AuditLogDto>('/audit-logs', params),
  verify: () => api.get<{ valid: boolean; checked: number; brokenAtSeq: string | null }>('/audit-logs/verify'),
};
