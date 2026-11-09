import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { getMyNotifications, markNotificationRead } from '../services/notification.service';
import type { Notification } from '../utils/supabase/types';

/**
 * Unread notifications for the caller — the notification bell's source of
 * truth (issue #52). Same poll/refocus cadence as the access-request lists
 * this replaces: the bell has to reflect an event from another session or
 * browser tab, and the app's default query options don't refetch on their own.
 */
export function useNotifications(userId: string | undefined) {
  return useQuery<Notification[]>({
    queryKey: queryKeys.notifications(userId ?? ''),
    queryFn: () => getMyNotifications(),
    enabled: !!userId,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}

/** Dismiss a notification from the bell. */
export function useMarkNotificationRead(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(userId ?? '') });
    },
  });
}
