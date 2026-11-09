import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, orgSettingsInvalidations } from '../../lib/queryKeys';
import {
  confirmTwoFactorSetup,
  getTwoFactorStatus,
  removeTwoFactor,
  startTwoFactorSetup,
} from '../../services/twoFactor.service';

/**
 * Server state for TwoFactorSettings (A10). Confirm and remove resolve only once the status has
 * been reloaded, as the screen awaited its reload before.
 */
export function useTwoFactorSettingsData() {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all(orgSettingsInvalidations.twoFactorChanged().map((f) => queryClient.invalidateQueries(f)));

  const statusQuery = useQuery({
    queryKey: queryKeys.twoFactorStatus(),
    queryFn: async () => {
      try {
        return await getTwoFactorStatus();
      } catch (err) {
        console.error('Error loading two-factor status:', err);
        throw err;
      }
    },
    staleTime: 0,
  });

  const startSetup = useMutation({ mutationFn: () => startTwoFactorSetup() });

  const confirmSetup = useMutation({
    mutationFn: ({ factorId, code }: { factorId: string; code: string }) => confirmTwoFactorSetup(factorId, code),
    onSuccess: refresh,
  });

  const removeFactor = useMutation({
    mutationFn: (factorId: string) => removeTwoFactor(factorId),
    onSuccess: refresh,
  });

  return { statusQuery, startSetup, confirmSetup, removeFactor };
}
