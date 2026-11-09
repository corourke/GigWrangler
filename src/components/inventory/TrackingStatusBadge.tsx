import React from 'react';
import { Badge } from '../ui/badge';
import { cn } from '../ui/utils';
import { TRACKING_STATUS_CONFIG } from '../../utils/supabase/constants';
import { NOT_RETURNED_STATUS } from '../../config/inventoryWorkflow';

// A partial return (#185) is written by the unload prompt, never picked as a status by hand,
// so it has a badge but isn't in TRACKING_STATUS_CONFIG's pickable list.
const BADGE_ONLY = {
  [NOT_RETURNED_STATUS]: { label: NOT_RETURNED_STATUS, color: 'border-red-200 bg-red-50 text-red-700' },
} as Record<string, { label: string; color: string }>;

interface TrackingStatusBadgeProps {
  status?: string | null;
}

export function TrackingStatusBadge({ status }: TrackingStatusBadgeProps) {
  const config = TRACKING_STATUS_CONFIG[status as keyof typeof TRACKING_STATUS_CONFIG] ?? (status ? BADGE_ONLY[status] : undefined);
  const colorClasses = config?.color ?? 'border-border bg-muted/40 text-muted-foreground';

  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] py-0 h-4 px-1.5 font-normal border', colorClasses)}
    >
      {config?.label ?? status ?? 'Not tracked'}
    </Badge>
  );
}
