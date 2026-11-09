import { WifiOff } from 'lucide-react';
import { Badge } from '../ui/badge';

/** The amber "Offline" badge in a mobile screen's header (My Schedule, Gigs, a gig, Inventory Mode). */
export function OfflineBadge() {
  return (
    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-200">
      <WifiOff className="w-3 h-3" />
      <span className="text-[10px]">Offline</span>
    </Badge>
  );
}
