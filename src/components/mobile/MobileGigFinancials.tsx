import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useMobileGigFinancialsData } from './useMobileGigFinancialsData';
import { UserRole } from '../../utils/supabase/types';
import { settledAmount } from '../../utils/moneyFlow';
import { rowName, stageText } from '../gig/financials/format';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Loader2, DollarSign, Receipt, FileText, ChevronRight, History, Paperclip } from 'lucide-react';
import QuickActionButtons from '../gig/QuickActionButtons';
import AttachmentManager from '../AttachmentManager';
import { cn } from '../ui/utils';

interface MobileGigFinancialsProps {
  gigId: string;
  organizationId: string;
  userRole?: UserRole;
  isEditing?: boolean;
  gigStartDate?: string;
  /** When the gig ends; an unpaid booking with no due date is due after it. */
  gigEnd?: string | null;
}

export default function MobileGigFinancials({
  gigId,
  organizationId,
  userRole,
  isEditing,
  gigStartDate,
  gigEnd,
}: MobileGigFinancialsProps) {
  const [showTransactions, setShowTransactions] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);

  const isAdmin = userRole === 'Admin' || userRole === 'Manager';
  const { financials, summary, isLoading, isSummaryLoading, afterFinancialsChange } =
    useMobileGigFinancialsData(gigId, organizationId, isAdmin);
  const loadData = () => { void afterFinancialsChange(); };

  if (!isAdmin) return null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const sortedFinancials = [...financials].sort(
    // Calendar days ('YYYY-MM-DD') sort as text, newest first.
    (a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))
  );

  return (
    <Card style={{ gap: 0 }}>
      <CardContent className="p-3" style={{ paddingBottom: '12px' }}>
        <p className="text-muted-foreground font-semibold flex items-center gap-1.5 mb-3" style={{ fontSize: '11px' }}>
          <DollarSign className="w-3.5 h-3.5" />
          Financials
        </p>

        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <div style={{ flex: 1, paddingRight: 12 }}>
            <p className="text-muted-foreground font-semibold" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Revenue</p>
            <p className="font-semibold" style={{ fontSize: '14px' }}>
              {isSummaryLoading ? '—' : formatCurrency(summary?.expectedIn || 0)}
            </p>
          </div>
          <div style={{ flex: 1, paddingLeft: 12, paddingRight: 12, borderLeft: '1px solid var(--border)' }}>
            <p className="text-muted-foreground font-semibold" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Costs</p>
            <p className="font-semibold" style={{ fontSize: '14px' }}>
              {isSummaryLoading ? '—' : formatCurrency(summary?.totalCosts || 0)}
            </p>
          </div>
          <div style={{ flex: 1, paddingLeft: 12, borderLeft: '1px solid var(--border)' }}>
            <p className="text-muted-foreground font-semibold" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Profit</p>
            <p className={cn(
              "font-semibold",
              (summary?.profit || 0) > 0 ? "text-green-600" : (summary?.profit || 0) < 0 ? "text-red-600" : ""
            )} style={{ fontSize: '14px' }}>
              {isSummaryLoading ? '—' : formatCurrency(summary?.profit || 0)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          {isEditing && (
            <div className="flex justify-center">
              <QuickActionButtons
                gigId={gigId}
                organizationId={organizationId}
                onSuccess={loadData}
                gigStartDate={gigStartDate}
                financials={financials}
                userRole={userRole}
              />
            </div>
          )}

          <Button 
            variant="ghost" 
            size="sm"
            className="w-full h-7 font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            style={{ fontSize: '12px' }}
            onClick={() => setShowTransactions(true)}
            disabled={isLoading || financials.length === 0}
          >
            <History className="w-3 h-3 mr-1.5" />
            View {financials.length} Transaction{financials.length !== 1 ? 's' : ''}
            <ChevronRight className="w-2.5 h-2.5 ml-auto opacity-50" />
          </Button>
        </div>

        {isLoading && (
          <div className="flex justify-center py-2">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        )}

        {!isLoading && financials.length === 0 && isEditing && (
          <p className="text-center py-3 text-muted-foreground bg-muted/20 rounded-lg border border-dashed" style={{ fontSize: '12px' }}>
            No financial records yet
          </p>
        )}
      </CardContent>

      <Dialog open={showTransactions} onOpenChange={(open) => {
        setShowTransactions(open);
        if (!open) setSelectedTransaction(null);
      }}>
        <DialogContent className="max-w-sm max-h-[80vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle className="text-sm font-semibold">
              {selectedTransaction ? 'Transaction Detail' : `Transactions (${financials.length})`}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {selectedTransaction ? 'Details of the selected transaction' : 'List of all financial transactions for this gig'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-1 py-1">
            {selectedTransaction ? (
              <div className="space-y-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 -ml-1"
                  onClick={() => setSelectedTransaction(null)}
                >
                  ← Back
                </Button>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[11px] text-muted-foreground">{selectedTransaction.direction === 'out' ? 'Money out' : 'Money in'}</span>
                    <span className="text-[11px] font-medium">{stageText(selectedTransaction, gigEnd)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[11px] text-muted-foreground">Date</span>
                    <span className="text-[11px] font-medium">
                      {selectedTransaction.date ? format(parseISO(selectedTransaction.date), 'MMM d, yyyy') : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[11px] text-muted-foreground">Amount</span>
                    <span className="text-[11px] font-bold">{selectedTransaction.amount == null ? '—' : formatCurrency(selectedTransaction.amount)}</span>
                  </div>
                  {selectedTransaction.stage === 'paid' && Number(selectedTransaction.amount_settled) !== Number(selectedTransaction.amount) && (
                    <div className="flex justify-between">
                      <span className="text-[11px] text-muted-foreground">{selectedTransaction.direction === 'out' ? 'Paid' : 'Received'}</span>
                      <span className="text-[11px] font-bold">{formatCurrency(settledAmount(selectedTransaction))}</span>
                    </div>
                  )}
                  {selectedTransaction.description && (
                    <div className="flex justify-between">
                      <span className="text-[11px] text-muted-foreground">Description</span>
                      <span className="text-[11px] font-medium max-w-[180px] text-right">{selectedTransaction.description}</span>
                    </div>
                  )}
                  {selectedTransaction.direction === 'out' && selectedTransaction.category && (
                    <div className="flex justify-between">
                      <span className="text-[11px] text-muted-foreground">Category</span>
                      <span className="text-[11px] font-medium">{selectedTransaction.category}</span>
                    </div>
                  )}
                  {selectedTransaction.mileage && (
                    <div className="flex justify-between">
                      <span className="text-[11px] text-muted-foreground">Mileage</span>
                      <span className="text-[11px] font-medium">{selectedTransaction.mileage} miles</span>
                    </div>
                  )}
                  {selectedTransaction.notes && (
                    <div className="pt-2 border-t">
                      <p className="text-[11px] text-muted-foreground mb-1">Notes</p>
                      <p className="text-[11px] whitespace-pre-wrap">{selectedTransaction.notes}</p>
                    </div>
                  )}
                  <div className="pt-2 border-t">
                    <p className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                      <Paperclip className="w-3 h-3" /> Receipts &amp; Documents
                    </p>
                    <AttachmentManager
                      organizationId={organizationId}
                      entityType="gig_financial"
                      entityId={selectedTransaction.id}
                      title=""
                      allowUpload={isAdmin}
                      onAttachmentsChange={loadData}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-1 py-1">
                {sortedFinancials.map((fin) => {
                  const isRevenue = fin.direction === 'in';
                  const isCost = fin.direction === 'out';
                  return (
                    <button
                      key={fin.id}
                      className="w-full flex items-center justify-between px-2 py-2 rounded-md hover:bg-muted/50 text-left transition-colors"
                      onClick={() => setSelectedTransaction(fin)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn(
                          "p-1.5 rounded-md shrink-0",
                          isRevenue ? "bg-green-100 text-green-700" : isCost ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"
                        )}>
                          {isRevenue ? <DollarSign className="w-3 h-3" /> : isCost ? <Receipt className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold truncate">{rowName(fin)}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {stageText(fin, gigEnd)} · {fin.date ? format(parseISO(fin.date), 'MMM d, yyyy') : '—'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {fin.attachment_count > 0 && (
                          <Paperclip className="w-3 h-3 text-muted-foreground" />
                        )}
                        <span className={cn(
                          "text-[11px] font-bold",
                          isRevenue ? "text-green-600" : isCost ? "text-amber-600" : ""
                        )}>
                          {isRevenue ? '+' : isCost ? '-' : ''}{formatCurrency(fin.stage === 'paid' ? settledAmount(fin) : Number(fin.amount ?? 0))}
                        </span>
                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
