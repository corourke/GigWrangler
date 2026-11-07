// Who may scan invoices and how often, kept free of Deno imports so Vitest can test them.

/** Scans one person may start in any trailing hour. */
export const SCANS_PER_USER_PER_HOUR = 60;
/** Scans one organization may run in any trailing 24 hours. */
export const SCANS_PER_ORG_PER_DAY = 200;

/** Invoice scanning is for an organization's Admins and Managers. */
export function canScanInvoices(role: string | null | undefined): boolean {
  return role === 'Admin' || role === 'Manager';
}

/** Why a scan can't start now, or null if it can. The organization's daily limit is reported first. */
export function scanLimitError(usage: { userScansLastHour: number; orgScansLastDay: number }): string | null {
  if (usage.orgScansLastDay >= SCANS_PER_ORG_PER_DAY) {
    return `Daily scan limit reached for this organization (${SCANS_PER_ORG_PER_DAY} a day). Try again tomorrow.`;
  }
  if (usage.userScansLastHour >= SCANS_PER_USER_PER_HOUR) {
    return `Scan limit reached (${SCANS_PER_USER_PER_HOUR}/hour). Try again later.`;
  }
  return null;
}

/** What the caller sees when a scan fails unexpectedly: the details go to the logs under the reference. */
export function scanFailure(reference: string): { status: number; body: Record<string, unknown> } {
  return { status: 500, body: { error: `The scan failed. Reference: ${reference}` } };
}
