import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS, zonedDate } from '@chamber/shared';
import { useAuth } from '@/stores/auth';
import { doctorsApi } from '@/services/endpoints';

/** Timezone of the active chamber (appointments are shown in chamber-local time). */
export function useChamberTz(): string {
  const { user } = useAuth();
  return user?.activeMembership.chamber?.timezone ?? 'Asia/Dhaka';
}

export function useToday(): string {
  return zonedDate(new Date(), useChamberTz());
}

/** Doctors of the active chamber, cached (spec §43: cache doctor schedule). */
export function useDoctors() {
  const { can } = useAuth();
  return useQuery({ queryKey: ['doctors'], queryFn: doctorsApi.list, staleTime: 5 * 60_000, enabled: can(PERMISSIONS.APPOINTMENTS_VIEW) });
}
