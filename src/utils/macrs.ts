/**
 * MACRS percentages (#337): IRS Publication 946 (2025), Appendix A, as printed, for the GDS
 * recovery periods on Form 4562 line 19a–f. Literal, not computed: the IRS rounds so each column adds
 * up to 100%, and a formula is off by a cent here and there (7-year half-year prints 8.93, 8.92, 8.93;
 * 7-year mid-quarter Q2 year 1 prints 17.85). Transcribed from the publication's PDF text; tests check
 * every column adds up to 100 and stays within a cent and a half of the formula.
 *
 * 15- and 20-year property is 150% declining balance, so it comes from the 150DB tables (A-14 to
 * A-18), not Tables A-1 to A-5. Those print the same columns, except A-2's 20-year year 2 reads 7.000
 * where A-15 and the formula give 7.008.
 */

export type RecoveryYears = 3 | 5 | 7 | 10 | 15 | 20;
export type MacrsMethod = '200DB' | '150DB' | 'SL';
export type MacrsConvention = 'HY' | 'MQ';
export type Quarter = 1 | 2 | 3 | 4;

export const RECOVERY_CLASSES: RecoveryYears[] = [3, 5, 7, 10, 15, 20];

export interface MacrsTable {
  title: string;
  method: MacrsMethod;
  convention: MacrsConvention;
  quarter: Quarter | null;
  /** Percent of basis for year 1, 2, …, by recovery period. A period the method doesn't use is absent. */
  rates: Partial<Record<RecoveryYears, number[]>>;
}

const key = (method: MacrsMethod, convention: MacrsConvention, quarter: Quarter | null) =>
  `${method}-${convention}${quarter ?? ''}`;

export const MACRS_TABLES: Record<string, MacrsTable> = {
  '200DB-HY': {
    title: 'Table A-1, half-year (200% DB)',
    method: '200DB', convention: 'HY', quarter: null,
    rates: {
      3: [33.33, 44.45, 14.81, 7.41],
      5: [20, 32, 19.2, 11.52, 11.52, 5.76],
      7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
      10: [10, 18, 14.4, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
    },
  },
  '200DB-MQ1': {
    title: 'Table A-2, mid-quarter, placed in service in quarter 1 (200% DB)',
    method: '200DB', convention: 'MQ', quarter: 1,
    rates: {
      3: [58.33, 27.78, 12.35, 1.54],
      5: [35, 26, 15.6, 11.01, 11.01, 1.38],
      7: [25, 21.43, 15.31, 10.93, 8.75, 8.74, 8.75, 1.09],
      10: [17.5, 16.5, 13.2, 10.56, 8.45, 6.76, 6.55, 6.55, 6.56, 6.55, 0.82],
    },
  },
  '200DB-MQ2': {
    title: 'Table A-3, mid-quarter, placed in service in quarter 2 (200% DB)',
    method: '200DB', convention: 'MQ', quarter: 2,
    rates: {
      3: [41.67, 38.89, 14.14, 5.3],
      5: [25, 30, 18, 11.37, 11.37, 4.26],
      7: [17.85, 23.47, 16.76, 11.97, 8.87, 8.87, 8.87, 3.34],
      10: [12.5, 17.5, 14, 11.2, 8.96, 7.17, 6.55, 6.55, 6.56, 6.55, 2.46],
    },
  },
  '200DB-MQ3': {
    title: 'Table A-4, mid-quarter, placed in service in quarter 3 (200% DB)',
    method: '200DB', convention: 'MQ', quarter: 3,
    rates: {
      3: [25, 50, 16.67, 8.33],
      5: [15, 34, 20.4, 12.24, 11.3, 7.06],
      7: [10.71, 25.51, 18.22, 13.02, 9.3, 8.85, 8.86, 5.53],
      10: [7.5, 18.5, 14.8, 11.84, 9.47, 7.58, 6.55, 6.55, 6.56, 6.55, 4.1],
    },
  },
  '200DB-MQ4': {
    title: 'Table A-5, mid-quarter, placed in service in quarter 4 (200% DB)',
    method: '200DB', convention: 'MQ', quarter: 4,
    rates: {
      3: [8.33, 61.11, 20.37, 10.19],
      5: [5, 38, 22.8, 13.68, 10.94, 9.58],
      7: [3.57, 27.55, 19.68, 14.06, 10.04, 8.73, 8.73, 7.64],
      10: [2.5, 19.5, 15.6, 12.48, 9.98, 7.99, 6.55, 6.55, 6.56, 6.55, 5.74],
    },
  },
  '150DB-HY': {
    title: 'Table A-14, 150% declining balance, half-year',
    method: '150DB', convention: 'HY', quarter: null,
    rates: {
      3: [25, 37.5, 25, 12.5],
      5: [15, 25.5, 17.85, 16.66, 16.66, 8.33],
      7: [10.71, 19.13, 15.03, 12.25, 12.25, 12.25, 12.25, 6.13],
      10: [7.5, 13.88, 11.79, 10.02, 8.74, 8.74, 8.74, 8.74, 8.74, 8.74, 4.37],
      15: [5, 9.5, 8.55, 7.7, 6.93, 6.23, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 2.95],
      20: [3.75, 7.219, 6.677, 6.177, 5.713, 5.285, 4.888, 4.522, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 2.231],
    },
  },
  '150DB-MQ1': {
    title: 'Table A-15, 150% declining balance, mid-quarter, quarter 1',
    method: '150DB', convention: 'MQ', quarter: 1,
    rates: {
      3: [43.75, 28.13, 25, 3.12],
      5: [26.25, 22.13, 16.52, 16.52, 16.52, 2.06],
      7: [18.75, 17.41, 13.68, 12.16, 12.16, 12.16, 12.16, 1.52],
      10: [13.13, 13.03, 11.08, 9.41, 8.71, 8.71, 8.71, 8.71, 8.71, 8.71, 1.09],
      15: [8.75, 9.13, 8.21, 7.39, 6.65, 5.99, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 0.74],
      20: [6.563, 7.008, 6.482, 5.996, 5.546, 5.13, 4.746, 4.459, 4.459, 4.459, 4.459, 4.46, 4.459, 4.46, 4.459, 4.46, 4.459, 4.46, 4.459, 4.46, 0.557],
    },
  },
  '150DB-MQ2': {
    title: 'Table A-16, 150% declining balance, mid-quarter, quarter 2',
    method: '150DB', convention: 'MQ', quarter: 2,
    rates: {
      3: [31.25, 34.38, 25, 9.37],
      5: [18.75, 24.38, 17.06, 16.76, 16.76, 6.29],
      7: [13.39, 18.56, 14.58, 12.22, 12.22, 12.22, 12.23, 4.58],
      10: [9.38, 13.59, 11.55, 9.82, 8.73, 8.73, 8.73, 8.73, 8.73, 8.73, 3.28],
      15: [6.25, 9.38, 8.44, 7.59, 6.83, 6.15, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 2.21],
      20: [4.688, 7.148, 6.612, 6.116, 5.658, 5.233, 4.841, 4.478, 4.463, 4.463, 4.463, 4.463, 4.463, 4.463, 4.462, 4.463, 4.462, 4.463, 4.462, 4.463, 1.673],
    },
  },
  '150DB-MQ3': {
    title: 'Table A-17, 150% declining balance, mid-quarter, quarter 3',
    method: '150DB', convention: 'MQ', quarter: 3,
    rates: {
      3: [18.75, 40.63, 25, 15.62],
      5: [11.25, 26.63, 18.64, 16.56, 16.57, 10.35],
      7: [8.04, 19.71, 15.48, 12.27, 12.28, 12.27, 12.28, 7.67],
      10: [5.63, 14.16, 12.03, 10.23, 8.75, 8.75, 8.75, 8.74, 8.75, 8.74, 5.47],
      15: [3.75, 9.63, 8.66, 7.8, 7.02, 6.31, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 3.69],
      20: [2.813, 7.289, 6.742, 6.237, 5.769, 5.336, 4.936, 4.566, 4.46, 4.46, 4.46, 4.46, 4.461, 4.46, 4.461, 4.46, 4.461, 4.46, 4.461, 4.46, 2.788],
    },
  },
  '150DB-MQ4': {
    title: 'Table A-18, 150% declining balance, mid-quarter, quarter 4',
    method: '150DB', convention: 'MQ', quarter: 4,
    rates: {
      3: [6.25, 46.88, 25, 21.87],
      5: [3.75, 28.88, 20.21, 16.4, 16.41, 14.35],
      7: [2.68, 20.85, 16.39, 12.87, 12.18, 12.18, 12.19, 10.66],
      10: [1.88, 14.72, 12.51, 10.63, 9.04, 8.72, 8.72, 8.72, 8.72, 8.71, 7.63],
      15: [1.25, 9.88, 8.89, 8, 7.2, 6.48, 5.9, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.17],
      20: [0.938, 7.43, 6.872, 6.357, 5.88, 5.439, 5.031, 4.654, 4.458, 4.458, 4.458, 4.458, 4.458, 4.458, 4.458, 4.458, 4.458, 4.459, 4.458, 4.459, 3.901],
    },
  },
  'SL-HY': {
    title: 'Table A-8, straight line, half-year',
    method: 'SL', convention: 'HY', quarter: null,
    rates: {
      3: [16.67, 33.33, 33.33, 16.67],
      5: [10, 20, 20, 20, 20, 10],
      7: [7.14, 14.29, 14.29, 14.28, 14.29, 14.28, 14.29, 7.14],
      10: [5, 10, 10, 10, 10, 10, 10, 10, 10, 10, 5],
      15: [3.33, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 6.67, 3.33],
      20: [2.5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 2.5],
    },
  },
  'SL-MQ1': {
    title: 'Table A-9, straight line, mid-quarter, quarter 1',
    method: 'SL', convention: 'MQ', quarter: 1,
    rates: {
      3: [29.17, 33.33, 33.33, 4.17],
      5: [17.5, 20, 20, 20, 20, 2.5],
      7: [12.5, 14.29, 14.28, 14.29, 14.28, 14.29, 14.28, 1.79],
      10: [8.75, 10, 10, 10, 10, 10, 10, 10, 10, 10, 1.25],
      15: [5.83, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 6.67, 0.83],
      20: [4.375, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0.625],
    },
  },
  'SL-MQ2': {
    title: 'Table A-10, straight line, mid-quarter, quarter 2',
    method: 'SL', convention: 'MQ', quarter: 2,
    rates: {
      3: [20.83, 33.33, 33.34, 12.5],
      5: [12.5, 20, 20, 20, 20, 7.5],
      7: [8.93, 14.29, 14.28, 14.29, 14.28, 14.29, 14.28, 5.36],
      10: [6.25, 10, 10, 10, 10, 10, 10, 10, 10, 10, 3.75],
      15: [4.17, 6.67, 6.67, 6.67, 6.67, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 2.5],
      20: [3.125, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 1.875],
    },
  },
  'SL-MQ3': {
    title: 'Table A-11, straight line, mid-quarter, quarter 3',
    method: 'SL', convention: 'MQ', quarter: 3,
    rates: {
      3: [12.5, 33.33, 33.34, 20.83],
      5: [7.5, 20, 20, 20, 20, 12.5],
      7: [5.36, 14.29, 14.28, 14.29, 14.28, 14.29, 14.28, 8.93],
      10: [3.75, 10, 10, 10, 10, 10, 10, 10, 10, 10, 6.25],
      15: [2.5, 6.67, 6.67, 6.67, 6.67, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 4.17],
      20: [1.875, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3.125],
    },
  },
  'SL-MQ4': {
    title: 'Table A-12, straight line, mid-quarter, quarter 4',
    method: 'SL', convention: 'MQ', quarter: 4,
    rates: {
      3: [4.17, 33.33, 33.33, 29.17],
      5: [2.5, 20, 20, 20, 20, 17.5],
      7: [1.79, 14.29, 14.28, 14.29, 14.28, 14.29, 14.28, 12.5],
      10: [1.25, 10, 10, 10, 10, 10, 10, 10, 10, 10, 8.75],
      15: [0.83, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 6.67, 6.66, 6.67, 5.83],
      20: [0.625, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4.375],
    },
  },
};

/**
 * The percent of basis deducted in a given year of recovery (1 = the year placed in service), or 0
 * before or after it. 200DB applies to 3- to 10-year property; 15- and 20-year property is 150DB.
 */
export function macrsRate(
  years: RecoveryYears,
  method: MacrsMethod,
  convention: MacrsConvention,
  quarter: Quarter | null,
  yearOfRecovery: number,
): number {
  const table = MACRS_TABLES[key(method, convention, convention === 'MQ' ? quarter : null)];
  const rates = table?.rates[years];
  if (!rates || yearOfRecovery < 1 || yearOfRecovery > rates.length) return 0;
  return rates[yearOfRecovery - 1];
}

/** The usual method for a recovery period: 200DB for 3 to 10 years, 150DB for 15 and 20. */
export const defaultMethod = (years: RecoveryYears): MacrsMethod => (years >= 15 ? '150DB' : '200DB');

