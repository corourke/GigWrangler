import { useState, useEffect, useCallback } from 'react';
import { Package, Edit2, Trash2, Copy, Loader2, Layers, Boxes, Container } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Alert, AlertDescription } from './ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { Organization, User, UserRole, ActivityLogEntry } from '../utils/supabase/types';
import { canManage } from '../utils/permissions';
import {
  getKit,
  deleteKit,
  duplicateKit,
  getKitFlattenedContents,
  getKitFlattenedItems,
  getKitComponentTree,
  countInventoryItems,
  maxTreeDepth,
  KitComponentTreeNode,
} from '../services/kit.service';
import { getEntityActivity } from '../services/activityLog.service';
import { pieceValue, summarizeItem } from '../utils/equipmentItems';
import ActivityFeed from './ActivityFeed';
import { History } from 'lucide-react';
import { useLatestRequest } from '../utils/hooks/useLatestRequest';

interface KitDetailScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  kitId: string;
  onBack: () => void;
  onEdit: (kitId: string) => void;
  onSwitchOrganization: () => void;
  onLogout: () => void;
}

interface FlattenedAssetRow {
  asset_id: string;
  total_quantity: number;
  asset: any;
}

/** An "any" line, flattened through nested kits (#184). */
type FlattenedItemRow = Awaited<ReturnType<typeof getKitFlattenedItems>>[number];

const DEPTH_WARNING_THRESHOLD = 6;

/**
 * Recursively renders the combined tree of every asset and sub-kit nested
 * inside this kit, at every level. A container sub-kit is labeled as such;
 * when `showContainerContents` is off, its own nested contents are hidden
 * (it's shown as a single sealed unit) — the data is still fetched either
 * way, this is purely a display choice.
 */
function ComponentTree({ nodes, showContainerContents, owned, level = 0 }: {
  nodes: KitComponentTreeNode[]; showContainerContents: boolean; owned: Map<string, number>; level?: number;
}) {
  return (
    <ul className={level === 0 ? '' : 'ml-6 border-l border-gray-200 pl-4'}>
      {nodes.map((node) => {
        if (node.type === 'item') {
          // "N × any" of an item (#184).
          const n = node.item ? owned.get(node.item.id) : undefined;
          return (
            <li key={node.clientKey} className="py-1">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="text-[10px] border-sky-300 bg-sky-50 text-sky-800">Any</Badge>
                <span className="text-gray-900"><strong>{node.quantity} ×</strong></span>
                <span className="text-gray-900">{node.item?.manufacturer_model || 'Unknown item'}</span>
                {n != null && <span className="text-xs text-gray-500">of {n} owned</span>}
              </div>
            </li>
          );
        }
        if (node.type === 'asset') {
          return (
            <li key={node.clientKey} className="py-1">
              <div className="flex items-center gap-2 text-sm">
                <Package className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-gray-900">{node.asset?.manufacturer_model || 'Unknown Asset'}</span>
                <span className="text-gray-500">× {node.quantity}</span>
              </div>
            </li>
          );
        }

        const isContainer = !!node.kit?.is_container;
        const hideChildren = isContainer && !showContainerContents;

        return (
          <li key={node.clientKey} className="py-1">
            <div className="flex items-center gap-2 text-sm">
              <Layers className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-gray-900">{node.kit?.name}</span>
              <span className="text-gray-500">× {node.quantity}</span>
              <Badge variant={isContainer ? 'default' : 'outline'} className="text-[10px]">
                {isContainer ? 'Container' : 'Items'}
              </Badge>
            </div>
            {!hideChildren && node.children.length > 0 && (
              <ComponentTree nodes={node.children} showContainerContents={showContainerContents} owned={owned} level={level + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function KitDetailScreen({
  organization,
  user,
  userRole,
  kitId,
  onBack,
  onEdit,
  onSwitchOrganization,
  onLogout,
}: KitDetailScreenProps) {
  const [kit, setKit] = useState<any>(null);
  const [flattenedAssets, setFlattenedAssets] = useState<FlattenedAssetRow[]>([]);
  const [flattenedItems, setFlattenedItems] = useState<FlattenedItemRow[]>([]);
  const [componentTree, setComponentTree] = useState<KitComponentTreeNode[]>([]);
  const [showContainerContents, setShowContainerContents] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kitActivity, setKitActivity] = useState<ActivityLogEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // A late answer for an earlier kit is dropped (B12).
  const startKitRequest = useLatestRequest();
  const loadKit = useCallback(async () => {
    const isCurrent = startKitRequest();
    setIsLoading(true);
    setLoadError(null);
    try {
      const [data, flattened, tree, items] = await Promise.all([
        getKit(kitId),
        getKitFlattenedContents(kitId),
        getKitComponentTree(kitId),
        getKitFlattenedItems(kitId),
      ]);
      if (!isCurrent()) return;
      setKit(data);
      setFlattenedAssets(flattened as FlattenedAssetRow[]);
      setFlattenedItems(items ?? []);
      setComponentTree(tree);

      const depth = maxTreeDepth(tree);
      if (depth > DEPTH_WARNING_THRESHOLD) {
        toast.warning(`This kit is nested ${depth} levels deep — is that intentional?`);
      }

      setActivityLoading(true);
      getEntityActivity('kit', kitId)
        .then((a) => { if (isCurrent()) setKitActivity(a); })
        .catch(() => {})
        .finally(() => { if (isCurrent()) setActivityLoading(false); });
    } catch (error: any) {
      if (!isCurrent()) return;
      console.error('Error loading kit:', error);
      setLoadError(error.message || 'Failed to load this kit.');
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [kitId, startKitRequest]);

  useEffect(() => {
    loadKit();
  }, [loadKit]);

  const handleDuplicate = async () => {
    try {
      const newKit = await duplicateKit(kitId);
      // Tags are scanned, so the copy can't share this kit's: it starts with
      // none, and opens for editing to give it its own (#266).
      toast.success(kit?.tag_number
        ? 'Kit duplicated. Give the copy its own Tag Number.'
        : 'Kit duplicated');
      onEdit(newKit.id);
    } catch (error: any) {
      console.error('Error duplicating kit:', error);
      toast.error(error.message || 'Failed to duplicate kit');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${kit?.name}"?`)) return;

    try {
      await deleteKit(kitId);
      toast.success('Kit deleted successfully');
      onBack();
    } catch (error: any) {
      console.error('Error deleting kit:', error);
      toast.error(error.message || 'Failed to delete kit');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  // "Any" lines are valued at the item's average piece (#184).
  const itemValue = (row: FlattenedItemRow) => pieceValue(row.item?.records ?? []);
  const ownedByItem = new Map(flattenedItems.map((r) => [r.equipment_item_id, summarizeItem(r.item?.records ?? []).owned]));

  const getTotalValue = () => {
    return flattenedAssets.reduce((total, row) => {
      return total + (row.asset?.replacement_value || 0) * row.total_quantity;
    }, 0) + flattenedItems.reduce((total, row) => total + itemValue(row) * row.total_quantity, 0);
  };

  const getTotalItems = () => {
    return flattenedAssets.reduce((total, row) => total + row.total_quantity, 0)
      + flattenedItems.reduce((total, row) => total + row.total_quantity, 0);
  };

  // "Pieces to check off": containers count as one, un-drilled — contrast with getTotalItems above,
  // which is fully flattened and ignores container boundaries entirely.
  const getInventoryItems = () => countInventoryItems(componentTree);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
      </div>
    );
  }

  if (loadError || !kit) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader
          organization={organization}
          user={user}
          userRole={userRole}
          currentRoute="kit-detail"
          onSwitchOrganization={onSwitchOrganization}
          onLogout={onLogout}
        />
        <PageHeader back={{ label: 'Back to Kits', onClick: onBack }} title="Kit" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Alert variant="destructive">
            <AlertDescription>{loadError || 'Kit not found.'}</AlertDescription>
          </Alert>
          <Button variant="outline" onClick={loadKit} className="mt-4">
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
        currentRoute="kit-detail"
        onSwitchOrganization={onSwitchOrganization}
        onLogout={onLogout}
      />

      <PageHeader
        back={{ label: 'Back to Kits', onClick: onBack }}
        title={kit.name}
        badge={
          <>
            {kit.category && <Badge variant="outline">{kit.category}</Badge>}
            <Badge variant={kit.is_container ? 'default' : 'outline'} className="gap-1">
              {kit.is_container ? <Container className="w-3 h-3" /> : <Boxes className="w-3 h-3" />}
              {kit.is_container ? 'Container' : 'Items'}
            </Badge>
          </>
        }
        actions={
          <>
            {canManage(userRole) && (
              <Button
                variant="outline"
                onClick={() => onEdit(kitId)}
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {(kit.tag_number || kit.description || (kit.tags && kit.tags.length > 0)) && (
          <div className="mb-6 space-y-2">
            {kit.tag_number && (
              <div className="text-sm text-gray-600">
                <span className="font-medium">Tag Number:</span> {kit.tag_number}
              </div>
            )}
            {kit.description && <p className="text-gray-600">{kit.description}</p>}
            {kit.tags && kit.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {kit.tags.map((tag: string) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}


        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
          <Card className="p-6">
            <p className="text-sm text-gray-600 mb-1">Lines</p>
            <p className="text-3xl text-gray-900">{flattenedAssets.length + flattenedItems.length}</p>
            <p className="text-xs text-gray-500 mt-1">Each unit, lot or item once</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-gray-600 mb-1">Pieces</p>
            <p className="text-3xl text-gray-900">{getTotalItems()}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-gray-600 mb-1">Pieces to check off</p>
            <p className="text-3xl text-gray-900">{getInventoryItems()}</p>
            <p className="text-xs text-gray-500 mt-1">Containers count as one</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-gray-600 mb-1">Total Value</p>
            <p className="text-3xl text-gray-900">{formatCurrency(getTotalValue())}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-gray-600 mb-1">Rental Value</p>
            <p className="text-3xl text-gray-900">{formatCurrency(kit.rental_value || 0)}</p>
          </Card>
        </div>

        {/* Flattened Assets Table */}
        <Card className="p-6">
          <h3 className="text-gray-900 mb-1">Equipment in Kit</h3>
          <p className="text-xs text-gray-500 mb-4">
            Aggregated across this kit and everything nested inside it
          </p>
          {flattenedAssets.length === 0 && flattenedItems.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">Nothing in this kit yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Serial Number</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Unit Value</TableHead>
                    <TableHead>Total Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flattenedAssets.map((row) => (
                    <TableRow key={row.asset_id}>
                      <TableCell>
                        <div className="text-sm text-gray-900">
                          {row.asset?.manufacturer_model}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-700">{row.asset?.category}</div>
                        {row.asset?.type && (
                          <div className="text-xs text-gray-500">
                            {row.asset.type}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-700 font-mono">
                          {row.asset?.serial_number || '—'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-900">{row.total_quantity}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-900">
                          {formatCurrency(row.asset?.replacement_value || 0)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-900">
                          {formatCurrency((row.asset?.replacement_value || 0) * row.total_quantity)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {flattenedItems.map((row) => (
                    <TableRow key={`item-${row.equipment_item_id}`}>
                      <TableCell>
                        <div className="text-sm text-gray-900">{row.item?.manufacturer_model}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-700">{row.item?.category}</div>
                        {row.item?.type && <div className="text-xs text-gray-500">{row.item.type}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-500">Any</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-900">{row.total_quantity}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-900">{formatCurrency(itemValue(row))}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-900">{formatCurrency(itemValue(row) * row.total_quantity)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Totals */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <div className="flex justify-end">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-8">
                      <span className="text-sm text-gray-600">Pieces:</span>
                      <span className="text-sm text-gray-900">{getTotalItems()}</span>
                    </div>
                    <div className="flex items-center justify-between gap-8">
                      <span className="text-gray-900">Total Value:</span>
                      <span className="text-gray-900">{formatCurrency(getTotalValue())}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Kit Structure — every asset and sub-kit nested inside, combined */}
        <Card className="p-6 mt-4">
          <div className="flex items-start justify-between gap-4 mb-1">
            <h3 className="text-gray-900">Kit Structure</h3>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer whitespace-nowrap">
              <Checkbox
                checked={showContainerContents}
                onCheckedChange={(checked) => setShowContainerContents(checked === true)}
              />
              Show container contents
            </label>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Every item, unit, lot and sub-kit nested in this kit, at every level. A Container is scanned and tracked as one sealed unit — its own contents are hidden by default.
          </p>
          {componentTree.length === 0 ? (
            <p className="text-sm text-gray-500">This kit has no components yet.</p>
          ) : (
            <ComponentTree nodes={componentTree} showContainerContents={showContainerContents} owned={ownedByItem} />
          )}
        </Card>

        {/* TODO: Gig Assignments Section */}
        {/* This would show which gigs this kit is currently assigned to */}

        {/* Kit Change History */}
        <Card className="p-4 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-5 h-5 text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900">Change History</h3>
          </div>
          <ActivityFeed entries={kitActivity} isLoading={activityLoading} />
        </Card>
      </div>
    </div>
  );
}
