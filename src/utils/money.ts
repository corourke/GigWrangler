/** An amount rounded to whole cents. Sums of stored amounts go through this (B16). */
export const money = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100 || 0;
