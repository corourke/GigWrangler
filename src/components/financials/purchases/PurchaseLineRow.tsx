import React from 'react';
import { ChevronDown, ChevronRight, Music, Package, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { TableCell, TableRow } from '../../ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../ui/alert-dialog';
import type { DbPurchase, UserRole } from '../../../utils/supabase/types';
import { lineTaxTreatment } from '../../../utils/taxTreatment';
import GigCombobox from './GigCombobox';

/** What a line's row can do; the report owns the writes. */
export interface PurchaseLineActions {
  organizationId: string;
  userRole?: UserRole;
  /** Admins and Managers. */
  isAdmin: boolean;
  /** Gig-linked expense lines that already have their ledger entry. */
  linesWithLedger: Set<string>;
  assigningGigItemId: string | null;
  trackingItemId: string | null;
  onDeleteItem: (item: DbPurchase) => void;
  onOpenAsset: (item: DbPurchase) => void;
  onOpenGig: (gigId: string, item: DbPurchase) => void;
  onAssignGig: (item: DbPurchase, gigId: string | null, gigTitle?: string) => void;
  onAddToLedger: (item: DbPurchase) => void;
  onTrackAsEquipment: (itemId: string) => void;
}

interface PurchaseLineRowProps {
  item: DbPurchase;
  expanded: boolean;
  onToggle: () => void;
  actions: PurchaseLineActions;
}

/** A purchase line, and when opened its details and actions (gig, ledger, equipment, delete). */
export default function PurchaseLineRow({ item, expanded, onToggle, actions }: PurchaseLineRowProps) {
  const { isAdmin, userRole, assigningGigItemId, trackingItemId } = actions;
  return (
    <React.Fragment>
      <TableRow
        className="h-9 hover:bg-sky-50 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <TableCell className="py-1 px-4">
          {lineTaxTreatment(item) === 'depreciate' ? (
            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none text-[10px] h-5 px-1.5 uppercase font-bold">Depreciate</Badge>
          ) : (
            <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-none text-[10px] h-5 px-1.5 uppercase font-bold">Expense</Badge>
          )}
        </TableCell>
        <TableCell className="py-1 font-medium text-sm text-gray-800 truncate" title={item.description || undefined}>
          {item.description || '-'}
        </TableCell>
        <TableCell className="py-1 text-center">
          {item.asset_id && (
            <Package role="img" aria-label="Tracked as equipment" className="w-4 h-4 text-sky-700 inline" />
          )}
        </TableCell>
        <TableCell className="py-1 text-sm text-gray-600 truncate" title={item.category || undefined}>
          {item.category || '-'}
        </TableCell>
        <TableCell className="py-1 text-sm text-center font-mono">
          {item.quantity || '1'}
        </TableCell>
        <TableCell className="py-1 text-sm text-right font-mono text-gray-500">
          {item.item_price ? `$${item.item_price.toFixed(2)}` : '-'}
        </TableCell>
        <TableCell className="py-1 text-sm text-right font-bold font-mono">
          {item.line_cost ? `$${item.line_cost.toFixed(2)}` : '-'}
        </TableCell>
        <TableCell className="py-1 text-center">
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 inline" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 inline" />}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-gray-50">
          <TableCell colSpan={8} className="py-2 px-6 whitespace-normal">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs">
              <div><span className="text-gray-500 font-medium">Item Price:</span> {item.item_price != null ? `$${item.item_price.toFixed(2)}` : '-'}</div>
              <div><span className="text-gray-500 font-medium">Item Cost:</span> {item.item_cost != null ? `$${item.item_cost.toFixed(2)}` : '-'}</div>
              <div><span className="text-gray-500 font-medium">Line Amt:</span> {item.line_amount != null ? `$${item.line_amount.toFixed(2)}` : '-'}</div>
              <div><span className="text-gray-500 font-medium">Line Cost:</span> {item.line_cost != null ? `$${item.line_cost.toFixed(2)}` : '-'}</div>
              <div><span className="text-gray-500 font-medium">Category:</span> {item.category || '-'}</div>
              <div><span className="text-gray-500 font-medium">Tax:</span> {lineTaxTreatment(item) === 'depreciate' ? 'Depreciate' : 'Expense'}</div>
              <div><span className="text-gray-500 font-medium">Equipment:</span> {item.asset_id ? 'Yes' : 'No'}</div>
              <div><span className="text-gray-500 font-medium">ID:</span> <span className="font-mono text-[10px]">{item.id}</span></div>
              {item.asset_id && <div className="col-span-2"><span className="text-gray-500 font-medium">Asset ID:</span> <span className="font-mono text-[10px]">{item.asset_id}</span></div>}
            </div>
            <div className="mt-2 flex gap-2 flex-wrap">
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs text-red-600 border-red-200 hover:bg-red-50"
                  onClick={(e) => { e.stopPropagation(); actions.onDeleteItem(item); }}
                >
                  <Trash2 className="w-3 h-3 mr-1.5" />
                  Delete Item
                </Button>
              )}
              {item.asset_id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                  onClick={(e) => { e.stopPropagation(); actions.onOpenAsset(item); }}
                >
                  <Package className="w-3 h-3 mr-1.5" />
                  Asset Details
                </Button>
              )}
              {item.gig_id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs text-purple-600 border-purple-200 hover:bg-purple-50"
                  onClick={(e) => { e.stopPropagation(); actions.onOpenGig(item.gig_id!, item); }}
                >
                  <Music className="w-3 h-3 mr-1.5" />
                  Gig Details
                </Button>
              )}
            </div>
            {isAdmin && lineTaxTreatment(item) === 'depreciate' && (
              <p className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                Depreciated items aren't gig expenses, so this line can't be assigned to a gig.
              </p>
            )}
            {isAdmin && lineTaxTreatment(item) === 'expense' && (
              <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Assign Gig:</span>
                <div className="w-[360px] max-w-full">
                  <GigCombobox
                    organizationId={actions.organizationId}
                    value={item.gig_id || null}
                    aroundDate={item.purchase_date}
                    onChange={(gigId, gigTitle) => actions.onAssignGig(item, gigId, gigTitle)}
                    disabled={assigningGigItemId === item.id}
                  />
                </div>
                {item.gig_id && !actions.linesWithLedger.has(item.id) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                    onClick={() => actions.onAddToLedger(item)}
                    disabled={assigningGigItemId === item.id}
                    title="This line is linked to a gig but has no expense entry in that gig's ledger"
                  >
                    {assigningGigItemId === item.id
                      ? <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                      : <Plus className="w-3 h-3 mr-1.5" />}
                    Add to gig ledger
                  </Button>
                )}
              </div>
            )}
            {!item.asset_id && (userRole === 'Admin' || userRole === 'Manager') && (
              <div className="mt-3 pt-3 border-t border-gray-200" onClick={(e) => e.stopPropagation()}>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 px-3 text-xs text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                      <Package className="w-3 h-3 mr-1.5" />
                      Track as equipment
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Track as equipment?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Creates an equipment record for this item, so you can tag it and put it in kits. Its tax treatment stays {lineTaxTreatment(item) === 'depreciate' ? 'Depreciate' : 'Expense'}, and a gig it's linked to keeps it as an expense.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => actions.onTrackAsEquipment(item.id)}
                        disabled={trackingItemId === item.id}
                      >
                        {trackingItemId === item.id && <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                        Track it
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
}
