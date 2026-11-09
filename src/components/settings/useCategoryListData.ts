import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys, invalidateAfterCategoryChange } from '../../lib/queryKeys';
import {
  getCategoryUsage,
  getScheduleCLines,
  listCategories,
  type CategoryKind,
  type CategoryRow,
  type ScheduleCLine,
} from '../../services/purchaseCategory.service';

const NO_LINES: ScheduleCLine[] = [];
const NO_ROWS: CategoryRow[] = [];

/**
 * One category list in Settings (A10): its rows, the Schedule C lines (expense lists) and how
 * many records use each name (an organization's lists). Keyed by kind and organization, so a late
 * answer for another list never shows. setRows changes the cached rows, for optimistic edits.
 */
export function useCategoryListData(kind: CategoryKind, organizationId: string | null) {
  const queryClient = useQueryClient();
  const isExpense = kind === 'expense';
  const listKey = useMemo(() => queryKeys.categoryList(kind, organizationId), [kind, organizationId]);

  const list = useQuery({ queryKey: listKey, queryFn: () => listCategories(kind, organizationId), staleTime: 0 });
  useEffect(() => {
    if (!list.error) return;
    console.error(list.error);
    toast.error('Failed to load categories');
  }, [list.error]);

  // Secondary reads: a failure shows no lines or no use, as before.
  const lines = useQuery({ queryKey: queryKeys.scheduleCLines(), queryFn: getScheduleCLines, enabled: isExpense, staleTime: 0 });
  const usage = useQuery({
    queryKey: queryKeys.categoryUsage(kind, organizationId ?? ''),
    queryFn: () => getCategoryUsage(kind, organizationId as string),
    enabled: !!organizationId,
    staleTime: 0,
  });

  const setRows = useCallback(
    (fn: (rows: CategoryRow[]) => CategoryRow[]) => queryClient.setQueryData<CategoryRow[]>(listKey, (old) => fn(old ?? NO_ROWS)),
    [queryClient, listKey],
  );
  /** After a change written into this list's cache: the other category lists and pickers refresh. */
  const afterCategoryChange = useCallback(
    () => invalidateAfterCategoryChange(queryClient, { organizationId }, { keepList: listKey }),
    [queryClient, organizationId, listKey],
  );
  const { refetch } = list;
  const reload = useCallback(() => { void refetch(); }, [refetch]);

  return useMemo(() => ({
    /** null while loading; a failed load shows an empty list, as before. */
    rows: list.isError ? NO_ROWS : (list.data ?? null),
    lines: lines.data ?? NO_LINES,
    usage: usage.data ?? null,
    isLoading: list.isPending && !list.isError,
    error: list.error ? 'Failed to load categories' : null,
    reload,
    setRows,
    afterCategoryChange,
  }), [list.data, list.isError, list.isPending, list.error, lines.data, usage.data, reload, setRows, afterCategoryChange]);
}
