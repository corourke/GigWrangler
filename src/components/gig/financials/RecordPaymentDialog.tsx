import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group';
import { stageLabel } from '../../../utils/moneyFlow';
import type { DbGigFinancial } from '../../../utils/supabase/types';
import { formatMoney } from './format';

export interface RecordPaymentValues {
  amount: number;
  paid_at: string;
  remainder: 'split' | 'settle';
  reference_number: string;
}

interface RecordPaymentDialogProps {
  row: DbGigFinancial | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (row: DbGigFinancial, values: RecordPaymentValues) => Promise<void>;
}

/**
 * Record money against a row. Less than agreed asks what the rest is: still
 * owed (split into its own row) or not coming (settle for less).
 */
export default function RecordPaymentDialog({ row, onOpenChange, onSubmit }: RecordPaymentDialogProps) {
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reference, setReference] = useState('');
  const [remainder, setRemainder] = useState<'split' | 'settle'>('split');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    setAmount(row.amount != null ? String(row.amount) : '');
    setPaidOn(format(new Date(), 'yyyy-MM-dd'));
    setReference(row.reference_number ?? '');
    setRemainder('split');
    setError(null);
  }, [row]);

  if (!row) return null;

  const agreed = Number(row.amount ?? 0);
  const value = parseFloat(amount);
  const valid = Number.isFinite(value) && value > 0;
  const short = valid ? Math.round((agreed - value) * 100) / 100 : 0;
  const isIn = row.direction === 'in';
  const name = row.description || (isIn ? 'Money in' : 'Money out');

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(row, { amount: value, paid_at: paidOn, remainder, reference_number: reference });
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || 'The payment could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{isIn ? 'Record payment received' : 'Record payment made'}</DialogTitle>
          <DialogDescription>
            {name} · {stageLabel(row.direction, row.stage)}
            {row.due_date ? `, due ${format(new Date(`${row.due_date}T12:00:00`), 'MMM d')}` : ''} · {formatMoney(agreed, row.currency)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="rp-amount">{isIn ? 'Amount received' : 'Amount paid'}</Label>
            <Input id="rp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rp-date">{isIn ? 'Date received' : 'Date paid'}</Label>
            <Input id="rp-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="rp-ref">Reference (check #, transaction id)</Label>
          <Input id="rp-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
        </div>

        {short > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-md px-3 py-2 w-full mb-2">
              {formatMoney(value, row.currency)} is less than the {formatMoney(agreed, row.currency)} agreed. What is the
              other {formatMoney(short, row.currency)}?
            </legend>
            <RadioGroup value={remainder} onValueChange={(v) => setRemainder(v as 'split' | 'settle')}>
              <label htmlFor="rp-split" className="flex gap-3 items-start border rounded-md p-3 cursor-pointer has-[button[data-state=checked]]:border-sky-700">
                <RadioGroupItem value="split" id="rp-split" className="mt-0.5" />
                <span>
                  <span className="font-medium">Still owed: split it into its own row</span>
                  <span className="block text-sm text-muted-foreground">
                    Keeps stage {stageLabel(row.direction, row.stage)}
                    {row.due_date ? ' and its due date' : ''}.
                  </span>
                </span>
              </label>
              <label htmlFor="rp-settle" className="flex gap-3 items-start border rounded-md p-3 cursor-pointer has-[button[data-state=checked]]:border-sky-700">
                <RadioGroupItem value="settle" id="rp-settle" className="mt-0.5" />
                <span>
                  <span className="font-medium">Not coming: settle for {formatMoney(value, row.currency)}</span>
                  <span className="block text-sm text-muted-foreground">The agreed amount drops; History keeps the change.</span>
                </span>
              </label>
            </RadioGroup>
          </fieldset>
        )}

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!valid || saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
