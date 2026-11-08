import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { 
  FileText, 
  DollarSign, 
  Receipt, 
  MoreHorizontal, 
  Car, 
  Calculator,
  Loader2
} from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { createGigFinancial, recordGigFinancialPayment } from '../../services/gig.service';
import { uploadAttachment, linkAttachmentToEntity } from '../../services/attachment.service';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { FinCategory, UserRole } from '../../utils/supabase/types';
import type { DbGigFinancial } from '../../utils/supabase/types';
import { STAGE_LABELS, stageLabel, stagePickerLabel, toDateKey } from '../../utils/moneyFlow';
import { formatMoney } from './financials/format';
import { calculateMileageAmount, formatMileageNotes, getMileageRateForDate } from '../../utils/financials.utils';
import { lockedYearMessage } from '../../utils/taxTreatment';
import { ATTACHMENT_FILE_ACCEPT } from '../../utils/fileAccept';

const commonSchema = {
  date: z.string().min(1, 'Date is required'),
  description: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  counterparty_id: z.string().optional().default(''),
  external_entity_name: z.string().optional().default(''),
};

const agreementSchema = z.object({
  ...commonSchema,
  amount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, 'Amount must be positive'),
  stage: z.enum(['quoted', 'accepted', 'contract_sent', 'contracted', 'invoiced']),
  due_date: z.string().optional().default(''),
});

// Where a fee can start; paid is recorded with Payment received.
const FEE_STAGES = ['quoted', 'accepted', 'contract_sent', 'contracted', 'invoiced'] as const;

const paymentSchema = z.object({
  ...commonSchema,
  amount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, 'Amount must be positive'),
  paid_at: z.string().min(1, 'Payment date is required'),
  reference_number: z.string().optional().default(''),
});

const mileageSchema = z.object({
  ...commonSchema,
  date: z.string().min(1, 'Date is required'),
  distance: z.string().optional(),
  start_odometer: z.string().optional(),
  end_odometer: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
});

const expenseSchema = z.object({
  ...commonSchema,
  amount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, 'Amount must be positive'),
  category: z.string().min(1, 'Category is required'),
  paid: z.boolean().optional().default(false),
});

interface QuickActionButtonsProps {
  gigId: string;
  organizationId: string;
  onSuccess: () => void;
  onOther?: () => void;
  userRole?: UserRole;
  gigStartDate?: string;
  /** The gig's money rows; an open booking among them is what Payment received pays off. */
  financials?: DbGigFinancial[];
}

const SEPARATE = 'separate';

function bookingLabel(row: DbGigFinancial): string {
  return `${row.description || 'Booking'} · ${stageLabel(row.direction, row.stage)} · ${formatMoney(row.amount, row.currency)}`;
}

export default function QuickActionButtons({
  gigId,
  organizationId,
  onSuccess,
  onOther,
  gigStartDate,
  financials = [],
}: QuickActionButtonsProps) {
  const [activeModal, setActiveModal] = useState<'agreement' | 'payment' | 'expense' | 'mileage' | 'simple_expense' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Payment received: which open booking it pays off (or SEPARATE), and, when
  // less than the booking arrives, whether the rest is still owed or not coming.
  const [applyTo, setApplyTo] = useState<string>(SEPARATE);
  const [remainder, setRemainder] = useState<'split' | 'settle'>('split');

  const openBookings = financials
    .filter((r) => r.direction === 'in' && (FEE_STAGES as readonly string[]).includes(r.stage))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const booking = openBookings.find((r) => r.id === applyTo) ?? null;

  const defaultDate = gigStartDate ?? format(new Date(), 'yyyy-MM-dd');

  const agreementForm = useForm<z.input<typeof agreementSchema>, any, z.output<typeof agreementSchema>>({
    resolver: zodResolver(agreementSchema),
    defaultValues: {
      date: defaultDate,
      stage: 'accepted',
      due_date: '',
      amount: '',
      description: '',
      notes: '',
    }
  });

  const paymentForm = useForm<z.input<typeof paymentSchema>, any, z.output<typeof paymentSchema>>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      date: defaultDate,
      paid_at: defaultDate,
      amount: '',
      description: '',
      reference_number: '',
    }
  });

  const mileageForm = useForm<z.input<typeof mileageSchema>, any, z.output<typeof mileageSchema>>({
    resolver: zodResolver(mileageSchema),
    defaultValues: {
      date: defaultDate,
      distance: '',
      start_odometer: '',
      end_odometer: '',
      description: 'Travel to/from gig',
    }
  });

  const expenseForm = useForm<z.input<typeof expenseSchema>, any, z.output<typeof expenseSchema>>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: defaultDate,
      amount: '',
      category: 'Other expenses',
      description: '',
      paid: false,
    }
  });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const payAmount = useWatch({ control: paymentForm.control, name: 'amount' });
  const payValue = parseFloat(payAmount || '');
  const shortBy = booking && Number.isFinite(payValue) && payValue > 0
    ? Math.round((Number(booking.amount ?? 0) - payValue) * 100) / 100
    : 0;

  const chooseBooking = (id: string) => {
    setApplyTo(id);
    setRemainder('split');
    const row = openBookings.find((r) => r.id === id);
    paymentForm.setValue('amount', row?.amount != null ? String(row.amount) : '');
  };

  const milDistance = useWatch({ control: mileageForm.control, name: 'distance' });
  const milStart = useWatch({ control: mileageForm.control, name: 'start_odometer' });
  const milEnd = useWatch({ control: mileageForm.control, name: 'end_odometer' });
  const milDate = useWatch({ control: mileageForm.control, name: 'date' });

  const computedDistance = (() => {
    const d = parseFloat(milDistance || '0');
    if (d > 0) return d;
    const s = parseFloat(milStart || '0');
    const e = parseFloat(milEnd || '0');
    if (e > s) return e - s;
    return 0;
  })();

  const computedDate = milDate || format(new Date(), 'yyyy-MM-dd');
  const computedRate = getMileageRateForDate(computedDate);
  const computedAmount = computedDistance > 0 ? calculateMileageAmount(computedDistance, computedDate) : 0;

  const handleClose = () => {
    setActiveModal(null);
    setShowAdvanced(false);
    agreementForm.reset({ ...agreementForm.formState.defaultValues, date: defaultDate });
    paymentForm.reset({ ...paymentForm.formState.defaultValues, date: defaultDate, paid_at: defaultDate });
    mileageForm.reset({ ...mileageForm.formState.defaultValues, date: defaultDate });
    expenseForm.reset({ ...expenseForm.formState.defaultValues, date: defaultDate });
    setReceiptFile(null);
  };

  const openModal = (modal: 'agreement' | 'payment' | 'expense' | 'mileage' | 'simple_expense') => {
    setShowAdvanced(false);
    if (modal === 'payment') chooseBooking(openBookings[0]?.id ?? SEPARATE);
    setActiveModal(modal);
  };

  const onAgreementSubmit = async (data: z.infer<typeof agreementSchema>) => {
    setIsSubmitting(true);
    try {
      await createGigFinancial({
        gig_id: gigId,
        organization_id: organizationId,
        direction: 'in',
        stage: data.stage,
        amount: parseFloat(data.amount),
        date: data.date,
        due_date: data.due_date || null,
        description: data.description || 'Income',
        notes: data.notes,
        counterparty_id: data.counterparty_id || undefined,
        external_entity_name: data.external_entity_name,
      });
      toast.success(`Booking recorded (${STAGE_LABELS.in[data.stage]})`);
      onSuccess();
      handleClose();
    } catch (error) {
      console.error('Error saving agreement:', error);
      toast.error(lockedYearMessage(error) ?? 'Failed to save agreement');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onPaymentSubmit = async (data: z.infer<typeof paymentSchema>) => {
    if (booking) {
      const amount = parseFloat(data.amount);
      if (!(amount > 0)) {
        paymentForm.setError('amount', { message: 'Enter the amount received' });
        return;
      }
      setIsSubmitting(true);
      try {
        const { remainder: rest } = await recordGigFinancialPayment(booking, {
          amount,
          paid_at: data.paid_at,
          remainder,
          reference_number: data.reference_number,
        });
        toast.success(rest ? `Payment recorded; ${formatMoney(rest.amount)} still owed` : 'Payment recorded');
        onSuccess();
        handleClose();
      } catch (error) {
        console.error('Error saving payment:', error);
        toast.error(lockedYearMessage(error) ?? 'Failed to save payment');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    setIsSubmitting(true);
    try {
      await createGigFinancial({
        gig_id: gigId,
        organization_id: organizationId,
        direction: 'in',
        stage: 'paid',
        amount: parseFloat(data.amount),
        amount_settled: parseFloat(data.amount),
        date: data.date,
        paid_at: data.paid_at,
        reference_number: data.reference_number,
        description: data.description,
        notes: data.notes,
        counterparty_id: data.counterparty_id || undefined,
        external_entity_name: data.external_entity_name,
      });
      toast.success('Payment recorded');
      onSuccess();
      handleClose();
    } catch (error) {
      console.error('Error saving payment:', error);
      toast.error(lockedYearMessage(error) ?? 'Failed to save payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onMileageSubmit = async (data: z.infer<typeof mileageSchema>) => {
    setIsSubmitting(true);
    try {
      const distance = computedDistance;

      if (distance <= 0) {
        toast.error('Distance must be greater than zero');
        setIsSubmitting(false);
        return;
      }

      const amount = calculateMileageAmount(distance, data.date);
      const rate = getMileageRateForDate(data.date);
      const autoNotes = formatMileageNotes(distance, rate);
      const combinedNotes = data.notes ? `${autoNotes}\n\n${data.notes}` : autoNotes;

      await createGigFinancial({
        gig_id: gigId,
        organization_id: organizationId,
        direction: 'out',
        stage: 'paid',
        category: 'Car and truck expenses',
        amount,
        mileage: distance,
        date: data.date,
        paid_at: data.date,
        description: data.description,
        notes: combinedNotes,
        counterparty_id: data.counterparty_id || undefined,
        external_entity_name: data.external_entity_name,
      });
      toast.success('Mileage recorded');
      onSuccess();
      handleClose();
    } catch (error) {
      console.error('Error saving mileage:', error);
      toast.error(lockedYearMessage(error) ?? 'Failed to save mileage');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onExpenseSubmit = async (data: z.infer<typeof expenseSchema>) => {
    setIsSubmitting(true);
    try {
      const created = await createGigFinancial({
        gig_id: gigId,
        organization_id: organizationId,
        direction: 'out',
        // Not yet paid: owed until marked paid.
        stage: data.paid ? 'paid' : 'invoiced',
        category: data.category as FinCategory,
        amount: parseFloat(data.amount),
        date: data.date,
        description: data.description,
        notes: data.notes,
        counterparty_id: data.counterparty_id || undefined,
        external_entity_name: data.external_entity_name,
        paid_at: data.paid ? toDateKey(new Date()) : undefined, // today, as a calendar day (B1)
      });

      if (receiptFile && (created as any)?.id) {
        try {
          const attachment = await uploadAttachment(organizationId, receiptFile);
          if (attachment) {
            await linkAttachmentToEntity(attachment.id, 'gig_financial', (created as any).id);
          }
        } catch (uploadErr) {
          console.error('Error uploading expense receipt:', uploadErr);
          toast.error('Expense saved, but the receipt upload failed — attach it from the expense row.');
        }
      }

      toast.success('Expense recorded');
      onSuccess();
      handleClose();
    } catch (error) {
      console.error('Error saving expense:', error);
      toast.error(lockedYearMessage(error) ?? 'Failed to save expense');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => openModal('agreement')} className="flex items-center gap-2">
        <FileText className="h-4 w-4" />
        Booking
      </Button>
      <Button variant="outline" size="sm" onClick={() => openModal('payment')} className="flex items-center gap-2">
        <DollarSign className="h-4 w-4" />
        Payment received
      </Button>
      <Button variant="outline" size="sm" onClick={() => openModal('expense')} className="flex items-center gap-2">
        <Receipt className="h-4 w-4" />
        Expense / Mileage
      </Button>
      {onOther && (
        <Button variant="ghost" size="sm" onClick={onOther} className="flex items-center gap-2">
          <MoreHorizontal className="h-4 w-4" />
          Other
        </Button>
      )}

      {/* Agreement Modal */}
      <Dialog open={activeModal === 'agreement'} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add a booking</DialogTitle>
            <DialogDescription>Gig income, and deal stage</DialogDescription>
          </DialogHeader>
          <form onSubmit={agreementForm.handleSubmit(onAgreementSubmit)} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ag-stage">Stage</Label>
                <Select
                  value={agreementForm.watch('stage')}
                  onValueChange={(v) => agreementForm.setValue('stage', v as any)}
                >
                  <SelectTrigger id="ag-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FEE_STAGES.map((st) => (
                      <SelectItem key={st} value={st}>{stagePickerLabel('in', st)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ag-date">Date</Label>
                <Input id="ag-date" type="date" {...agreementForm.register('date')} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-amount">Amount</Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input id="ag-amount" placeholder="0.00" className="pl-8" {...agreementForm.register('amount')} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-description">Description</Label>
              <Input id="ag-description" placeholder="e.g. Performance fee" {...agreementForm.register('description')} />
            </div>
            {agreementForm.watch('stage') === 'invoiced' && (
              <div className="space-y-2">
                <Label htmlFor="ag-due">Due date</Label>
                <Input id="ag-due" type="date" {...agreementForm.register('due_date')} />
              </div>
            )}

            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="ag-advanced"
                checked={showAdvanced}
                onCheckedChange={setShowAdvanced}
                className="data-[state=unchecked]:bg-input/60 data-[state=unchecked]:border-input"
              />
              <Label htmlFor="ag-advanced" className="text-sm text-muted-foreground">Show advanced fields</Label>
            </div>

            {showAdvanced && (
              <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-1">
                <div className="space-y-2">
                  <Label htmlFor="ag-external_entity_name">Counterparty Name (External)</Label>
                  <Input id="ag-external_entity_name" placeholder="e.g. Acme Corp" {...agreementForm.register('external_entity_name')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ag-notes">Internal Notes</Label>
                  <Textarea id="ag-notes" placeholder="Any extra details..." {...agreementForm.register('notes')} />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Booking
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Payment Modal */}
      <Dialog open={activeModal === 'payment'} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Payment received</DialogTitle>
            <DialogDescription>
              {openBookings.length > 0
                ? 'Money that has already arrived. Apply it to the booking it pays, or record it on its own.'
                : 'Money that has already arrived.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={paymentForm.handleSubmit(onPaymentSubmit)} className="space-y-4 py-4">
            {openBookings.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="pay-apply-to">Apply to</Label>
                <Select value={applyTo} onValueChange={chooseBooking}>
                  <SelectTrigger id="pay-apply-to">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {openBookings.map((row) => (
                      <SelectItem key={row.id} value={row.id}>{bookingLabel(row)}</SelectItem>
                    ))}
                    <SelectItem value={SEPARATE}>Separate payment (no booking)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pay-paid-date">Date received</Label>
                <Input id="pay-paid-date" type="date" {...paymentForm.register('paid_at')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-amount">Amount</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input id="pay-amount" placeholder="0.00" className="pl-8" {...paymentForm.register('amount')} />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-ref">Reference # (Check/Trans ID)</Label>
              <Input id="pay-ref" placeholder="Optional" {...paymentForm.register('reference_number')} />
            </div>
            {booking && shortBy > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-md px-3 py-2 w-full mb-2">
                  {formatMoney(payValue, booking.currency)} is less than the {formatMoney(booking.amount, booking.currency)} booked. What is the
                  other {formatMoney(shortBy, booking.currency)}?
                </legend>
                <RadioGroup value={remainder} onValueChange={(v) => setRemainder(v as 'split' | 'settle')}>
                  <label htmlFor="pay-split" className="flex gap-3 items-start border rounded-md p-3 cursor-pointer has-[button[data-state=checked]]:border-sky-700">
                    <RadioGroupItem value="split" id="pay-split" className="mt-0.5" />
                    <span className="text-sm font-medium">Still owed: split it into its own row</span>
                  </label>
                  <label htmlFor="pay-settle" className="flex gap-3 items-start border rounded-md p-3 cursor-pointer has-[button[data-state=checked]]:border-sky-700">
                    <RadioGroupItem value="settle" id="pay-settle" className="mt-0.5" />
                    <span className="text-sm font-medium">Not coming: settle for {formatMoney(payValue, booking.currency)}</span>
                  </label>
                </RadioGroup>
              </fieldset>
            )}

            {!booking && (<>
            <div className="space-y-2">
              <Label htmlFor="pay-description">Description</Label>
              <Input id="pay-description" placeholder="e.g. Deposit" {...paymentForm.register('description')} />
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="pay-advanced"
                checked={showAdvanced}
                onCheckedChange={setShowAdvanced}
                className="data-[state=unchecked]:bg-input/60 data-[state=unchecked]:border-input"
              />
              <Label htmlFor="pay-advanced" className="text-sm text-muted-foreground">Show advanced fields</Label>
            </div>

            {showAdvanced && (
              <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-1">
                <div className="space-y-2">
                  <Label htmlFor="pay-external_entity_name">Payer Name (External)</Label>
                  <Input id="pay-external_entity_name" placeholder="Who sent this?" {...paymentForm.register('external_entity_name')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay-notes">Internal Notes</Label>
                  <Textarea id="pay-notes" placeholder="Any extra details..." {...paymentForm.register('notes')} />
                </div>
              </div>
            )}
            </>)}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Expense / Mileage Choice Modal */}
      <Dialog open={activeModal === 'expense'} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Expense or Mileage?</DialogTitle>
            <DialogDescription>Choose which type of cost you want to record.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <Button 
              variant="outline" 
              className="h-32 flex flex-col gap-2 items-center justify-center border-2 hover:border-primary"
              onClick={() => openModal('mileage')}
            >
              <Car className="h-8 w-8 text-primary" />
              <div className="font-semibold">Mileage</div>
              <div className="text-xs text-muted-foreground text-center">Auto-calculate via IRS rate</div>
            </Button>
            <Button 
              variant="outline" 
              className="h-32 flex flex-col gap-2 items-center justify-center border-2 hover:border-primary"
              onClick={() => openModal('simple_expense')}
            >
              <Receipt className="h-8 w-8 text-primary" />
              <div className="font-semibold">Simple Expense</div>
              <div className="text-xs text-muted-foreground text-center">Manual amount & category</div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mileage Modal */}
      <Dialog open={activeModal === 'mileage'} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Record Mileage</DialogTitle>
            <DialogDescription>Record travel distance for IRS car/truck expense deduction.</DialogDescription>
          </DialogHeader>
          <form onSubmit={mileageForm.handleSubmit(onMileageSubmit)} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="mil-date">Date of Travel</Label>
              <Input id="mil-date" type="date" {...mileageForm.register('date')} />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Odometer</p>
                <div className="space-y-2">
                  <Label htmlFor="mil-start">Start</Label>
                  <Input id="mil-start" type="number" placeholder="e.g. 12000" {...mileageForm.register('start_odometer')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mil-end">End</Label>
                  <Input id="mil-end" type="number" placeholder="e.g. 12045" {...mileageForm.register('end_odometer')} />
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Or Direct Distance</p>
                <div className="space-y-2">
                  <Label htmlFor="mil-distance">Miles Driven</Label>
                  <div className="relative">
                    <Calculator className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input id="mil-distance" type="number" placeholder="0.0" className="pl-8" {...mileageForm.register('distance')} />
                  </div>
                </div>
                {computedDistance > 0 && (
                  <div className="rounded-md bg-sky-50 border border-sky-200 px-3 py-2 space-y-0.5">
                    <p className="text-[10px] text-sky-600 uppercase tracking-wider font-medium">Calculated</p>
                    <p className="text-sm font-bold text-sky-800">{computedDistance.toFixed(1)} miles</p>
                    <p className="text-xs text-sky-700">
                      @ ${computedRate}/mi = <span className="font-semibold">${computedAmount.toFixed(2)}</span>
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mil-description">Description</Label>
              <Input id="mil-description" placeholder="Where did you go?" {...mileageForm.register('description')} />
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="mil-advanced"
                checked={showAdvanced}
                onCheckedChange={setShowAdvanced}
                className="data-[state=unchecked]:bg-input/60 data-[state=unchecked]:border-input"
              />
              <Label htmlFor="mil-advanced" className="text-sm text-muted-foreground">Show advanced fields</Label>
            </div>

            {showAdvanced && (
              <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-1">
                <div className="space-y-2">
                  <Label htmlFor="mil-notes">Internal Notes</Label>
                  <Textarea id="mil-notes" placeholder="Any extra details..." {...mileageForm.register('notes')} />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Mileage
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Simple Expense Modal */}
      <Dialog open={activeModal === 'simple_expense'} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Record Simple Expense</DialogTitle>
            <DialogDescription>Record a manual expense incurred.</DialogDescription>
          </DialogHeader>
          <form onSubmit={expenseForm.handleSubmit(onExpenseSubmit)} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="exp-date">Date</Label>
                <Input id="exp-date" type="date" {...expenseForm.register('date')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp-amount">Amount</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input id="exp-amount" placeholder="0.00" className="pl-8" {...expenseForm.register('amount')} />
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="exp-category">Category</Label>
              <Select 
                value={expenseForm.watch('category')} 
                onValueChange={(v) => expenseForm.setValue('category', v as any)}
              >
                <SelectTrigger id="exp-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Advertising">Advertising</SelectItem>
                  <SelectItem value="Commissions and fees">Commissions and fees</SelectItem>
                  <SelectItem value="Contract labor">Contract labor</SelectItem>
                  <SelectItem value="Insurance">Insurance</SelectItem>
                  <SelectItem value="Legal and professional services">Legal and professional services</SelectItem>
                  <SelectItem value="Office expense">Office expense</SelectItem>
                  <SelectItem value="Rent or lease">Rent or lease</SelectItem>
                  <SelectItem value="Repairs and maintenance">Repairs and maintenance</SelectItem>
                  <SelectItem value="Supplies">Supplies</SelectItem>
                  <SelectItem value="Travel">Travel</SelectItem>
                  <SelectItem value="Meals">Meals</SelectItem>
                  <SelectItem value="Utilities">Utilities</SelectItem>
                  <SelectItem value="Other expenses">Other expenses</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exp-description">Description</Label>
              <Input id="exp-description" placeholder="What was this expense for?" {...expenseForm.register('description')} />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="exp-paid"
                checked={!!expenseForm.watch('paid')}
                onCheckedChange={(v) => expenseForm.setValue('paid', v)}
                className="data-[state=unchecked]:bg-input/60 data-[state=unchecked]:border-input"
              />
              <Label htmlFor="exp-paid" className="text-sm">Already paid</Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exp-receipt">Receipt (optional)</Label>
              <Input
                id="exp-receipt"
                type="file"
                accept={ATTACHMENT_FILE_ACCEPT}
                onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              />
              {receiptFile && (
                <p className="text-xs text-muted-foreground truncate">{receiptFile.name}</p>
              )}
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="exp-advanced"
                checked={showAdvanced}
                onCheckedChange={setShowAdvanced}
                className="data-[state=unchecked]:bg-input/60 data-[state=unchecked]:border-input"
              />
              <Label htmlFor="exp-advanced" className="text-sm text-muted-foreground">Show advanced fields</Label>
            </div>

            {showAdvanced && (
              <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-1">
                <div className="space-y-2">
                  <Label htmlFor="exp-external_entity_name">Vendor Name (External)</Label>
                  <Input id="exp-external_entity_name" placeholder="e.g. Home Depot" {...expenseForm.register('external_entity_name')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exp-notes">Internal Notes</Label>
                  <Textarea id="exp-notes" placeholder="Any extra details..." {...expenseForm.register('notes')} />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Expense
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
