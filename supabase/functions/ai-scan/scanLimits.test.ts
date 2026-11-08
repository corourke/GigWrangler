import { describe, it, expect } from 'vitest';
import {
  canScanInvoices,
  scanLimitError,
  scanFailure,
  SCANS_PER_USER_PER_HOUR,
  SCANS_PER_ORG_PER_DAY,
} from './scanLimits';

describe('who may scan invoices', () => {
  it('Admins and Managers of the organization', () => {
    expect(canScanInvoices('Admin')).toBe(true);
    expect(canScanInvoices('Manager')).toBe(true);
  });
  it('not Staff, Viewers or non-members', () => {
    expect(canScanInvoices('Staff')).toBe(false);
    expect(canScanInvoices('Viewer')).toBe(false);
    expect(canScanInvoices(null)).toBe(false);
    expect(canScanInvoices(undefined)).toBe(false);
  });
});

describe('scan limits', () => {
  it('are 60 a person an hour and 200 an organization a day', () => {
    expect(SCANS_PER_USER_PER_HOUR).toBe(60);
    expect(SCANS_PER_ORG_PER_DAY).toBe(200);
  });

  it('allow a scan under both limits', () => {
    expect(scanLimitError({ userScansLastHour: 59, orgScansLastDay: 199 })).toBeNull();
  });

  it('stop a person at the hourly limit', () => {
    expect(scanLimitError({ userScansLastHour: 60, orgScansLastDay: 0 }))
      .toBe('Scan limit reached (60/hour). Try again later.');
  });

  // A rolling 24 hours, not a calendar day: "tomorrow" would be wrong.
  it('stop the organization at its limit for the last 24 hours, with its own message', () => {
    expect(scanLimitError({ userScansLastHour: 0, orgScansLastDay: 200 }))
      .toBe('Scan limit reached for this organization (200 scans in the last 24 hours). Try again later.');
    expect(scanLimitError({ userScansLastHour: 60, orgScansLastDay: 250 }))
      .toBe('Scan limit reached for this organization (200 scans in the last 24 hours). Try again later.');
  });
});

describe('scan failures', () => {
  it('report a generic message with a reference, never the underlying error', () => {
    const failure = scanFailure('ref-123');
    expect(failure).toEqual({ status: 500, body: { error: 'The scan failed. Reference: ref-123' } });
  });
});
