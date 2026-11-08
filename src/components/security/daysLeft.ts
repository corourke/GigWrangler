/** Whole days until a date, never below zero. */
export function daysLeft(until: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(until).getTime() - now.getTime()) / 86_400_000));
}
