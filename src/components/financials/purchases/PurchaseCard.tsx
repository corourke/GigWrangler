import type { Ref } from 'react';
import { ChevronDown, ChevronRight, FileText, Loader2, Pencil, Trash2, Upload } from 'lucide-react';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../../ui/table';
import type { DbPurchase } from '../../../utils/supabase/types';
import { isSyntheticHeader } from './reconciliation';
import PurchaseLineRow, { type PurchaseLineActions } from './PurchaseLineRow';
import type { HeaderAttachment } from './usePurchasesData';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A purchase date (YYYY-MM-DD) split for the date block on each purchase card. */
function dateBlock(date: string | null | undefined): { mon: string; day: string; year: string } {
  const [y, m, d] = (date ?? '').split('-');
  return { mon: MONTHS[Number(m) - 1] ?? '', day: d ? String(Number(d)) : '', year: y ?? '' };
}

interface PurchaseCardProps {
  group: { header: DbPurchase; children: DbPurchase[] };
  highlighted: boolean;
  highlightRef?: Ref<HTMLDivElement>;
  attachment: HeaderAttachment | undefined;
  uploading: boolean;
  collapsed: boolean;
  expandedItemId: string | null;
  onToggleCollapsed: () => void;
  onToggleItem: (itemId: string) => void;
  onViewDoc: () => void;
  onAttachDoc: () => void;
  onEdit: () => void;
  onDelete: () => void;
  lineActions: PurchaseLineActions;
}

/** One purchase on the report: its band (date, vendor, document, total, edit, delete) and its lines. */
export default function PurchaseCard({
  group, highlighted, highlightRef, attachment, uploading, collapsed, expandedItemId,
  onToggleCollapsed, onToggleItem, onViewDoc, onAttachDoc, onEdit, onDelete, lineActions,
}: PurchaseCardProps) {
  const { mon, day, year } = dateBlock(group.header.purchase_date);
  const { isAdmin } = lineActions;
  return (
    <div ref={highlightRef}>
    <Card
      className={`overflow-hidden gap-0 border-slate-300 shadow-md${highlighted ? ' ring-2 ring-sky-400 ring-offset-2' : ''}`}
    >
      {/* Design A (10-06): a tinted band with a date block, so each purchase's top is easy to find. */}
      <div className="bg-sky-50 px-4 py-2.5 border-b border-sky-200 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex flex-col items-center justify-center w-12 h-12 rounded-lg bg-sky-700 text-white shrink-0" aria-label={group.header.purchase_date ?? undefined} title={group.header.purchase_date ?? undefined}>
            <span className="text-[10px] font-semibold uppercase tracking-wider leading-none">{mon}</span>
            <span className="text-lg font-bold leading-tight">{day}</span>
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold text-sky-900 truncate" title={group.header.vendor ?? undefined}>{group.header.vendor}</div>
            <div className="text-xs text-slate-600 truncate" title={group.header.description ?? undefined}>
              {[group.header.description, year].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!isSyntheticHeader(group.header.id) && (
            attachment ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-sky-600 hover:bg-sky-50"
                onClick={onViewDoc}
                title={`View ${attachment.fileName || 'document'}`}
              >
                <FileText className="w-3.5 h-3.5 mr-1" />
                <span className="text-[10px]">View Doc</span>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-gray-500 hover:text-sky-600 hover:bg-sky-50"
                onClick={onAttachDoc}
                disabled={uploading}
                title="Attach a receipt or invoice PDF"
              >
                {uploading ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5 mr-1" />
                )}
                <span className="text-[10px]">{uploading ? 'Attaching...' : 'Attach Doc'}</span>
              </Button>
            )
          )}
          <div className="text-right min-w-[96px]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Invoice total</div>
            <div className="text-base font-bold tabular-nums">${group.header.total_inv_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          {isAdmin && !isSyntheticHeader(group.header.id) && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-gray-400 hover:text-sky-600"
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                title="Edit purchase"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-gray-400 hover:text-red-600"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                title="Delete purchase"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onToggleCollapsed}>
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
      <Table className="table-fixed">
        <TableHeader className="bg-white">
          <TableRow className="h-8 hover:bg-transparent">
            <TableHead className="text-[10px] uppercase font-bold py-1 px-4 w-[112px]">Type</TableHead>
            <TableHead className="text-[10px] uppercase font-bold py-1">Description / Model</TableHead>
            <TableHead className="text-[10px] uppercase font-bold py-1 text-center w-[92px]">Equipment</TableHead>
            <TableHead className="text-[10px] uppercase font-bold py-1 w-[200px]">Category</TableHead>
            <TableHead className="text-[10px] uppercase font-bold py-1 text-center w-[56px]">Qty</TableHead>
            <TableHead className="text-[10px] uppercase font-bold py-1 text-right w-[96px]">Price</TableHead>
            <TableHead className="text-[10px] uppercase font-bold py-1 text-right w-[104px]">Cost</TableHead>
            <TableHead className="text-[10px] uppercase font-bold py-1 w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.children.map((item) => (
            <PurchaseLineRow
              key={item.id}
              item={item}
              expanded={expandedItemId === item.id}
              onToggle={() => onToggleItem(item.id)}
              actions={lineActions}
            />
          ))}
        </TableBody>
      </Table>
      )}
    </Card>
    </div>
  );
}
