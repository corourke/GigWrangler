import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Edit2, Trash2, Copy, Loader2, History, CreditCard, ExternalLink, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import AttachmentManager from './AttachmentManager';
import { Organization, User, UserRole } from '../utils/supabase/types';
import { canManage } from '../utils/permissions';
import { getAsset, deleteAsset, duplicateAsset, getAssetHistory, getAssetInventoryTracking } from '../services/asset.service';
import type { DbInventoryTracking, ActivityLogEntry } from '../utils/supabase/types';
import ActivityFeed from './ActivityFeed';
import { ASSET_STATUS_CONFIG } from '../utils/supabase/constants';
import { KindPill } from './equipment/ItemsTable';
import { recordKind } from '../utils/equipmentItems';
import { undoWriteOff } from '../services/writeOff.service';
import { getLockedTaxYears } from '../services/taxYear.service';
import { WRITE_OFF_LOCKED_MESSAGE } from '../utils/writeOffMessages';
import { formatDateOnly } from '../utils/dateOnly';
import { useLatestRequest } from '../utils/hooks/useLatestRequest';

interface AssetDetailScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  assetId: string;
  onBack: () => void;
  /** Back to the item this unit or lot belongs to (#182). */
  onBackToItem?: (itemId: string) => void;
  onEdit: (assetId: string) => void;
  onSwitchOrganization: () => void;
  onEditProfile?: () => void;
  onLogout: () => void;
  onNavigateToPurchases?: (purchaseId?: string) => void;
}

export default function AssetDetailScreen({
  organization,
  user,
  userRole,
  assetId,
  onBack,
  onBackToItem,
  onEdit,
  onSwitchOrganization,
  onEditProfile,
  onLogout,
  onNavigateToPurchases,
}: AssetDetailScreenProps) {
  const [asset, setAsset] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assetActivity, setAssetActivity] = useState<ActivityLogEntry[]>([]);
  const [inventoryTracking, setInventoryTracking] = useState<DbInventoryTracking[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  // A Missing record (#242): Undo right here, unless its tax year is filed.
  const [lockedYears, setLockedYears] = useState<Set<number>>(new Set());
  const [undoing, setUndoing] = useState(false);
  const isMissing = asset?.status === 'Missing' && canManage(userRole);
  const writeOffYear = asset?.retired_on ? Number(String(asset.retired_on).slice(0, 4)) : null;
  const undoLocked = writeOffYear != null && lockedYears.has(writeOffYear);

  useEffect(() => {
    if (!isMissing) return;
    let live = true;
    getLockedTaxYears(organization.id).then((y) => { if (live) setLockedYears(y); }).catch(() => {});
    return () => { live = false; };
  }, [isMissing, organization.id]);

  const handleUndoWriteOff = async () => {
    setUndoing(true);
    try {
      const back = await undoWriteOff(assetId);
      toast.success('Write-off undone');
      // Pieces split off a lot go back into it: this record is gone, so go to the item.
      if (back && back !== assetId && asset?.equipment_item_id && onBackToItem) onBackToItem(asset.equipment_item_id);
      else await loadAsset();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Could not undo the write-off');
    } finally {
      setUndoing(false);
    }
  };

  useEffect(() => {
    loadAsset();
  }, [assetId]);

  // A late answer for an earlier record is dropped (B12).
  const startAssetRequest = useLatestRequest();
  const loadAsset = async () => {
    const isCurrent = startAssetRequest();
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await getAsset(assetId);
      if (!isCurrent()) return;
      setAsset(data);

      // Load history tables concurrently
      setIsLoadingHistory(true);
      try {
        const [history, tracking] = await Promise.all([
          getAssetHistory(assetId),
          getAssetInventoryTracking(assetId),
        ]);
        if (!isCurrent()) return;
        setAssetActivity(history);
        setInventoryTracking(tracking);
      } catch (err) {
        if (isCurrent()) console.error('Error loading asset history:', err);
      } finally {
        if (isCurrent()) setIsLoadingHistory(false);
      }
    } catch (error: any) {
      if (!isCurrent()) return;
      console.error('Error loading asset:', error);
      setLoadError(error.message || 'Failed to load this asset.');
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  };

  const handleDuplicate = async () => {
    try {
      const _newAsset = await duplicateAsset(assetId);
      toast.success('Asset duplicated successfully');
      onBack(); // Go back to list, where the new asset will appear
    } catch (error: any) {
      console.error('Error duplicating asset:', error);
      toast.error(error.message || 'Failed to duplicate asset');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${asset?.manufacturer_model}"?`)) return;

    try {
      await deleteAsset(assetId);
      toast.success('Asset deleted successfully');
      onBack();
    } catch (error: any) {
      console.error('Error deleting asset:', error);
      toast.error(error.message || 'Failed to delete asset');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
      </div>
    );
  }

  if (loadError || !asset) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader
          organization={organization}
          user={user}
          userRole={userRole}
          currentRoute="asset-list"
          onSwitchOrganization={onSwitchOrganization}
          onEditProfile={onEditProfile}
          onLogout={onLogout}
        />
        <PageHeader back={{ label: 'Back to Items', onClick: onBack }} title="Equipment" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Alert variant="destructive">
            <AlertDescription>{loadError || 'Asset not found.'}</AlertDescription>
          </Alert>
          <Button variant="outline" onClick={loadAsset} className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        organization={organization}
        user={user}
        userRole={userRole}
        currentRoute="asset-list"
        onSwitchOrganization={onSwitchOrganization}
        onEditProfile={onEditProfile}
        onLogout={onLogout}
      />

      <PageHeader
        back={asset.equipment_item_id && onBackToItem
          ? { label: `Back to ${asset.manufacturer_model}`, onClick: () => onBackToItem(asset.equipment_item_id) }
          : { label: 'Back to Items', onClick: onBack }}
        title={asset.manufacturer_model}
        badge={
          <>
            <KindPill kind={recordKind(asset)} />
            {recordKind(asset) === 'lot' && <span className="text-sm text-gray-600">{`Lot of ${asset.quantity ?? 1}`}</span>}
            {asset.category && <Badge variant="secondary">{asset.category}</Badge>}
            {asset.type && (
              <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">
                {asset.type}
              </Badge>
            )}
            {asset.status && (
              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${ASSET_STATUS_CONFIG[asset.status as keyof typeof ASSET_STATUS_CONFIG]?.color ?? 'bg-gray-100 text-gray-700 border-gray-300'}`}>
                {asset.status}
              </span>
            )}
          </>
        }
        actions={
          <>
            {isMissing && (
              <Button variant="outline" onClick={handleUndoWriteOff} disabled={undoing || undoLocked}>
                <Undo2 className="w-4 h-4 mr-2" />
                Undo write-off
              </Button>
            )}
            {canManage(userRole) && (
              <Button
                variant="outline"
                onClick={() => onEdit(assetId)}
              >
                <Edit2 className="w-4 h-4 mr-2" />
                Edit
              </Button>
            )}
            {canManage(userRole) && (
              <Button
                variant="outline"
                onClick={handleDuplicate}
              >
                <Copy className="w-4 h-4 mr-2" />
                Duplicate
              </Button>
            )}
            {userRole === 'Admin' && (
              <Button
                variant="outline"
                onClick={handleDelete}
                className="text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            )}
          </>
        }
      />

      {isMissing && undoLocked && (
        <p className="px-6 pt-2 text-sm text-amber-700">{WRITE_OFF_LOCKED_MESSAGE}</p>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main Details */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Asset Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Manufacturer & Model</p>
                  <p className="mt-1 text-gray-900">{asset.manufacturer_model}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Serial Number</p>
                  <p className="mt-1 font-mono text-gray-900">{asset.serial_number || '—'}</p>
                </div>
                
                  <div>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Inventory Tag ID</p>
                    <p className="mt-1 font-mono text-gray-900">{asset.tag_number || '-'}</p>
                  </div>
               
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Status</p>
                  <div className="mt-1">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${ASSET_STATUS_CONFIG[asset.status as keyof typeof ASSET_STATUS_CONFIG]?.color ?? 'bg-gray-100 text-gray-700 border-gray-300'}`}>
                      {asset.status ?? 'Active'}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Retired On</p>
                  <p className="mt-1 text-gray-900">
                    {asset.retired_on ? formatDateOnly(asset.retired_on, 'PPP') : '—'}
                  </p>
                </div>
                {asset.purchase_id && (
                  <div className="md:col-span-2">
                    <AttachmentManager
                      organizationId={organization.id}
                      entityType="purchase"
                      entityId={asset.purchase_id}
                      title="Purchase Invoice / Receipt"
                      allowUpload={false}
                    />
                  </div>
                )}
                <div className="md:col-span-2">
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Notes</p>
                  <div className="mt-1 text-gray-600 prose prose-sm max-w-none">
                    {asset.description
                      ? <ReactMarkdown>{asset.description}</ReactMarkdown>
                      : 'No description provided.'}
                  </div>
                </div>
              </div>
            </Card>

            {assetId && (
              <div className="mt-4">
                <AttachmentManager
                  organizationId={organization.id}
                  entityType="asset"
                  entityId={assetId}
                  title="Asset Attachments"
                  allowUpload={canManage(userRole)}
                />
              </div>
            )}
          </div>

          {/* Sidebar Info */}
          <div className="space-y-4">
            <Card className="p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Financial Information</h3>
              <div className="space-y-4">
                {asset.purchase_id && onNavigateToPurchases && (
                  <div className="pb-2 border-b border-gray-100">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onNavigateToPurchases(asset.purchase_id)}
                      className="w-full text-sky-600 border-sky-200 hover:bg-sky-50"
                    >
                      <CreditCard className="w-4 h-4 mr-2" />
                      View Purchase Record
                      <ExternalLink className="w-3 h-3 ml-2 opacity-50" />
                    </Button>
                  </div>
                )}
                {asset.tag_number && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Inventory Tag ID</p>
                    <p className="mt-1 text-gray-900 font-mono font-medium">{asset.tag_number}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Acquisition Date</p>
                  <p className="mt-1 text-gray-900 font-medium">
                    {asset.acquisition_date ? formatDateOnly(asset.acquisition_date, 'PPP') : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Vendor</p>
                  <p className="mt-1 text-gray-900 font-medium">{asset.vendor || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</p>
                  <p className="mt-1 text-gray-900 font-medium">{asset.quantity || 1}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Item Price</p>
                  <p className="mt-1 text-gray-900 font-medium">
                    {asset.item_price ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(asset.item_price) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Item Cost</p>
                  <p className="mt-1 text-gray-900 font-medium">
                    {asset.item_cost ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(asset.item_cost) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Replacement Value</p>
                  <p className="mt-1 text-gray-900 font-medium">
                    {asset.replacement_value ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(asset.replacement_value) : '—'}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* History Tables */}
        <div className="space-y-4 mt-4">
          {/* Asset Change History */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-5 h-5 text-gray-400" />
              <h3 className="text-lg font-semibold text-gray-900">Change History</h3>
            </div>
            <ActivityFeed entries={assetActivity} isLoading={isLoadingHistory} />
          </Card>

          {/* Inventory Tracking */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-5 h-5 text-gray-400" />
              <h3 className="text-lg font-semibold text-gray-900">Inventory Tracking</h3>
              {inventoryTracking.length > 10 && (
                <span className="text-xs text-gray-400 ml-1">(last 10 of {inventoryTracking.length})</span>
              )}
            </div>
            {isLoadingHistory ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </div>
            ) : inventoryTracking.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">No inventory scans recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gig</TableHead>
                    <TableHead>Kit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scanned By</TableHead>
                    <TableHead>Scanned At</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventoryTracking.slice(0, 10).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.gig?.title ?? '—'}</TableCell>
                      <TableCell>{row.kit?.name ?? '—'}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium bg-sky-100 text-sky-800 border-sky-300">
                          {row.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        {row.scanned_by_user
                          ? `${row.scanned_by_user.first_name} ${row.scanned_by_user.last_name}`.trim()
                          : '—'}
                      </TableCell>
                      <TableCell className="text-gray-500 text-xs">
                        {format(new Date(row.scanned_at), 'PPp')}
                      </TableCell>
                      <TableCell className="text-gray-500 text-xs max-w-[160px] truncate">
                        {row.notes ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
