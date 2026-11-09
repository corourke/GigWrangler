import { useState } from 'react';
import type { FutureDateKey, PastDateKey } from '../components/gigs/gigDateFilter';
import type { GigStatus } from '../utils/supabase/types';

const KEYS = {
  future: 'gigFilter.future',
  past: 'gigFilter.past',
  statuses: 'gigFilter.statuses',
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function useGigListFilters() {
  const [futureDateFilter, setFutureDateFilterRaw] = useState<FutureDateKey>(
    () => read<FutureDateKey>(KEYS.future, 'none')
  );
  const [pastDateFilter, setPastDateFilterRaw] = useState<PastDateKey>(
    () => read<PastDateKey>(KEYS.past, 'none')
  );
  const [activeStatuses, setActiveStatusesRaw] = useState<GigStatus[]>(
    () => read<GigStatus[]>(KEYS.statuses, [])
  );

  const setFutureDateFilter = (v: FutureDateKey) => {
    write(KEYS.future, v);
    setFutureDateFilterRaw(v);
  };

  const setPastDateFilter = (v: PastDateKey) => {
    write(KEYS.past, v);
    setPastDateFilterRaw(v);
  };

  const setActiveStatuses = (v: GigStatus[]) => {
    write(KEYS.statuses, v);
    setActiveStatusesRaw(v);
  };

  return {
    futureDateFilter,
    setFutureDateFilter,
    pastDateFilter,
    setPastDateFilter,
    activeStatuses,
    setActiveStatuses,
  };
}
