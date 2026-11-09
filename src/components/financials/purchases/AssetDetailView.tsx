import { Loader2, ExternalLink, Pencil } from 'lucide-react';
import { Button } from '../../ui/button';
import { DetailLine } from './DetailLine';
import { usePanelAsset } from './usePanelData';

interface AssetDetailViewProps {
  assetId: string;
  onViewAsset?: (assetId: string) => void;
  onEditAsset?: (assetId: string) => void;
}

export default function AssetDetailView({ assetId, onViewAsset, onEditAsset }: AssetDetailViewProps) {
  const { asset, isLoading, error } = usePanelAsset(assetId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading asset details...</span>
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-red-500 py-4 text-center">{error}</div>;
  }

  if (!asset) return null;

  return (
    <div className="space-y-3">
      <DetailLine label="Name / Model" value={asset.manufacturer_model || asset.description || '—'} />
      <DetailLine label="Category" value={asset.category || '—'} />
      {asset.type && <DetailLine label="Type" value={asset.type} />}
      <DetailLine label="Serial Number" value={asset.serial_number || '—'} />
      <DetailLine label="Tag Number" value={asset.tag_number || '—'} />
      <DetailLine label="Condition" value={asset.condition || asset.status || '—'} />
      <DetailLine label="Acquisition Date" value={asset.acquisition_date || '—'} />
      {asset.vendor && <DetailLine label="Vendor" value={asset.vendor} />}
      <DetailLine label="Status" value={asset.status || '—'} />

      {(onViewAsset || onEditAsset) && (
        <div className="pt-3 border-t border-gray-200 flex gap-2">
          {onEditAsset && (
            <Button
              variant="default"
              size="sm"
              className="flex-1"
              onClick={() => onEditAsset(assetId)}
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Edit Asset
            </Button>
          )}
          {onViewAsset && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onViewAsset(assetId)}
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Open Asset
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
