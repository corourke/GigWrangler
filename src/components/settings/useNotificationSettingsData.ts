import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import {
  disablePushOnThisDevice, enablePushOnThisDevice, getHideDetails, getPreferences, listMyDevices,
  readDeviceFacts, removeDevice, setHideDetails, setPreference, type PushEventType, type PushPreferences,
} from '../../services/push.service';

/** Server and browser state for Settings → Notifications. */
export function useNotificationSettingsData(userId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.pushSettings(userId) });

  const thisDevice = useQuery({ queryKey: queryKeys.pushThisDevice(userId), queryFn: () => readDeviceFacts(), staleTime: 0, networkMode: 'always' });
  const devices = useQuery({ queryKey: queryKeys.pushDevices(userId), queryFn: () => listMyDevices(), staleTime: 0 });
  const preferences = useQuery({ queryKey: queryKeys.pushPreferences(userId), queryFn: () => getPreferences() });
  const hideDetails = useQuery({ queryKey: queryKeys.pushHideDetails(userId), queryFn: () => getHideDetails() });

  const turnOn = useMutation({ mutationFn: () => enablePushOnThisDevice(), onSettled: refresh, networkMode: 'always' });
  const turnOff = useMutation({ mutationFn: () => disablePushOnThisDevice(), onSettled: refresh });
  const remove = useMutation({ mutationFn: (id: string) => removeDevice(id), onSettled: refresh });

  const savePreference = useMutation({
    mutationFn: ({ type, enabled }: { type: PushEventType; enabled: boolean }) => setPreference(userId, type, enabled),
    // Show the switch where it was moved to at once; put it back if the save fails.
    onMutate: async ({ type, enabled }) => {
      const key = queryKeys.pushPreferences(userId);
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<PushPreferences>(key);
      if (before) queryClient.setQueryData<PushPreferences>(key, { ...before, [type]: enabled });
      return { before };
    },
    onError: (_e, _v, context) => {
      if (context?.before) queryClient.setQueryData(queryKeys.pushPreferences(userId), context.before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.pushPreferences(userId) }),
  });

  const saveHideDetails = useMutation({
    mutationFn: (hide: boolean) => setHideDetails(userId, hide),
    onMutate: async (hide) => {
      const key = queryKeys.pushHideDetails(userId);
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<boolean>(key);
      queryClient.setQueryData(key, hide);
      return { before };
    },
    onError: (_e, _v, context) => {
      queryClient.setQueryData(queryKeys.pushHideDetails(userId), context?.before ?? false);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.pushHideDetails(userId) }),
  });

  return { thisDevice, devices, preferences, hideDetails, turnOn, turnOff, remove, savePreference, saveHideDetails };
}
