import { useEffect, useState } from 'react';
import { FileText, Package, Music, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../../ui/sheet';
import { Button } from '../../ui/button';
import DocumentDetailView from './DocumentDetailView';
import AssetDetailView from './AssetDetailView';
import GigDetailView from './GigDetailView';

export type PanelState =
  | { mode: 'closed' }
  | { mode: 'document'; headerId: string }
  | { mode: 'asset'; assetId: string; itemId: string; siblingItemIds: string[] }
  | { mode: 'gig'; gigId: string; gigFinancialPurchaseId?: string; itemId?: string; siblingItemIds?: string[] };

interface PurchaseDetailPanelProps {
  panelState: PanelState;
  onPanelChange: (state: PanelState) => void;
  organizationId: string;
  onViewAsset?: (assetId: string) => void;
  onEditAsset?: (assetId: string) => void;
  onNavigateToGigDetail?: (gigId: string) => void;
  getAssetIdForItem?: (itemId: string) => string | null;
  getGigIdForItem?: (itemId: string) => string | null;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

export default function PurchaseDetailPanel({
  panelState,
  onPanelChange,
  organizationId,
  onViewAsset,
  onEditAsset,
  onNavigateToGigDetail,
  getAssetIdForItem,
  getGigIdForItem,
}: PurchaseDetailPanelProps) {
  const isMobile = useIsMobile();
  const isOpen = panelState.mode !== 'closed';

  const handleStep = (direction: 'prev' | 'next') => {
    if (panelState.mode !== 'asset' && panelState.mode !== 'gig') return;
    const siblingIds = panelState.mode === 'asset' ? panelState.siblingItemIds : panelState.siblingItemIds;
    const currentItemId = panelState.mode === 'asset' ? panelState.itemId : panelState.itemId;
    if (!siblingIds || !currentItemId) return;

    const currentIdx = siblingIds.indexOf(currentItemId);
    if (currentIdx === -1) return;
    const nextIdx = direction === 'prev' ? currentIdx - 1 : currentIdx + 1;
    if (nextIdx < 0 || nextIdx >= siblingIds.length) return;

    const nextItemId = siblingIds[nextIdx];

    if (panelState.mode === 'asset') {
      const nextAssetId = getAssetIdForItem?.(nextItemId);
      if (nextAssetId) {
        onPanelChange({ mode: 'asset', assetId: nextAssetId, itemId: nextItemId, siblingItemIds: siblingIds });
      } else {
        const nextGigId = getGigIdForItem?.(nextItemId);
        if (nextGigId) {
          onPanelChange({ mode: 'gig', gigId: nextGigId, itemId: nextItemId, siblingItemIds: siblingIds });
        }
      }
    } else if (panelState.mode === 'gig') {
      const nextGigId = getGigIdForItem?.(nextItemId);
      if (nextGigId) {
        onPanelChange({ mode: 'gig', gigId: nextGigId, itemId: nextItemId, siblingItemIds: siblingIds });
      } else {
        const nextAssetId = getAssetIdForItem?.(nextItemId);
        if (nextAssetId) {
          onPanelChange({ mode: 'asset', assetId: nextAssetId, itemId: nextItemId, siblingItemIds: siblingIds });
        }
      }
    }
  };

  const currentIndex = (() => {
    if (panelState.mode === 'asset') return panelState.siblingItemIds.indexOf(panelState.itemId);
    if (panelState.mode === 'gig' && panelState.siblingItemIds && panelState.itemId) return panelState.siblingItemIds.indexOf(panelState.itemId);
    return -1;
  })();

  const totalSiblings = (() => {
    if (panelState.mode === 'asset') return panelState.siblingItemIds.length;
    if (panelState.mode === 'gig' && panelState.siblingItemIds) return panelState.siblingItemIds.length;
    return 0;
  })();

  const modeLabel = panelState.mode === 'document' ? 'Document' : panelState.mode === 'asset' ? 'Asset Details' : panelState.mode === 'gig' ? 'Gig Details' : '';

  const modeIcon = panelState.mode === 'document'
    ? <FileText className="w-4 h-4" />
    : panelState.mode === 'asset'
    ? <Package className="w-4 h-4" />
    : <Music className="w-4 h-4" />;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onPanelChange({ mode: 'closed' }); }}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={
          isMobile
            ? 'h-[85vh]'
            : panelState.mode === 'document'
            ? 'w-[760px] max-w-[92vw] sm:max-w-[760px]'
            : 'w-[420px] sm:max-w-[420px]'
        }
      >
        <SheetHeader className="pb-2 border-b border-gray-200">
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2">
              {modeIcon}
              <SheetTitle className="text-sm">{modeLabel}</SheetTitle>
            </div>
            {totalSiblings > 1 && currentIndex >= 0 && (
              <div className="flex items-center gap-1">
                <Button aria-label="Previous item"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={currentIndex === 0}
                  onClick={() => handleStep('prev')}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs text-gray-500">
                  Item {currentIndex + 1} of {totalSiblings}
                </span>
                <Button aria-label="Next item"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={currentIndex === totalSiblings - 1}
                  onClick={() => handleStep('next')}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {panelState.mode === 'document' && (
            <DocumentDetailView headerId={panelState.headerId} />
          )}

          {panelState.mode === 'asset' && (
            <AssetDetailView
              assetId={panelState.assetId}
              onViewAsset={onViewAsset}
              onEditAsset={onEditAsset}
            />
          )}

          {panelState.mode === 'gig' && (
            <GigDetailView
              gigId={panelState.gigId}
              organizationId={organizationId}
              onNavigateToGigDetail={onNavigateToGigDetail}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
