import { useState, useMemo, useCallback } from 'react';
import {Package, Plus, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { KitFlattenedSummary } from '../services/kit.service';
import type { KitTrackingSummary } from '../services/inventoryManagement.service';
import { kitStatusLead, kitStatusSummary, type KitPackingSummary } from '../utils/packingSummary';
import { useKitListData } from './kit/useKitListData';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import AppHeader from './AppHeader';
import EquipmentHeader from './EquipmentHeader';
import type { InventoryTab } from '../routes/paths';
import { Organization, User, UserRole } from '../utils/supabase/types';
import { canManage } from '../utils/permissions';
import { SmartDataTable, ColumnDef, RowAction } from './tables/SmartDataTable';
import { TAG_CONFIG, TRACKING_STATUS_CONFIG } from '../utils/supabase/constants';
import { TrackingStatusBadge } from './inventory/TrackingStatusBadge';

interface KitListScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  onBack: () => void;
  onCreateKit: () => void;
  onViewKit: (kitId: string) => void;
  onEditKit: (kitId: string) => void;
  onNavigateToDashboard: () => void;
  onNavigateToGigs: () => void;
  onNavigateToAssets: () => void;
  onNavigateToKits: () => void;
  onNavigateToInventory?: (tab: InventoryTab) => void;
  onSwitchOrganization: () => void;
  onLogout: () => void;
}

export default function KitListScreen({
  organization,
  user,
  userRole,
  onBack,
  onCreateKit,
  onViewKit,
  onEditKit,
  onNavigateToDashboard,
  onNavigateToGigs,
  onNavigateToAssets,
  onNavigateToKits,
  onNavigateToInventory,
  onSwitchOrganization,
  onLogout,
}: KitListScreenProps) {
  const {
    data,
    isLoading,
    error,
    refresh,
    updateKit: updateKitMutation,
    duplicateKit: duplicateKitMutation,
    deleteKit: deleteKitMutation,
  } = useKitListData(organization.id);
  const allKits = useMemo<any[]>(() => data?.kits ?? [], [data]);
  const kitTrackingSummary = useMemo(() => data?.tracking ?? new Map<string, KitTrackingSummary>(), [data]);
  const kitFlattenedSummary = useMemo(() => data?.flattened ?? new Map<string, KitFlattenedSummary>(), [data]);
  const kitPacking = useMemo(() => data?.packing ?? new Map<string, KitPackingSummary>(), [data]);
  const [_filteredKits, setFilteredKits] = useState<any[]>([]);
  const [trackingStatusFilter, setTrackingStatusFilter] = useState<string>('All');

  const handleUpdateKit = async (id: string, updates: Partial<any>) => {
    try {
      await updateKitMutation.mutateAsync({ id, updates });
      toast.success('Kit updated');
    } catch (err: any) {
      // The hook reloads the list.
      toast.error(err.message || 'Failed to update kit');
    }
  };

  const { mutateAsync: duplicateKitAsync } = duplicateKitMutation;
  const handleDuplicateKit = useCallback(async (kitId: string, kitName: string) => {
    try {
      await duplicateKitAsync(kitId);
      toast.success(`Kit "${kitName}" duplicated successfully`);
    } catch (error: any) {
      console.error('Error duplicating kit:', error);
      toast.error(error.message || 'Failed to duplicate kit');
    }
  }, [duplicateKitAsync]);

  const { mutateAsync: deleteKitAsync } = deleteKitMutation;
  const handleDeleteKit = useCallback(async (kitId: string, kitName: string) => {
    if (!confirm(`Are you sure you want to delete "${kitName}"?`)) return;

    // The hook reloads the list either way.
    try {
      await deleteKitAsync(kitId);
      toast.success('Kit deleted successfully');
    } catch (error: any) {
      console.error('Error deleting kit:', error);
      toast.error(error.message || 'Failed to delete kit');
    }
  }, [deleteKitAsync]);

  const displayedKits = useMemo(() => {
    if (trackingStatusFilter === 'All') return allKits;
    return allKits.filter(kit => {
      const tracking = kitTrackingSummary.get(kit.id);
      if (trackingStatusFilter === 'Untracked') return !tracking || (!tracking.status);
      return tracking?.status === trackingStatusFilter;
    });
  }, [allKits, trackingStatusFilter, kitTrackingSummary]);

  const categories = useMemo(() => 
    Array.from(new Set(allKits.map(k => k.category).filter(Boolean))),
    [allKits]
  );

  const TAG_PILL_CONFIG = useMemo(() => Object.fromEntries(
    Object.entries(TAG_CONFIG).map(([key, val]) => [key, { label: key, color: val.color }])
  ), []);

  const columns = useMemo<ColumnDef<any>[]>(() => [
    {
      id: 'name',
      header: 'Name',
      accessor: 'name',
      sortable: true,
      filterable: true,
      required: true,
      type: 'text',
      onCellClick: (row) => onViewKit(row.id),
    },
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
      id: 'tag_number',
      header: 'Tag #',
      accessor: 'tag_number',
      sortable: true,
      filterable: true,
      editable: true,
      type: 'text',
    },
    {
      id: 'items_count',
      header: 'Items',
      accessor: (row) => kitFlattenedSummary.get(row.id)?.totalItems ?? 0,
      sortable: true,
      readOnly: true,
      type: 'number',
    },
    {
      id: 'total_value',
      header: 'Total Value',
      accessor: (row) => kitFlattenedSummary.get(row.id)?.totalValue ?? 0,
      sortable: true,
      readOnly: true,
      type: 'currency',
    },
    {
      id: 'rental_value',
      header: 'Rental Value',
      accessor: 'rental_value',
      sortable: true,
      editable: true,
      type: 'currency',
    },
    {
      id: 'tags',
      header: 'Tags',
      accessor: 'tags',
      editable: true,
      type: 'multi-pill',
      pillConfig: TAG_PILL_CONFIG,
    },
    {
      id: 'description',
      header: 'Description',
      accessor: 'description',
      editable: true,
      optional: true,
      type: 'text',
    },
    {
      id: 'tracking_status',
      header: 'Tracking Status',
      accessor: (row) => kitTrackingSummary.get(row.id)?.status ?? null,
      readOnly: true,
      type: 'text',
      render: (value, row) => {
        const tracking = kitTrackingSummary.get(row.id);
        if (!tracking || !tracking.status) return <span className="text-xs text-muted-foreground">Untracked</span>;
        // A count only while the kit is out: its pieces at its gig, as that gig's packing list counts them.
        const packing = tracking.isContainer ? undefined : kitPacking.get(row.id);
        const lead = kitStatusLead(packing);
        if (!lead) return <TrackingStatusBadge status={tracking.status} />;
        return (
          <span className="text-xs">
            <TrackingStatusBadge status={lead.status} />
            <span className="ml-1 text-muted-foreground" title={`Pieces at ${tracking.gigTitle ?? 'its gig'}: ${kitStatusSummary(packing).title}`}>
              {lead.count} of {lead.total}
            </span>
          </span>
        );
      },
    },
    {
      id: 'last_location',
      header: 'Last Location',
      accessor: (row) => kitTrackingSummary.get(row.id)?.location ?? null,
      readOnly: true,
      type: 'text',
      render: (value) => value ? <span className="text-xs">{value}</span> : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      id: 'active_gig',
      header: 'Active Gig',
      accessor: (row) => kitTrackingSummary.get(row.id)?.gigTitle ?? null,
      readOnly: true,
      type: 'text',
      render: (value) => value ? <span className="text-xs">{value}</span> : <span className="text-xs text-muted-foreground">—</span>,
    },
  ], [categories, TAG_PILL_CONFIG, kitTrackingSummary, kitFlattenedSummary, kitPacking, onViewKit]);

  const canEdit = canManage(userRole);

  const rowActions = useMemo<RowAction<any>[]>(() => [
    {
      id: 'view',
      onClick: (row) => onViewKit(row.id),
    },
    // Manage actions hidden from read-only roles (Staff/Viewer)
    ...(canEdit ? ([
      {
        id: 'edit',
        label: 'Edit Configuration',
        onClick: (row: any) => onEditKit(row.id),
      },
      {
        id: 'duplicate',
        onClick: (row: any) => handleDuplicateKit(row.id, row.name),
      },
      {
        id: 'delete',
        disabled: () => userRole !== 'Admin',
        onClick: (row: any) => handleDeleteKit(row.id, row.name),
      },
    ] satisfies RowAction<any>[]) : []),
  ], [canEdit, onViewKit, onEditKit, userRole, handleDuplicateKit, handleDeleteKit]);

  const _formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  // Get unique categories for filter
  // const categories = Array.from(new Set(allKits.map((k) => k.category).filter(Boolean)));

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        organization={organization}
        user={user}
        userRole={userRole}
        currentRoute="kit-list"
        onSwitchOrganization={onSwitchOrganization}
        onLogout={onLogout}
      />

      <EquipmentHeader
        activeTab="kits"
        onNavigateToAssets={onNavigateToAssets}
        onNavigateToKits={onNavigateToKits}
        onNavigateToInventory={onNavigateToInventory ?? (() => {})}
        actions={canEdit ? (
          <Button onClick={onCreateKit} className="bg-sky-500 hover:bg-sky-600 text-white">
            <Plus className="w-4 h-4 mr-2" />
            Create Kit
          </Button>
        ) : null}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">

        {/* Tracking Status Filter */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-muted-foreground">Tracking Status:</span>
          <Select value={trackingStatusFilter} onValueChange={setTrackingStatusFilter}>
            <SelectTrigger className="w-[180px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All</SelectItem>
              {Object.entries(TRACKING_STATUS_CONFIG).map(([status, { label }]) => (
                <SelectItem key={status} value={status}>{label}</SelectItem>
              ))}
              <SelectItem value="Untracked">Untracked</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Kits Table */}
        <Card className="p-6">
          {error ? (
            <div className="text-center py-12">
              <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
              <h3 className="text-gray-900 mb-2">Error loading kits</h3>
              <p className="text-gray-600 mb-6">{error}</p>
              <Button onClick={() => refresh()} variant="outline">
                Try Again
              </Button>
            </div>
          ) : allKits.length === 0 && !isLoading ? (
            <div className="text-center py-12">
              <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-gray-900 mb-2">No kits found</h3>
              <p className="text-gray-600 mb-6">
                {canEdit ? 'Get started by creating your first equipment kit' : 'No kits to display'}
              </p>
              {canEdit && (
                <Button onClick={onCreateKit} className="bg-sky-500 hover:bg-sky-600 text-white">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Kit
                </Button>
              )}
            </div>
          ) : (
            <SmartDataTable
              tableId="kits-table"
              data={displayedKits}
              columns={columns}
              isLoading={isLoading}
              onRowUpdate={handleUpdateKit}
              rowActions={rowActions}
              onFilteredDataChange={setFilteredKits}
              emptyMessage="No kits match your filters"
            />
          )}
        </Card>
      </div>
    </div>
  );
}