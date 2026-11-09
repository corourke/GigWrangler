import { Loader2 } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../ui/alert-dialog';
import { mismatchesDecided } from './buildUpdatePlan';
import type { LineDecision, UpdatePlan } from './types';

/** Saving when the lines don't add up to the invoice total asks first (11-08). */
export function TotalsMismatchDialog({ open, onOpenChange, linesTotal, invoiceTotal, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linesTotal: number;
  invoiceTotal: number;
  onSave: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>The totals don't match</AlertDialogTitle>
          <AlertDialogDescription>
            The lines add up to ${linesTotal.toFixed(2)}, but the invoice total is ${Number(invoiceTotal || 0).toFixed(2)}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={() => { onOpenChange(false); onSave(); }}>Save anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const fmtVal = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/**
 * An edit that reaches linked records asks first: equipment whose line's quantity changed
 * (update it, choosing which units go and how, or leave it; #183), equipment fields and gig
 * ledger amounts.
 */
export function LinkedUpdatesDialog({ plan, lineDecisions, onDecide, isSubmitting, onCancel, onConfirm }: {
  plan: UpdatePlan;
  lineDecisions: Record<string, LineDecision>;
  onDecide: (lineId: string, decision: LineDecision) => void;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="linked-updates-title" style={{ background: 'white', borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.3)', width: 540, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <h3 id="linked-updates-title" style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Confirm linked record updates</h3>
          <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Your edits also affect these linked records. Review and confirm before saving.</p>
        </div>
        <div style={{ padding: '12px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {plan.mismatches.length > 0 && (
            <div>
              <h4 style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b45309', marginBottom: 6 }}>Quantity changed</h4>
              {plan.mismatches.map(m => {
                const d = lineDecisions[m.lineId];
                const have = m.records.reduce((n, r) => n + r.quantity, 0);
                const extra = have - m.quantity;
                const decide = (next: LineDecision) => onDecide(m.lineId, next);
                return (
                  <fieldset key={m.lineId} style={{ marginBottom: 8, border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 6, padding: '6px 8px' }}>
                    <legend style={{ fontSize: 11, fontWeight: 600, color: '#374151', padding: '0 4px' }}>{m.description}</legend>
                    <p style={{ fontSize: 11, color: '#92400e', marginBottom: 6 }}>
                      {m.kind === 'lot'
                        ? `The line is now ${m.quantity}; its lot is ${have}.`
                        : `The line is now ${m.quantity}; it has ${have} units.`}
                    </p>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                      <input type="radio" name={`mm-${m.lineId}`} checked={d?.mode === 'update'} onChange={() => decide({ mode: 'update', remove: [] })} />
                      {m.kind === 'lot' ? `Update the equipment: make the lot ${m.quantity}` : `Update the equipment: remove ${extra} ${extra === 1 ? 'unit' : 'units'}`}
                    </label>
                    {m.kind === 'units' && d?.mode === 'update' && (
                      <div role="group" aria-label={`Units to remove: ${m.description}`} style={{ margin: '4px 0 4px 22px', display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
                        {m.records.map(r => (
                          <label key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'monospace' }}>
                            <input type="checkbox" checked={d.remove.includes(r.id)}
                              onChange={e => decide({ ...d, remove: e.target.checked ? [...d.remove, r.id] : d.remove.filter(x => x !== r.id) })} />
                            {r.label}
                          </label>
                        ))}
                        <span style={{ fontSize: 10, color: '#92400e', width: '100%' }}>Tick {extra}.</span>
                      </div>
                    )}
                    {m.kind === 'units' && d?.mode === 'update' && d.remove.length > 0 && (
                      <div role="radiogroup" aria-label={`Removed units: ${m.description}`} style={{ margin: '2px 0 4px 22px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                          <input type="radio" name={`mm-how-${m.lineId}`} checked={d.how === 'delete'} onChange={() => decide({ ...d, how: 'delete' })} />
                          Delete them: their kits and scan history go with them
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                          <input type="radio" name={`mm-how-${m.lineId}`} checked={d.how === 'inactive'} onChange={() => decide({ ...d, how: 'inactive' })} />
                          Mark Inactive: kept, with their kits and scans, and no longer on this purchase
                        </label>
                      </div>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                      <input type="radio" name={`mm-${m.lineId}`} checked={d?.mode === 'leave'} onChange={() => decide({ mode: 'leave', remove: [] })} />
                      Leave the equipment as it is
                    </label>
                  </fieldset>
                );
              })}
            </div>
          )}
          {plan.assetChanges.length > 0 && (
            <div>
              <h4 style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#0284c7', marginBottom: 6 }}>Asset updates</h4>
              {plan.assetChanges.map((a, ai) => (
                <div key={ai} style={{ marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px' }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{a.itemDescription}</p>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <tbody>
                      {a.changes.map((c, ci) => (
                        <tr key={ci}>
                          <td style={{ color: '#6b7280', padding: '1px 6px 1px 0', whiteSpace: 'nowrap' }}>{c.label}</td>
                          <td style={{ color: '#9ca3af', padding: '1px 6px', textAlign: 'right' }}>{fmtVal(c.from)}</td>
                          <td style={{ color: '#9ca3af', padding: '1px 4px' }}>→</td>
                          <td style={{ color: '#065f46', fontWeight: 600, padding: '1px 0' }}>{fmtVal(c.to)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
          {plan.gigChanges.length > 0 && (
            <div>
              <h4 style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7c3aed', marginBottom: 6 }}>Gig ledger updates</h4>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <tbody>
                  {plan.gigChanges.map((g, gi) => (
                    <tr key={gi}>
                      <td style={{ color: '#6b7280', padding: '1px 6px 1px 0' }}>{g.label}</td>
                      <td style={{ color: '#9ca3af', padding: '1px 6px', textAlign: 'right' }}>${g.from.toFixed(2)}</td>
                      <td style={{ color: '#9ca3af', padding: '1px 4px' }}>→</td>
                      <td style={{ color: '#065f46', fontWeight: 600, padding: '1px 0' }}>${g.to.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting} className="h-7 px-4 text-xs">
            Cancel
          </Button>
          <button
            onClick={onConfirm}
            disabled={isSubmitting || !mismatchesDecided(plan, lineDecisions)}
            style={{ height: 28, padding: '0 16px', fontSize: 12, fontWeight: 600, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0284c7', color: 'white', border: 'none', cursor: 'pointer', opacity: isSubmitting || !mismatchesDecided(plan, lineDecisions) ? 0.5 : 1 }}
          >
            {isSubmitting && <Loader2 style={{ width: 14, height: 14, marginRight: 6 }} className="animate-spin" />}
            Confirm &amp; Save
          </button>
        </div>
      </div>
    </div>
  );
}
