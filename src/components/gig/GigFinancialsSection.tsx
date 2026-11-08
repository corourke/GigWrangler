import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  DollarSign,
  Edit,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  MousePointer2,
  Paperclip,
  Receipt,
  Trash2,
  Users,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '../ui/table';
import { cn } from '../ui/utils';
import AttachmentManager from '../AttachmentManager';
import ReviewScannedDataDialog from '../ReviewScannedDataDialog';
import { scanInvoice } from '../../services/purchase.service';
import {
  createGigFinancial,
  recordGigFinancialPayment,
  updateGigFinancial,
} from '../../services/gig.service';
import { queryKeys } from '../../lib/queryKeys';
import { useNavigation } from '../../contexts/NavigationContext';
import type { DbGigFinancial, UserRole } from '../../utils/supabase/types';
import { lockedYearMessage } from '../../utils/taxTreatment';
import {
  stagesFor,
  isDue,
  moneyInBadge,
  isCommitted,
  outstandingAmount,
  settledAmount,
  stagePickerLabel,
  type FinDirection,
  type FinStage,
} from '../../utils/moneyFlow';
import QuickActionButtons from './QuickActionButtons';
import { useGigFinancialsData, useDeleteGigFinancial } from './useGigFinancialsData';
import MoneySummaryStrip from './financials/MoneySummaryStrip';
import FinancialRowDialog from './financials/FinancialRowDialog';
import RecordPaymentDialog, { type RecordPaymentValues } from './financials/RecordPaymentDialog';
import { formatMoney, formatShort, rowName, stageText } from './financials/format';
import { projectedStaffCost } from '../../utils/rateEstimate';
import { SCAN_FILE_ACCEPT } from '../../utils/fileAccept';

type FinancialRow = DbGigFinancial & { counterparty?: { id: string; name: string } | null; attachment_count?: number };

interface GigFinancialsSectionProps {
  gigId: string;
  currentOrganizationId: string;
  userRole?: UserRole;
  gigStartDate?: string;
  /** When the gig starts (timestamp); with gigEnd, estimates a booked rate's units (#213). */
  gigStart?: string | null;
  /** When the gig ends; an unpaid fee with no due date is due after this. */
  gigEnd?: string | null;
  /** The gig's timezone, for counting its days. */
  gigTimezone?: string | null;
  /**
   * Page-wide edit mode (#12). When given, it decides whether the add / edit /
   * delete controls show, and the section's own "Edit Financials" toggle is hidden.
   */
  editing?: boolean;
}

const BADGE_TONES = {
  attention: 'bg-amber-100 text-amber-900',
  pending: 'bg-sky-100 text-sky-900',
  done: 'bg-green-100 text-green-800',
  muted: 'bg-gray-100 text-gray-700',
} as const;

function stageTone(row: FinancialRow, gigEnd: string | null | undefined): keyof typeof BADGE_TONES {
  if (row.stage === 'paid') return 'done';
  if (row.stage === 'declined' || row.stage === 'cancelled') return 'muted';
  if (isDue(row, gigEnd)) return 'attention';
  return 'pending';
}

const counterpartyName = (row: FinancialRow) => row.counterparty?.name || row.external_entity_name || '';

export default function GigFinancialsSection({
  gigId,
  currentOrganizationId,
  userRole,
  gigStartDate,
  gigStart,
  gigEnd,
  gigTimezone,
  editing,
}: GigFinancialsSectionProps) {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const isAdmin = userRole === 'Admin' || userRole === 'Manager';
  const [localEditMode, setLocalEditMode] = useState(false);
  const isEditMode = editing ?? localEditMode;

  const { financialsQuery, summaryQuery, projectedStaffQuery } = useGigFinancialsData(gigId, currentOrganizationId, isAdmin);
  const deleteFinancial = useDeleteGigFinancial(gigId);

  const [dialog, setDialog] = useState<
    { row: FinancialRow | null; defaults?: { direction: FinDirection; stage: FinStage; date?: string } } | null
  >(null);
  const [paying, setPaying] = useState<FinancialRow | null>(null);
  const [attachmentsFor, setAttachmentsFor] = useState<FinancialRow | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedData, setScannedData] = useState<any>(null);
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);

  const rows = useMemo(() => (financialsQuery.data ?? []) as FinancialRow[], [financialsQuery.data]);
  const byDate = (a: FinancialRow, b: FinancialRow) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at);
  const moneyIn = useMemo(() => rows.filter((r) => r.direction === 'in').sort(byDate), [rows]);
  const moneyOut = useMemo(() => rows.filter((r) => r.direction === 'out').sort(byDate), [rows]);
  const badge = useMemo(() => moneyInBadge(rows, gigEnd), [rows, gigEnd]);
  const projectedStaff = projectedStaffQuery.data ?? [];

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.financials(gigId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.gigFinancialsSummary(gigId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.gigProjectedStaff(gigId) });
  }, [queryClient, gigId]);

  // External updates (staff finalization, scanned receipts).
  useEffect(() => {
    const handle = (event: any) => {
      if (!event.detail?.gigId || event.detail.gigId === gigId) refresh();
    };
    window.addEventListener('gig-financials-updated', handle);
    return () => window.removeEventListener('gig-financials-updated', handle);
  }, [gigId, refresh]);

  const saveRow = async (values: Parameters<React.ComponentProps<typeof FinancialRowDialog>['onSubmit']>[0]) => {
    if (dialog?.row) {
      await updateGigFinancial(dialog.row.id, values);
    } else {
      await createGigFinancial({ ...values, gig_id: gigId, organization_id: currentOrganizationId, amount: values.amount ?? null, date: values.date! });
    }
    refresh();
  };

  const setStage = async (row: FinancialRow, stage: FinStage) => {
    if (stage === 'paid') {
      setPaying(row);
      return;
    }
    try {
      await updateGigFinancial(row.id, { stage });
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Could not change the stage');
    }
  };

  const recordPayment = async (row: DbGigFinancial, values: RecordPaymentValues) => {
    const { remainder } = await recordGigFinancialPayment(row, values);
    refresh();
    toast.success(remainder ? `Payment recorded; ${formatMoney(remainder.amount)} still owed` : 'Payment recorded');
  };

  const remove = async (row: FinancialRow) => {
    try {
      await deleteFinancial.mutateAsync(row.id);
      refresh();
      toast.success('Removed');
    } catch (e) {
      console.error('Error deleting financial:', e);
      toast.error(lockedYearMessage(e) ?? 'Could not remove the record');
    }
  };

  const handleUploadReceipt = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setScannedFile(file);
    setIsScanning(true);
    try {
      setScannedData(await scanInvoice(file, currentOrganizationId));
      setShowReviewDialog(true);
    } catch (err: any) {
      console.error('Error scanning receipt:', err);
      toast.error(err.message || 'Failed to scan receipt');
    } finally {
      setIsScanning(false);
      event.target.value = '';
    }
  };

  if (!isAdmin) return null;

  if (financialsQuery.isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="py-12 flex flex-col items-center">
          <Loader2 className="h-8 w-8 animate-spin text-sky-600 mb-2" />
          <p className="text-gray-600">Loading financials...</p>
        </CardContent>
      </Card>
    );
  }

  const rowMenu = (row: FinancialRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Actions for ${row.description || 'row'}`}>
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setDialog({ row })}>
          <Edit className="w-4 h-4 mr-2" /> Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Set stage</DropdownMenuLabel>
        {stagesFor(row.direction).filter((s) => s !== row.stage).map((s) => (
          <DropdownMenuItem key={s} onSelect={() => setStage(row, s)}>
            {stagePickerLabel(row.direction, s)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-600" onSelect={() => remove(row)}>
          <Trash2 className="w-4 h-4 mr-2" /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const attachButton = (row: FinancialRow) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-1.5"
      onClick={() => setAttachmentsFor(row)}
      aria-label={row.attachment_count ? `${row.attachment_count} attachment(s)` : 'Attach a receipt or document'}
      title={row.attachment_count ? `${row.attachment_count} attachment(s)` : 'Attach a receipt or document'}
    >
      <Paperclip className="w-4 h-4" />
      {!!row.attachment_count && <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">{row.attachment_count}</span>}
    </Button>
  );


  return (
    <>
      <Card className="mb-6">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-gray-600" />
              <CardTitle>Financials</CardTitle>
              {badge && (
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', BADGE_TONES[badge.tone])}>{badge.label}</span>
              )}
            </div>
            {editing === undefined && (
              <Button
                variant={isEditMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLocalEditMode(!isEditMode)}
                className="h-7 text-xs gap-1.5"
              >
                <Edit className="h-3 w-3" />
                {isEditMode ? 'Done Editing' : 'Edit Financials'}
              </Button>
            )}
          </div>
          <MoneySummaryStrip summary={summaryQuery.data ?? null} isLoading={summaryQuery.isLoading} />
          {isEditMode && (
            <div className="flex flex-wrap items-center gap-2">
              <QuickActionButtons
                gigId={gigId}
                organizationId={currentOrganizationId}
                onSuccess={refresh}
                onOther={() => setDialog({ row: null, defaults: { direction: 'in', stage: 'accepted', date: gigStartDate } })}
                gigStartDate={gigStartDate}
                financials={rows}
                userRole={userRole}
              />
              <div className="relative overflow-hidden">
                <input
                  type="file"
                  title=""
                  aria-label="Upload a receipt to scan"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  onChange={handleUploadReceipt}
                  disabled={isScanning}
                  accept={SCAN_FILE_ACCEPT}
                />
                <Button variant="outline" size="sm" disabled={isScanning} tabIndex={-1}>
                  {isScanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Receipt className="w-4 h-4 mr-1" />}
                  {isScanning ? 'Scanning...' : 'Upload Receipt'}
                </Button>
              </div>
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-8">
          {/* Money in */}
          <section className="space-y-3" aria-labelledby="money-in-heading">
            <h3 id="money-in-heading" className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <ArrowUp className="w-4 h-4 text-green-700" /> Money in
            </h3>
            {moneyIn.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No money in recorded yet.</p>
            ) : (
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50/50">
                      <TableHead>Item</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Booking</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {moneyIn.map((row) => {
                      const ended = row.stage === 'declined' || row.stage === 'cancelled';
                      const open = outstandingAmount(row) > 0;
                      const name = counterpartyName(row);
                      return (
                        <TableRow key={row.id} className={cn(ended && 'text-gray-500')} data-testid={`money-in-${row.id}`}>
                          <TableCell className="py-3">
                            <div className="font-medium">{rowName(row)}</div>
                            <div className="mt-1 text-xs text-gray-500">{[name, formatShort(row.date)].filter(Boolean).join(' · ')}</div>
                          </TableCell>
                          <TableCell className="py-3">
                            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', BADGE_TONES[stageTone(row, gigEnd)])}>
                              {stageText(row, gigEnd)}
                            </span>
                          </TableCell>
                          <TableCell className="py-3 text-right font-medium whitespace-nowrap">
                            {row.amount == null ? '—' : formatMoney(row.amount, row.currency)}
                          </TableCell>
                          <TableCell className="py-3 text-right whitespace-nowrap">
                            {formatMoney(settledAmount(row), row.currency)}
                          </TableCell>
                          <TableCell className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {attachButton(row)}
                              {isEditMode && (open || row.stage === 'quoted') && (
                                <Button variant="outline" size="sm" onClick={() => setPaying(row)}>Record Payment</Button>
                              )}
                              {isEditMode && rowMenu(row)}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={2} className="font-semibold">Total income</TableCell>
                      <TableCell className="text-right font-bold">
                        {formatMoney(moneyIn.filter((r) => isCommitted(r.stage)).reduce((t, r) => t + Number(r.amount ?? 0), 0))}
                      </TableCell>
                      <TableCell className="text-right font-bold">{formatMoney(summaryQuery.data?.receivedIn ?? 0)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </section>

          {/* Money out */}
          <section className="space-y-3" aria-labelledby="money-out-heading">
            <h3 id="money-out-heading" className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <ArrowDown className="w-4 h-4 text-amber-700" /> Money out
            </h3>
            {moneyOut.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No money out recorded yet.</p>
            ) : (
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50/50">
                      <TableHead>Item</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {moneyOut.map((row) => {
                      const source = row.purchase_id ? 'Receipt' : row.staff_assignment_id ? 'Staff' : 'Manual';
                      const name = counterpartyName(row);
                      const open = outstandingAmount(row) > 0;
                      return (
                        <TableRow key={row.id} className={cn((row.stage === 'declined' || row.stage === 'cancelled') && 'text-gray-500')}>
                          <TableCell className="py-3">
                            <div className="font-medium">{rowName(row)}</div>
                            <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500">
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                {source === 'Receipt' ? <Receipt className="w-3 h-3 mr-1" /> : source === 'Staff' ? <Users className="w-3 h-3 mr-1" /> : <MousePointer2 className="w-3 h-3 mr-1" />}
                                {source}
                              </Badge>
                              {[name, formatShort(row.date)].filter(Boolean).join(' · ')}
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-sm text-gray-600">{row.category ?? ''}</TableCell>
                          <TableCell className="py-3">
                            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', BADGE_TONES[stageTone(row, gigEnd)])}>
                              {stageText(row, gigEnd)}
                            </span>
                          </TableCell>
                          <TableCell className="py-3 text-right font-medium whitespace-nowrap">
                            {row.amount == null ? '—' : formatMoney(row.stage === 'paid' ? settledAmount(row) : row.amount, row.currency)}
                          </TableCell>
                          <TableCell className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {row.purchase_id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 text-sky-700"
                                  onClick={() => navigation?.onNavigateToPurchase?.(row.purchase_id!, gigId)}
                                  aria-label="View receipt details"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </Button>
                              )}
                              {attachButton(row)}
                              {isEditMode && open && (
                                <Button variant="outline" size="sm" onClick={() => setPaying(row)}>Mark paid</Button>
                              )}
                              {isEditMode && rowMenu(row)}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} className="font-semibold">Total expense (paid and committed)</TableCell>
                      <TableCell className="text-right font-bold">
                        {formatMoney((summaryQuery.data?.expectedOut ?? 0))}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </section>

          {projectedStaff.length > 0 && (
            <section className="space-y-3" aria-labelledby="projected-staff-heading">
              <h3 id="projected-staff-heading" className="text-sm font-semibold text-amber-800">Projected staff costs</h3>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-amber-50/30">
                      <TableHead>Role</TableHead>
                      <TableHead>Staff</TableHead>
                      <TableHead className="text-right">Projected</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projectedStaff.map((staff: any) => (
                      <TableRow key={staff.id}>
                        <TableCell className="py-2.5 font-medium">{staff.slot?.role_info?.name || 'Staff'}</TableCell>
                        <TableCell className="py-2.5">
                          {staff.user ? `${staff.user.first_name} ${staff.user.last_name}` : 'Unassigned'}
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          {projectedStaffCost(staff, { start: gigStart, end: gigEnd, timezone: gigTimezone }).label}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge variant="secondary" className="text-[10px] font-normal">{staff.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
        </CardContent>
      </Card>

      <FinancialRowDialog
        open={!!dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        row={dialog?.row ?? null}
        defaults={dialog?.defaults}
        onSubmit={saveRow}
      />

      <RecordPaymentDialog row={paying} onOpenChange={(open) => !open && setPaying(null)} onSubmit={recordPayment} />

      <Dialog open={!!attachmentsFor} onOpenChange={(open) => !open && setAttachmentsFor(null)}>
        <DialogContent className="max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Receipts &amp; documents</DialogTitle>
            <DialogDescription>{attachmentsFor?.description || 'Financial record'}</DialogDescription>
          </DialogHeader>
          {attachmentsFor && (
            <AttachmentManager
              organizationId={currentOrganizationId}
              entityType="gig_financial"
              entityId={attachmentsFor.id}
              title="Attachments"
              allowUpload={isAdmin}
              onAttachmentsChange={refresh}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachmentsFor(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReviewScannedDataDialog
        open={showReviewDialog}
        onOpenChange={setShowReviewDialog}
        organizationId={currentOrganizationId}
        scannedData={scannedData}
        file={scannedFile}
        gigId={gigId}
        onSuccess={refresh}
      />
    </>
  );
}
