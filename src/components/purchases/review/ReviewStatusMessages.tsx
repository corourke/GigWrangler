import { AlertCircle } from 'lucide-react';

/**
 * Under the lines: whether they add up to the invoice total (or the $0 total message, #226),
 * and what still blocks Save (an undecided treatment, a recovery period, units, a category).
 */
export function ReviewStatusMessages({
  missingTotal, hasMismatch, linesTotal, invoiceTotal, diff, onUseLinesTotal, undecided, noPeriod, noUnits, noEquipCategory,
}: {
  missingTotal: boolean;
  hasMismatch: boolean;
  linesTotal: number;
  invoiceTotal: number;
  diff: number;
  onUseLinesTotal: () => void;
  undecided: number;
  noPeriod: number;
  noUnits: number;
  noEquipCategory: number;
}) {
  return (
    <>
      {/* Reconciliation (the $0 total message below replaces it when the total is missing) */}
      {!missingTotal && (
      <div style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: `1px solid ${hasMismatch ? '#fde68a' : '#a7f3d0'}`, background: hasMismatch ? '#fffbeb' : '#ecfdf5', color: hasMismatch ? '#92400e' : '#065f46' }}>
        <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: hasMismatch ? '#f59e0b' : '#10b981' }} />
        <span>
          <strong>{hasMismatch ? 'Mismatch' : 'Reconciled'}:</strong>{' '}
          Line costs ${linesTotal.toFixed(2)} vs Invoice ${invoiceTotal.toFixed(2)}
          {hasMismatch && <span style={{ color: '#d97706' }}> (diff: ${diff.toFixed(2)})</span>}
        </span>
      </div>
      )}
      {missingTotal && (
        <div role="status" style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
          <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: '#f59e0b' }} />
          <span>Enter the invoice total, or set it to match the lines (${linesTotal.toFixed(2)}).</span>
          <button
            type="button"
            onClick={onUseLinesTotal}
            style={{ marginLeft: 'auto', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer' }}
          >
            Use ${linesTotal.toFixed(2)}
          </button>
        </div>
      )}
      {undecided > 0 && (
        <div role="status" style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
          <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: '#f59e0b' }} />
          <span>Choose Expense or Depreciate for {undecided} {undecided === 1 ? 'item' : 'items'} between $200 and $2,500 before saving.</span>
        </div>
      )}
      {noPeriod > 0 && (
        <div role="status" style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
          <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: '#f59e0b' }} />
          <span>Choose a recovery period for {noPeriod} depreciated {noPeriod === 1 ? 'item' : 'items'} before saving: click its Equipment details.</span>
        </div>
      )}
      {noUnits > 0 && (
        <div role="status" style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
          <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: '#f59e0b' }} />
          <span>Enter a serial number or tag for each unit of {noUnits} {noUnits === 1 ? 'item' : 'items'} before saving: click its Equipment details.</span>
        </div>
      )}
      {noEquipCategory > 0 && (
        <div role="status" style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
          <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: '#f59e0b' }} />
          <span>Choose an equipment category for {noEquipCategory} {noEquipCategory === 1 ? 'item' : 'items'} tracked as equipment before saving: click its amber Equipment switch.</span>
        </div>
      )}
    </>
  );
}
