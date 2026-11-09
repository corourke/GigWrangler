import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Filter,
  MoreHorizontal,
  Plus,
  Settings2,
  X,
  Search,
  Eye,
  Edit,
  Copy,
  Trash2,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../ui/utils';
import {useTableState } from '../../utils/hooks/useTableState';
import { EditableCell } from './EditableCell';

export type ColumnType = 'text' | 'number' | 'checkbox' | 'pill' | 'multi-pill' | 'select' | 'date' | 'datetime' | 'currency';

export interface RowAction<T> {
  id: 'view' | 'edit' | 'duplicate' | 'delete';
  label?: string;
  icon?: React.ReactNode;
  onClick: (row: T) => void;
  className?: string;
  disabled?: (row: T) => boolean;
  /** Leaves the action out of this row's menu. */
  hidden?: (row: T) => boolean;
  /**
   * Why the action can't be done on this row, or null. The item then shows greyed and
   * aria-disabled, and selecting it shows the reason in the menu instead of running it.
   * It isn't `disabled`, which would take no clicks or taps, leaving the reason out of reach on touch.
   */
  blockedReason?: (row: T) => string | null;
}

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessor: keyof T | ((row: T) => any);
  sortable?: boolean;
  filterable?: boolean;
  editable?: boolean;
  /** Per-row override for `editable`: returning false makes that row's cell read-only. */
  isEditable?: (row: T) => boolean;
  required?: boolean;
  optional?: boolean;
  readOnly?: boolean;
  type?: ColumnType;
  options?: { label: string; value: any }[];
  pillConfig?: Record<string, { label: string; color: string }>;
  timezone?: string | ((row: T) => string);
  /** For a datetime column: whether the row's value is a date (an all-day gig, A12). Without it, a 12:00 UTC value is. */
  allDay?: (row: T) => boolean;
  className?: string;
  render?: (value: any, row: T) => React.ReactNode;
  /**
   * Plain-value formatter for CSV/data export (e.g. `gigExport.ts`'s
   * `buildExportRows`). Falls back to `accessor` when omitted — set this when
   * the on-screen value needs different shaping for export (e.g. a raw ISO
   * timestamp accessor formatted to a plain export date).
   */
  exportValue?: (row: T) => string | number | null | undefined;
  /**
   * A click on this cell calls this instead of selecting it for inline
   * editing, and takes over the cell entirely — it fires on every click,
   * including the first click of a double-click, so there's no way to
   * distinguish "open" from "edit" here. Setting this makes the column a
   * pure navigation link; `editable` is ignored when this is set. Use for
   * a "click the title to open the row" affordance.
   */
  onCellClick?: (row: T) => void;
}

interface SmartDataTableProps<T extends { id: string }> {
  tableId: string;
  data: T[];
  columns: ColumnDef<T>[];
  onRowUpdate?: (id: string, updates: Partial<T>) => Promise<void>;
  onAddRow?: () => Promise<T>;
  onAddRowClick?: () => void;
  onFilteredDataChange?: (data: T[]) => void;
  /** Fires with the ids of the currently-visible columns, in display order, whenever column visibility changes. */
  onVisibleColumnsChange?: (columnIds: string[]) => void;
  actions?: (row: T) => React.ReactNode;
  rowActions?: RowAction<T>[];
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
}

export function SmartDataTable<T extends { id: string }>({
  tableId,
  data,
  columns,
  onRowUpdate,
  onAddRow,
  onAddRowClick,
  onFilteredDataChange,
  onVisibleColumnsChange,
  actions,
  rowActions,
  isLoading = false,
  emptyMessage = 'No data found',
  className,
  toolbarLeft,
  toolbarRight,
}: SmartDataTableProps<T>) {
  const {
    sorting,
    filters,
    columnVisibility,
    columnWidths,
    toggleSorting,
    setFilter,
    removeFilter,
    setColumnVisibility,
    setColumnWidth,
  } = useTableState(tableId);

  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set());
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [resizingWidths, setResizingWidths] = useState<Record<string, number>>({});

  const processedData = useMemo(() => {
    let result = [...data];

    Object.entries(filters).forEach(([columnId, filterValue]) => {
      if (!filterValue) return;

      const column = columns.find((c) => c.id === columnId);
      if (!column) return;

      result = result.filter((row) => {
        if (newRowIds.has(row.id)) return true;

        const val = typeof column.accessor === 'function' 
          ? column.accessor(row) 
          : row[column.accessor];
        
        if (val === null || val === undefined) return false;
        
        const searchStr = String(filterValue).toLowerCase();
        return String(val).toLowerCase().includes(searchStr);
      });
    });

    // Apply sorting
    if (sorting) {
      const column = columns.find((c) => c.id === sorting.columnId);
      if (column) {
        result.sort((a, b) => {
          const valA = typeof column.accessor === 'function' 
            ? column.accessor(a) 
            : a[column.accessor];
          const valB = typeof column.accessor === 'function' 
            ? column.accessor(b) 
            : b[column.accessor];

          if (valA === valB) return 0;
          if (valA === null || valA === undefined) return 1;
          if (valB === null || valB === undefined) return -1;

          const modifier = sorting.direction === 'asc' ? 1 : -1;
          
          if (typeof valA === 'string' && typeof valB === 'string') {
            return valA.localeCompare(valB) * modifier;
          }
          
          return (valA < valB ? -1 : 1) * modifier;
        });
      }
    }

    return result;
  }, [data, columns, sorting, filters, newRowIds]);

  // Notify parent of filtered data changes
  React.useEffect(() => {
    if (onFilteredDataChange) {
      onFilteredDataChange(processedData);
    }
  }, [processedData, onFilteredDataChange]);

  // Effective visibility of a column, resolving the tri-state stored value
  // (undefined = column default) against `optional`. Used both to build the
  // rendered columns and to drive the Columns-menu checkmark, so the two can't
  // drift out of sync.
  const isColumnVisible = useCallback((col: ColumnDef<T>) => {
    if (col.required) return true;
    if (columnVisibility[col.id] === false) return false;
    return !col.optional || columnVisibility[col.id] === true;
  }, [columnVisibility]);

  const visibleColumns = useMemo(
    () => columns.filter(isColumnVisible),
    [columns, isColumnVisible],
  );

  // Notify parent of visible-column changes (toggled via the Columns menu below).
  React.useEffect(() => {
    if (onVisibleColumnsChange) {
      onVisibleColumnsChange(visibleColumns.map((c) => c.id));
    }
  }, [visibleColumns, onVisibleColumnsChange]);

  // Selected cell state for blue outline
  const [selectedCell, setSelectedCell] = useState<{ rowId: string; colId: string } | null>(null);

  const handleCellSave = useCallback(async (rowId: string, columnId: string, newValue: any) => {
    if (onRowUpdate) {
      const column = columns.find(c => c.id === columnId);
      if (column) {
        const updateKey = typeof column.accessor === 'string' ? column.accessor : columnId;
        await onRowUpdate(rowId, { [updateKey]: newValue } as Partial<T>);
      }
    }
  }, [onRowUpdate, columns]);

  const handleCellSaveForNewRow = useCallback(async (rowId: string, columnId: string, newValue: any) => {
    await handleCellSave(rowId, columnId, newValue);
    setNewRowIds(prev => {
      if (!prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
  }, [handleCellSave]);

  const handleAddRow = useCallback(async () => {
    if (!onAddRow || isAddingRow) return;
    setIsAddingRow(true);
    try {
      const newRow = await onAddRow();
      setNewRowIds(prev => new Set(prev).add(newRow.id));
      setTimeout(() => {
        const firstEditable = visibleColumns.find(c => c.editable && !c.readOnly);
        if (firstEditable) {
          setSelectedCell({ rowId: newRow.id, colId: firstEditable.id });
        }
      }, 50);
    } catch (error) {
      console.error('Failed to add row', error);
    } finally {
      setIsAddingRow(false);
    }
  }, [onAddRow, isAddingRow, visibleColumns]);

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const resizingRef = useRef<{ columnId: string; startX: number; startWidth: number } | null>(null);
  const activeResizeHandlers = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  const BASE_COL_WIDTH = 50;
  const SORT_ICON_WIDTH = 20;
  const FILTER_ICON_WIDTH = 25;
  // 48px fits the "…" row-actions menu. A custom `actions` render node (only the
  // access-request approve/reject controls today) needs room for real buttons.
  const ACTIONS_COL_WIDTH = actions ? 210 : 48;

  const getMinColWidth = useCallback((column: ColumnDef<T>) => {
    let w = BASE_COL_WIDTH;
    if (column.sortable) w += SORT_ICON_WIDTH;
    if (column.filterable) w += FILTER_ICON_WIDTH;
    return w;
  }, []);

  const handleResizeStart = useCallback((columnId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const th = (e.target as HTMLElement).closest('th');
    if (!th) return;
    const startWidth = th.getBoundingClientRect().width;

    resizingRef.current = { columnId, startX: e.clientX, startWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) return;
      const col = columns.find(c => c.id === resizingRef.current!.columnId);
      const minW = col ? getMinColWidth(col) : BASE_COL_WIDTH;
      const diff = moveEvent.clientX - resizingRef.current.startX;
      const newWidth = Math.max(minW, resizingRef.current.startWidth + diff);
      
      setResizingWidths(prev => ({
        ...prev,
        [resizingRef.current!.columnId]: newWidth
      }));
    };

    const handleMouseUp = () => {
      if (resizingRef.current) {
        const { columnId } = resizingRef.current;
        setResizingWidths(prev => {
          const finalWidth = prev[columnId];
          if (finalWidth !== undefined) {
            setColumnWidth(columnId, finalWidth);
          }
          const next = { ...prev };
          delete next[columnId];
          return next;
        });
        resizingRef.current = null;
      }
      if (activeResizeHandlers.current) {
        document.removeEventListener('mousemove', activeResizeHandlers.current.move);
        document.removeEventListener('mouseup', activeResizeHandlers.current.up);
        activeResizeHandlers.current = null;
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    activeResizeHandlers.current = { move: handleMouseMove, up: handleMouseUp };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [columns, getMinColWidth, setColumnWidth]);

  // Cleanup in case of unmount during resize
  useEffect(() => {
    return () => {
      if (activeResizeHandlers.current) {
        document.removeEventListener('mousemove', activeResizeHandlers.current.move);
        document.removeEventListener('mouseup', activeResizeHandlers.current.up);
        activeResizeHandlers.current = null;
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const moveSelection = useCallback((direction: 'next' | 'prev' | 'up' | 'down') => {
    if (!selectedCell) return false;

    const rowIndex = processedData.findIndex(r => r.id === selectedCell.rowId);
    const colIndex = visibleColumns.findIndex(c => c.id === selectedCell.colId);

    if (rowIndex === -1 || colIndex === -1) return false;

    let nextRowIndex = rowIndex;
    let nextColIndex = colIndex;

    if (direction === 'next') {
      if (colIndex < visibleColumns.length - 1) {
        nextColIndex = colIndex + 1;
      } else if (rowIndex < processedData.length - 1) {
        nextRowIndex = rowIndex + 1;
        nextColIndex = 0;
      }
    } else if (direction === 'prev') {
      if (colIndex > 0) {
        nextColIndex = colIndex - 1;
      } else if (rowIndex > 0) {
        nextRowIndex = rowIndex - 1;
        nextColIndex = visibleColumns.length - 1;
      }
    } else if (direction === 'down') {
      if (rowIndex < processedData.length - 1) {
        nextRowIndex = rowIndex + 1;
      }
    } else if (direction === 'up') {
      if (rowIndex > 0) {
        nextRowIndex = rowIndex - 1;
      }
    }

    if (nextRowIndex !== rowIndex || nextColIndex !== colIndex) {
      setSelectedCell({
        rowId: processedData[nextRowIndex].id,
        colId: visibleColumns[nextColIndex].id
      });
      // Re-focus container to ensure continued navigation
      // Use a slightly longer delay to ensure it happens after any other focus events (like popover close)
      setTimeout(() => {
        if (tableContainerRef.current) {
          tableContainerRef.current.focus();
        }
      }, 10);
      return true;
    }
    return false;
  }, [selectedCell, processedData, visibleColumns]);

  const handleTableKeyDown = (e: React.KeyboardEvent) => {
    if (!selectedCell) return;

    if (e.key === 'Tab') {
      if (moveSelection(e.shiftKey ? 'prev' : 'next')) {
        e.preventDefault();
      }
    } else if (e.key === 'Enter') {
      if (moveSelection(e.shiftKey ? 'up' : 'down')) {
        e.preventDefault();
      }
    }
  };

  const renderRowActions = (row: T) => {
    if (!rowActions) return null;
    return <RowActionsMenu row={row} actions={rowActions} />;
  };

  if (isLoading) {
    return (
      <div className={cn("space-y-4", className)}>
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.slice(0, 5).map((_, i) => (
                  <TableHead key={i}><Skeleton className="h-4 w-24" /></TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[1, 2, 3, 4, 5].map((i) => (
                <TableRow key={i}>
                  {columns.slice(0, 5).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex justify-between items-center px-1">
        <div className="flex items-center gap-2">
          {toolbarLeft}
          <p className="text-sm text-muted-foreground">
            {processedData.length} {processedData.length === 1 ? 'row' : 'rows'}
          </p>
          {Object.keys(filters).length > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => Object.keys(filters).forEach(removeFilter)}
              className="h-7 px-2 text-xs"
            >
              Clear filters
              <X className="ml-1 h-3 w-3" />
            </Button>
          )}
        </div>
        
        <div className="flex items-center gap-2">
        {toolbarRight}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto flex h-8 gap-2">
              <Settings2 className="h-4 w-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {columns
              .filter((col) => !col.required)
              .map((column) => {
                const checked = isColumnVisible(column);
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={checked}
                    // Set the explicit opposite of what's shown now — one click
                    // always flips it, regardless of whether the stored value
                    // was undefined (never toggled), false, or true.
                    onCheckedChange={() =>
                      setColumnVisibility({ ...columnVisibility, [column.id]: !checked })
                    }
                  >
                    {column.header}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      <div 
        ref={tableContainerRef}
        className="rounded-md border bg-background shadow-sm overflow-x-auto outline-none focus:ring-1 focus:ring-ring/20"
        tabIndex={0}
        onKeyDown={handleTableKeyDown}
      >
        <Table ref={tableRef} className="table-fixed border-collapse" style={{ minWidth: '100%' }}>
          <colgroup>
            {visibleColumns.map((column) => {
              const width = resizingWidths[column.id] ?? columnWidths[column.id];
              const minW = getMinColWidth(column);
              return (
                <col
                  key={column.id}
                  style={width ? { width: `${width}px`, minWidth: `${minW}px` } : { minWidth: `${minW}px` }}
                  className={column.className}
                />
              );
            })}
            {(actions || rowActions) && <col style={{ width: `${ACTIONS_COL_WIDTH}px`, minWidth: `${ACTIONS_COL_WIDTH}px` }} />}
          </colgroup>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              {visibleColumns.map((column) => {
                const width = resizingWidths[column.id] ?? columnWidths[column.id];
                return (
                  <TableHead
                    key={column.id}
                    className={cn("p-0 group !whitespace-normal relative", column.className)}
                    style={width ? { width: `${width}px` } : undefined}
                  >
                  <div className="flex items-center gap-1 w-full h-full px-2.5 py-2.5">
                    <span 
                      className={cn(
                        "font-semibold text-foreground text-xs leading-tight min-w-0",
                        column.sortable && "cursor-pointer select-none flex items-center gap-0.5"
                      )}
                      onClick={() => column.sortable && toggleSorting(column.id)}
                    >
                      {column.header}
                      {column.sortable && (
                        <span className="text-muted-foreground shrink-0">
                          {sorting?.columnId === column.id ? (
                            sorting.direction === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronsUpDown className="h-3.5 w-3.5 transition-opacity" />
                          )}
                        </span>
                      )}
                    </span>
                    
                    {column.filterable && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Filter ${column.header}`}
                            className={cn(
                              "h-5 w-5 p-0 shrink-0 rounded-full",
                              filters[column.id]
                                ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                                : "text-muted-foreground"
                            )}
                          >
                            <Filter className="h-3 w-3" fill={filters[column.id] ? "currentColor" : "none"} />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-60 p-2" align="start">
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium px-2 py-1">Filter {column.header}</h4>
                            <div className="relative">
                              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                              <Input
                                placeholder={`Search...`}
                                value={filters[column.id] || ''}
                                onChange={(e) => setFilter(column.id, e.target.value)}
                                className="pl-8 h-8 text-sm"
                                autoFocus
                              />
                            </div>
                            {filters[column.id] && (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => removeFilter(column.id)}
                                className="w-full h-8 text-xs justify-start"
                              >
                                <X className="mr-2 h-3 w-3" />
                                Clear filter
                              </Button>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                    onMouseDown={(e) => handleResizeStart(column.id, e)}
                  />
                </TableHead>
              );
            })}
              {(actions || rowActions) && (
                <TableHead style={{ width: `${ACTIONS_COL_WIDTH}px` }} className="px-1" />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {processedData.length > 0 ? (
              processedData.map((row) => (
                <TableRow key={row.id} className="group hover:bg-muted/30 transition-colors">
                  {visibleColumns.map((column) => {
                    const value = typeof column.accessor === 'function' 
                      ? column.accessor(row) 
                      : row[column.accessor];
                    
                    const isSelected = selectedCell?.rowId === row.id && selectedCell?.colId === column.id;

                    return (
                      <EditableCell
                        key={column.id}
                        value={value}
                        column={column.isEditable && !column.isEditable(row) ? { ...column, editable: false } : column}
                        row={row}
                        onSave={(newValue) => (newRowIds.has(row.id) ? handleCellSaveForNewRow : handleCellSave)(row.id, column.id, newValue)}
                        isSelected={isSelected}
                        onSelect={() => {
                          setSelectedCell({ rowId: row.id, colId: column.id });
                          tableContainerRef.current?.focus();
                        }}
                        onNavigate={moveSelection}
                        onEditComplete={() => {
                          setTimeout(() => tableContainerRef.current?.focus(), 0);
                        }}
                      />
                    );
                  })}
                  {(actions || rowActions) && (
                    <TableCell
                      className={cn('px-1', actions ? 'py-3 align-top' : 'text-center')}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {actions && actions(row)}
                      {renderRowActions(row)}
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + ((actions || rowActions) ? 1 : 0)} className="h-32 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {(onAddRow || onAddRowClick) && (
          <div className="border-t">
            <button
              type="button"
              onClick={onAddRowClick || handleAddRow}
              disabled={isAddingRow}
              className="flex items-center gap-1.5 w-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {isAddingRow ? 'Adding...' : 'Add Row'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RowActionsMenu<T>({ row, actions }: { row: T; actions: RowAction<T>[] }) {
  const [reason, setReason] = useState<string | null>(null);
  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setReason(null); }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]">
        {actions.filter((action) => !action.hidden?.(row)).map((action) => {
          const Icon = action.icon || {
            view: <Eye className="h-4 w-4" />,
            edit: <Edit className="h-4 w-4" />,
            duplicate: <Copy className="h-4 w-4" />,
            delete: <Trash2 className="h-4 w-4" />,
          }[action.id];
          const blocked = action.blockedReason?.(row) ?? null;

          return (
            <DropdownMenuItem
              key={action.id}
              onSelect={blocked ? (e) => { e.preventDefault(); setReason(blocked); } : undefined}
              onClick={blocked ? undefined : () => action.onClick(row)}
              disabled={action.disabled?.(row)}
              aria-disabled={blocked ? 'true' : undefined}
              title={blocked ?? undefined}
              className={cn(
                action.id === 'delete' && !blocked && "text-destructive focus:text-destructive",
                blocked && "text-muted-foreground",
                action.className
              )}
            >
              {Icon}
              <span className="ml-2">{action.label || action.id.charAt(0).toUpperCase() + action.id.slice(1)}</span>
            </DropdownMenuItem>
          );
        })}
        {reason && <p role="note" className="px-2 pb-2 text-xs text-muted-foreground">{reason}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
