/**
 * Line costs in cents that add up to the invoice total (B8), as the CSV importer does
 * (applyCostAllocation): each line is rounded to the cent, and the last line takes the
 * rounding pennies. Only rounding residue moves (at most half a cent a line); a real
 * difference stays, for the dialog's mismatch warning to show.
 */
export function reconcileLineCosts(costs: number[], total: number): number[] {
  const cents = costs.map((c) => Math.round((Number(c) || 0) * 100) / 100);
  if (!(total > 0) || cents.length === 0) return cents;
  const sum = cents.reduce((s, c) => s + c, 0);
  const difference = Math.round((total - sum) * 100) / 100;
  if (difference !== 0 && Math.abs(difference) <= 0.005 * cents.length + 1e-9) {
    const last = cents.length - 1;
    cents[last] = Math.round((cents[last] + difference) * 100) / 100;
  }
  return cents;
}
