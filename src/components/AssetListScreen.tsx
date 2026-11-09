import { useState, useEffect, useMemo, useCallback } from 'react';
import {Package, Plus, Search, Loader2, AlertCircle, Upload, FileText, X } from 'lucide-react';
import { toast } from 'sonner';
import { deleteAsset, duplicateAsset, updateAsset } from '../services/asset.service';
import { getItems, getContainerPieces, type EquipmentItemWithRecords } from '../services/equipmentItem.service';
import { itemMatchesSearch, type ContainerPieces } from '../utils/equipmentItems';
import ItemsTable from './equipment/ItemsTable';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { getAssetTrackingSummary } from '../services/inventoryManagement.service';
import { scanInvoice } from '../services/purchase.service';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import AppHeader from './AppHeader';
import EquipmentHeader from './EquipmentHeader';
import type { InventoryTab } from '../routes/paths';
import { Organization, User, UserRole } from '../utils/supabase/types';
import type { DbAsset } from '../utils/supabase/types';
import { canManage } from '../utils/permissions';
import { ASSET_STATUS_CONFIG, TRACKING_STATUS_CONFIG } from '../utils/supabase/constants';
import { SmartDataTable, ColumnDef, RowAction } from './tables/SmartDataTable';
import ReviewScannedDataDialog from './ReviewScannedDataDialog';
import { TrackingStatusBadge } from './inventory/TrackingStatusBadge';
import { SCAN_FILE_ACCEPT } from '../utils/fileAccept';

interface AssetListScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  onBack: () => void;
  /** Add a unit or lot, to a given item or (with no item) choosing one. */
  onCreateAsset: (itemId?: string) => void;
  onViewAsset: (assetId: string) => void;
  onViewItem: (itemId: string) => void;
  onNavigateToDashboard: () => void;
  onNavigateToGigs: () => void;
  onNavigateToAssets: () => void;
  onNavigateToKits: () => void;
  onNavigateToInventory?: (tab: InventoryTab) => void;
  onNavigateToImport?: () => void;
  onSwitchOrganization: () => void;
  onLogout: () => void;
  onEditProfile?: () => void;
}

export default function AssetListScreen({
  organization,
  user,
  userRole,
  onBack,
  onCreateAsset,
  onViewAsset,
  onViewItem,
  onNavigateToDashboard,
  onNavigateToGigs,
  onNavigateToAssets,
  onNavigateToKits,
  onNavigateToInventory,
  onNavigateToImport,
  onSwitchOrganization,
  onLogout,
  onEditProfile,
}: AssetListScreenProps) {
  // Items (what it is), each with its units and lots (what we own) — #182
  const [items, setItems] = useState<EquipmentItemWithRecords[]>([]);
  const [containerPieces, setContainerPieces] = useState<ContainerPieces>({ all: new Map(), active: new Map() });
  const [view, setView] = useState<'items' | 'records'>('items');
  const allAssets = useMemo<DbAsset[]>(() => items.flatMap((i) => i.records), [items]);
  const [filteredAssets, setFilteredAssets] = useState<DbAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletedAssetIds, setDeletedAssetIds] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [scannedData, setScannedData] = useState<any>(null);
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [assetTrackingSummary, setAssetTrackingSummary] = useState<Map<string, { status: string; location?: string | null; gigTitle?: string | null }>>(new Map());
  const [trackingStatusFilter, setTrackingStatusFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [loadedItems, trackingSummary] = await Promise.all([
        getItems(organization.id),
        getAssetTrackingSummary(organization.id),
      ]);
      setItems(loadedItems);
      setAssetTrackingSummary(trackingSummary);
      setContainerPieces(await getContainerPieces(organization.id, loadedItems));
    } catch (err: any) {
      setError(err.message || 'Failed to load equipment');
    } finally {
      setIsLoading(false);
    }
  }, [organization.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUpdateAsset = async (id: string, updates: Partial<DbAsset>) => {
    try {
      await updateAsset(id, updates);
      setItems(prev => prev.map(i => ({ ...i, records: i.records.map(a => a.id === id ? { ...a, ...updates } : a) })));
      toast.success('Asset updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update asset');
      refresh();
    }
  };

  const handleDeleteAsset = useCallback(async (assetId: string) => {
    if (!confirm('Are you sure you want to delete this asset?')) return;

    // Optimistically remove the asset from the UI immediately
    setDeletedAssetIds(prev => new Set(prev).add(assetId));

    try {
      await deleteAsset(assetId);
      toast.success('Asset deleted successfully');
      // Refresh to ensure consistency with server state and clear the deleted set
      refresh();
      setDeletedAssetIds(prev => {
        const next = new Set(prev);
        next.delete(assetId);
        return next;
      });
    } catch (error: any) {
      console.error('Error deleting asset:', error);
      toast.error(error.message || 'Failed to delete asset');
      // Restore the asset in the UI if deletion failed
      setDeletedAssetIds(prev => {
        const next = new Set(prev);
        next.delete(assetId);
        return next;
      });
      // Refresh to ensure consistency
      refresh();
    }
  }, [refresh]);

  const handleDuplicateAsset = useCallback(async (assetId: string) => {
    try {
      await duplicateAsset(assetId);
      toast.success('Asset duplicated successfully');
      refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to duplicate asset');
    }
  }, [refresh]);

  const handleUploadInvoice = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setScannedFile(file);
    setIsScanning(true);
    try {
      const data = await scanInvoice(file, organization.id);
      setScannedData(data);
      setShowReviewDialog(true);
    } catch (err: any) {
      console.error('Error scanning invoice:', err);
      // If it's a known scan error (like Tier 1+ required), we still open the dialog
      // so the user can enter data manually and the file still gets uploaded.
      // The server sends SCAN_ACCESS_REQUIRED (older builds: PDF_SCAN_ACCESS_REQUIRED); either way, enter it by hand.
      if (err.message?.includes('SCAN_ACCESS_REQUIRED')) {
        toast.error('AI scan unavailable for this file type. Opening manual entry.');
        setScannedData(null); // Explicitly null to trigger manual mode in dialog
        setShowReviewDialog(true);
      } else {
        toast.error(err.message || 'Failed to scan invoice');
      }
    } finally {
      setIsScanning(false);
      event.target.value = ''; // Reset input
    }
  };

  const activeAssets = useMemo(() => {
    let filtered = allAssets.filter(asset => !deletedAssetIds.has(asset.id));
    
    // Apply tracking status filter
    if (trackingStatusFilter !== 'All') {
      filtered = filtered.filter(asset => {
        const tracking = assetTrackingSummary.get(asset.id);
        if (trackingStatusFilter === 'Untracked') return !tracking;
        return tracking?.status === trackingStatusFilter;
      });
    }

    // Apply global search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(asset => {
        return (
          asset.manufacturer_model?.toLowerCase().includes(query) ||
          asset.category?.toLowerCase().includes(query) ||
          asset.serial_number?.toLowerCase().includes(query) ||
          asset.tag_number?.toLowerCase().includes(query) ||
          asset.type?.toLowerCase().includes(query) ||
          asset.vendor?.toLowerCase().includes(query)
        );
      });
    }

    return filtered;
  }, [allAssets, deletedAssetIds, trackingStatusFilter, assetTrackingSummary, searchQuery]);

  // By item: an item shows when it matches the search (its own fields or any
  // record's serial, tag or vendor) and, with a tracking filter, when any of
  // its records matches it.
  const visibleItems = useMemo(() => {
    const visibleIds = new Set(activeAssets.map((a) => a.id));
    return items
      .map((i) => ({ ...i, records: i.records.filter((r) => !deletedAssetIds.has(r.id)) }))
      .filter((i) => itemMatchesSearch(i, i.records, searchQuery))
      .filter((i) => trackingStatusFilter === 'All' || i.records.some((r) => visibleIds.has(r.id)));
  }, [items, activeAssets, deletedAssetIds, searchQuery, trackingStatusFilter]);

  const categories = useMemo(() => 
    Array.from(new Set(allAssets.map(a => a.category).filter(Boolean))),
    [allAssets]
  );

  const columns = useMemo<ColumnDef<DbAsset>[]>(() => [
    {
      id: 'category',
      header: 'Category',
      accessor: 'category',
      sortable: true,
      filterable: true,
      editable: true,
      type: 'select',
      options: categories.map(cat => ({ label: cat, value: cat })),
    },
    {
      id: 'manufacturer_model',
      header: 'Manufacturer & Model',
      accessor: 'manufacturer_model',
      sortable: true,
      filterable: true,
      required: true,
      type: 'text',
      onCellClick: (row) => onViewAsset(row.id),
    },
    {
      id: 'type',
      header: 'Type',
      accessor: 'type',
      sortable: true,
      filterable: true,
      editable: true,
      optional: true,
      type: 'text',
    },
    {
      id: 'serial_number',
      header: 'Serial Number',
      accessor: 'serial_number',
      sortable: true,
      filterable: true,
      editable: true,
      type: 'text',
    },
    {
      id: 'status',
      header: 'Status',
      accessor: 'status',
      sortable: true,
      filterable: true,
      editable: true,
      type: 'pill',
      pillConfig: Object.entries(ASSET_STATUS_CONFIG).reduce((acc, [key, config]) => {
        acc[key] = { label: config.label, color: config.color };
        return acc;
      }, {} as any),
    },
    {
      id: 'quantity',
      header: 'Qty',
      accessor: 'quantity',
      sortable: true,
      editable: true,
      type: 'number',
      className: 'w-[80px]',
    },
    {
      id: 'replacement_value',
      header: 'Value (Each)',
      accessor: 'replacement_value',
      sortable: true,
      editable: true,
      type: 'currency',
    },
    {
      id: 'item_price',
      header: 'Price',
      accessor: 'item_price',
      sortable: true,
      editable: true,
      type: 'currency',
    },
    {
      id: 'item_cost',
      header: 'Cost',
      accessor: 'item_cost',
      sortable: true,
      editable: true,
      type: 'currency',
    },
    {
      id: 'total_value',
      header: 'Total Value',
      accessor: (row) => (row.replacement_value || 0) * (row.quantity || 1),
      sortable: true,
      type: 'currency',
      readOnly: true,
    },
    {
      id: 'retired_on',
      header: 'Retired On',
      accessor: 'retired_on',
      sortable: true,
      editable: true,
      type: 'text',
    },
    {
      id: 'insurance_policy_added',
      header: 'Insurance',
      accessor: 'insurance_policy_added',
      sortable: true,
      filterable: false,
      editable: true,
      type: 'checkbox',
      className: 'w-[100px] text-center',
    },
    {
      id: 'insurance_class',
      header: 'Ins. Class',
      accessor: 'insurance_class',
      sortable: true,
      filterable: true,
      editable: true,
      optional: true,
      type: 'text',
    },
    {
      id: 'current_status',
      header: 'Inventory Status',
      accessor: (row) => assetTrackingSummary.get(row.id)?.status ?? null,
      readOnly: true,
      type: 'text',
      render: (value, row) => {
        const tracking = assetTrackingSummary.get(row.id);
        if (!tracking) return <span className="text-xs text-muted-foreground">Untracked</span>;
        return <TrackingStatusBadge status={tracking.status} />;
      },
    },
    {
      id: 'last_location',
      header: 'Last Location',
      accessor: (row) => assetTrackingSummary.get(row.id)?.location ?? null,
      readOnly: true,
      type: 'text',
      render: (value) => value ? <span className="text-xs">{value}</span> : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      id: 'active_gig',
      header: 'Active Gig',
      accessor: (row) => assetTrackingSummary.get(row.id)?.gigTitle ?? null,
      readOnly: true,
      type: 'text',
      render: (value) => value ? <span className="text-xs">{value}</span> : <span className="text-xs text-muted-foreground">—</span>,
    },
  ], [categories, assetTrackingSummary, onViewAsset]);

  const canEdit = canManage(userRole);

  const rowActions = useMemo<RowAction<DbAsset>[]>(() => [
    {
      id: 'view',
      onClick: (row) => onViewAsset(row.id),
    },
    // Manage actions hidden from read-only roles (Staff/Viewer)
    ...(canEdit ? ([
      {
        id: 'duplicate',
        onClick: (row: DbAsset) => handleDuplicateAsset(row.id),
      },
      {
        id: 'delete',
        disabled: () => userRole !== 'Admin',
        onClick: (row: DbAsset) => handleDeleteAsset(row.id),
      },
    ] satisfies RowAction<DbAsset>[]) : []),
  ], [canEdit, onViewAsset, userRole, handleDuplicateAsset, handleDeleteAsset]);

  const formatCurrency = (amount?: number) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

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

      <EquipmentHeader
        activeTab="assets"
        onNavigateToAssets={onNavigateToAssets}
        onNavigateToKits={onNavigateToKits}
        onNavigateToInventory={onNavigateToInventory ?? (() => {})}
        actions={canEdit ? (
          <>
            <div className="relative overflow-hidden">
              <input
                type="file"
                title=""
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                onChange={handleUploadInvoice}
                disabled={isScanning}
                accept={SCAN_FILE_ACCEPT}
              />
              <Button variant="outline" className="border-sky-500 text-sky-600 hover:bg-sky-50" disabled={isScanning}>
                {isScanning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    Upload Invoice
                  </>
                )}
              </Button>
            </div>
            <Button onClick={() => onCreateAsset()} className="bg-sky-700 hover:bg-sky-800 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
            {onNavigateToImport && (
              <Button
                onClick={onNavigateToImport}
                variant="outline"
                className="border-sky-500 text-sky-600 hover:bg-sky-50"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>
            )}
          </>
        ) : null}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">

        {/* Filters */}
        <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Tracking:</span>
            <Select value={trackingStatusFilter} onValueChange={setTrackingStatusFilter}>
              <SelectTrigger className="w-[160px] h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Statuses</SelectItem>
                {Object.entries(TRACKING_STATUS_CONFIG).map(([status, { label }]) => (
                  <SelectItem key={status} value={status}>{label}</SelectItem>
                ))}
                <SelectItem value="Untracked">Untracked</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search model, type, serial or tag…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* By item, or every unit and lot as its own row (#182) */}
        <Tabs value={view} onValueChange={(v) => setView(v as 'items' | 'records')} className="mb-3">
          <TabsList aria-label="View">
            <TabsTrigger value="items">By item</TabsTrigger>
            <TabsTrigger value="records">Every unit &amp; lot</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Equipment table */}
        <Card className="p-6">
          {error ? (
            <div className="text-center py-12">
              <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
              <h3 className="text-gray-900 mb-2">Error loading equipment</h3>
              <p className="text-gray-600 mb-6">{error}</p>
              <Button onClick={refresh} variant="outline">
                Try Again
              </Button>
            </div>
          ) : activeAssets.length === 0 && !isLoading ? (
            <div className="text-center py-12">
              <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-gray-900 mb-2">No equipment found</h3>
              <p className="text-gray-600 mb-6">
                {canEdit ? 'Get started by adding your first item' : 'No equipment to display'}
              </p>
              {canEdit && (
                <Button onClick={() => onCreateAsset()} className="bg-sky-700 hover:bg-sky-800 text-white">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Item
                </Button>
              )}
            </div>
          ) : view === 'items' ? (
            isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : visibleItems.length === 0 ? (
              <p className="py-12 text-center text-muted-foreground">No items match your filters</p>
            ) : (
              <ItemsTable
                items={visibleItems}
                containerPieces={containerPieces}
                tracking={assetTrackingSummary}
                onViewItem={onViewItem}
                onViewAsset={onViewAsset}
                onAddRecord={canEdit ? (itemId) => onCreateAsset(itemId) : undefined}
              />
            )
          ) : (
            <SmartDataTable
              tableId="assets-table"
              data={activeAssets}
              columns={columns}
              isLoading={isLoading}
              onRowUpdate={handleUpdateAsset}
              rowActions={rowActions}
              onFilteredDataChange={setFilteredAssets}
              emptyMessage="No assets match your filters"
            />
          )}

          {/* Summary */}
          {view === 'records' && !isLoading && !error && activeAssets.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Total Items</p>
                  <p className="text-2xl text-gray-900">
                    {filteredAssets.reduce((sum, a) => sum + (a.quantity || 1), 0)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Replacement Value</p>
                  <p className="text-2xl text-gray-900">
                    {formatCurrency(
                      filteredAssets.reduce((sum, a) => sum + (a.replacement_value || 0) * (a.quantity || 1), 0)
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Insured Items</p>
                  <p className="text-2xl text-gray-900">
                    {filteredAssets
                      .filter((a) => a.insurance_policy_added)
                      .reduce((sum, a) => sum + (a.quantity || 1), 0)} /{' '}
                    {filteredAssets.reduce((sum, a) => sum + (a.quantity || 1), 0)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <ReviewScannedDataDialog
        open={showReviewDialog}
        onOpenChange={setShowReviewDialog}
        organizationId={organization.id}
        scannedData={scannedData}
        file={scannedFile}
        onSuccess={() => {
          refresh();
        }}
      />
    </div>
  );
}