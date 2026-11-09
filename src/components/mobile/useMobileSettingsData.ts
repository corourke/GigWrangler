import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { startRegistration } from '@simplewebauthn/browser';
import { queryKeys, mobileInvalidations } from '../../lib/queryKeys';
import {
  getDeviceRegistrationOptions,
  listMyDevices,
  removeMyDevice,
  verifyDeviceRegistration,
  type EnrolledDevice,
} from '../../services/mobile/devices.service';

/** Server state for MobileSettings (A10): enrolled devices, enrolling this one, removing one. */
export function useMobileSettingsData() {
  const queryClient = useQueryClient();
  const refreshDevices = () =>
    Promise.all(mobileInvalidations.devicesChanged().map((f) => queryClient.invalidateQueries(f)));

  const devicesQuery = useQuery({
    queryKey: queryKeys.myDevices(),
    queryFn: async () => {
      try {
        return await listMyDevices();
      } catch (error) {
        console.error('Error fetching devices:', error);
        throw error;
      }
    },
    staleTime: 0,
    networkMode: 'always',
  });

  const enrollDevice = useMutation({
    mutationFn: async () => {
      const options = await getDeviceRegistrationOptions();
      const regResponse = await startRegistration({ optionsJSON: options });
      const deviceName = `${navigator.platform} (${new Date().toLocaleDateString()})`;
      return verifyDeviceRegistration(regResponse, deviceName);
    },
    networkMode: 'always',
    onSuccess: () => {
      refreshDevices();
    },
  });

  const removeDevice = useMutation({
    mutationFn: (id: string) => removeMyDevice(id),
    networkMode: 'always',
    onSuccess: (_r, id) => {
      queryClient.setQueryData<EnrolledDevice[]>(queryKeys.myDevices(), (prev) => prev?.filter((d) => d.id !== id));
      refreshDevices();
    },
  });

  return { devicesQuery, enrollDevice, removeDevice };
}
