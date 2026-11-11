import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { OfflineBadge } from './OfflineBadge';
import { useIsOffline } from './useIsOffline';
import { useDayOfShowSheet } from './useDayOfShowData';
import DaySheet from './DaySheet';

interface MobileDaySheetProps {
  gigId: string;
  onBack: () => void;
  onViewGigDetail: (gigId: string) => void;
}

/** Any gig's day sheet, past or future (/gigs/:id/day-sheet, #445). */
export default function MobileDaySheet({ gigId, onBack, onViewGigDetail }: MobileDaySheetProps) {
  const isOffline = useIsOffline();
  const sheetQuery = useDayOfShowSheet(gigId);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-40 bg-background/90 backdrop-blur-md px-2 py-3 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button aria-label="Back" variant="ghost" size="icon" onClick={onBack} className="h-9 w-9">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold">Day sheet</h1>
        </div>
        <div className="flex items-center gap-2 pr-2">
          {isOffline && <OfflineBadge />}
          <Button
            aria-label="Refresh"
            variant="ghost"
            size="icon"
            onClick={() => void sheetQuery.refetch()}
            disabled={sheetQuery.isFetching || isOffline}
            className="h-9 w-9"
          >
            <RefreshCw className={`w-5 h-5 ${sheetQuery.isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-3 pb-12">
        {sheetQuery.isPending ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : sheetQuery.data ? (
          <DaySheet sheet={sheetQuery.data} isOffline={isOffline} onViewGigDetail={onViewGigDetail} />
        ) : sheetQuery.error ? (
          <Card className="p-4 text-center bg-red-50 border-red-200">
            <p className="text-red-600 text-sm font-medium">Couldn't load this gig's sheet</p>
          </Card>
        ) : (
          <Card className="p-6 text-center bg-muted/30 border-dashed">
            <p className="text-sm text-muted-foreground">This gig's sheet isn't saved on this phone. Connect to load it.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
