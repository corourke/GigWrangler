import { addDays, subDays } from 'date-fns';

export type FutureDateKey = 'none' | 'future-7' | 'future-14' | 'future-30' | 'future-all';
export type PastDateKey = 'none' | 'past-7' | 'past-14' | 'past-30' | 'past-all';

export const FUTURE_FILTER_LABEL: Record<FutureDateKey, string> = {
  none: '',
  'future-7': '+7d',
  'future-14': '+14d',
  'future-30': '+30d',
  'future-all': 'All',
};

export const PAST_FILTER_LABEL: Record<PastDateKey, string> = {
  none: '',
  'past-7': '-7d',
  'past-14': '-14d',
  'past-30': '-30d',
  'past-all': 'All',
};

export const DATE_FILTER_FUTURE: { key: FutureDateKey; label: string }[] = [
  { key: 'future-7', label: '+7d' },
  { key: 'future-14', label: '+14d' },
  { key: 'future-30', label: '+30d' },
  { key: 'future-all', label: 'All' },
];

export const DATE_FILTER_PAST: { key: PastDateKey; label: string }[] = [
  { key: 'past-7', label: '-7d' },
  { key: 'past-14', label: '-14d' },
  { key: 'past-30', label: '-30d' },
  { key: 'past-all', label: 'All' },
];

export function applyDateFilter<T extends { start: string }>(
  items: T[],
  futureDateFilter: FutureDateKey,
  pastDateFilter: PastDateKey,
): T[] {
  if (futureDateFilter === 'none' && pastDateFilter === 'none') return items;
  const now = new Date();
  const future7 = futureDateFilter === 'future-7' ? addDays(now, 7) : null;
  const future14 = futureDateFilter === 'future-14' ? addDays(now, 14) : null;
  const future30 = futureDateFilter === 'future-30' ? addDays(now, 30) : null;
  const past7 = pastDateFilter === 'past-7' ? subDays(now, 7) : null;
  const past14 = pastDateFilter === 'past-14' ? subDays(now, 14) : null;
  const past30 = pastDateFilter === 'past-30' ? subDays(now, 30) : null;
  return items.filter((g) => {
    const start = new Date(g.start);
    const matchesFuture =
      futureDateFilter === 'none' ? false :
      future7 ? start >= now && start <= future7 :
      future14 ? start >= now && start <= future14 :
      future30 ? start >= now && start <= future30 :
      start >= now;
    const matchesPast =
      pastDateFilter === 'none' ? false :
      past7 ? start < now && start >= past7 :
      past14 ? start < now && start >= past14 :
      past30 ? start < now && start >= past30 :
      start < now;
    return matchesFuture || matchesPast;
  });
}
