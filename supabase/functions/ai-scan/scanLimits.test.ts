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

  it('stop the organization at the daily limit, with its own message', () => {
    expect(scanLimitError({ userScansLastHour: 0, orgScansLastDay: 200 }))
      .toBe('Daily scan limit reached for this organization (200 a day). Try again tomorrow.');
    expect(scanLimitError({ userScansLastHour: 60, orgScansLastDay: 250 }))
      .toBe('Daily scan limit reached for this organization (200 a day). Try again tomorrow.');
  });
});

describe('scan failures', () => {
  it('report a generic message with a reference, never the underlying error', () => {
    const failure = scanFailure('ref-123');
    expect(failure).toEqual({ status: 500, body: { error: 'The scan failed. Reference: ref-123' } });
  });
});
