import { XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { GIG_STATUS_CONFIG } from '../../utils/supabase/constants';
import { getTimezoneOptions } from '../../utils/timezones';
import { formatGigDateTimeForInput, parseGigDateTimeFromInput } from '../../utils/dateUtils';
import type { AssetRow, GigRow, ImportType, ParsedRow } from '../../utils/csvImport';

// Helper function to get field-specific error and styling
const getFieldValidation = (row: ParsedRow<GigRow | AssetRow>, fieldName: string) => {
  const fieldError = row.errors.find(error => error.field === fieldName);
  const hasError = !!fieldError;
  const isValid = !hasError && row.data[fieldName as keyof (GigRow | AssetRow)]?.toString().trim();
  
  return {
    hasError,
    isValid,
    error: fieldError,
    className: hasError 
      ? "h-8 text-sm border-red-300 focus:border-red-500 focus:ring-red-500" 
      : isValid 
      ? "h-8 text-sm border-green-300 focus:border-green-500 focus:ring-green-500"
      : "h-8 text-sm"
  };
};

interface InvalidRowsCardProps {
  importType: ImportType;
  invalidRows: ParsedRow<GigRow | AssetRow>[];
  isImporting: boolean;
  onEdit: (rowIndex: number, field: string, value: string) => void;
  onRevalidate: () => void;
}

/** The rows that failed validation, each editable on screen, with their errors. */
export default function InvalidRowsCard({ importType, invalidRows, isImporting, onEdit, onRevalidate }: InvalidRowsCardProps) {
  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <XCircle className="w-5 h-5 text-red-600" />
          Invalid Rows ({invalidRows.length})
        </h2>
        <Button
          variant="outline"
          onClick={onRevalidate}
          disabled={invalidRows.length === 0 || isImporting}
        >
          Re-validate Fixed Rows
        </Button>
      </div>
      <div className="space-y-4">
        {invalidRows.map((row) => (
          <div key={row.rowIndex} className="border border-red-200 rounded-lg p-4 bg-red-50">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-red-900">Row {row.rowIndex}</span>
              {row.isValid && (
                <Badge className="bg-green-100 text-green-800">Fixed</Badge>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
              {importType === 'gigs' ? (
                <>
                  <div>
                    <Label className="text-xs">Title</Label>
                    {(() => {
                      const validation = getFieldValidation(row, 'title');
                      return (
                        <>
                          <Input
                            value={(row.data as GigRow).title}
                            onChange={(e) => onEdit(row.rowIndex, 'title', e.target.value)}
                            className={validation.className}
                          />
                          {validation.hasError && (
                            <div className="text-xs text-red-600 mt-1">
                              {validation.error?.message}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <Label className="text-xs">Start</Label>
                    {(() => {
                      const validation = getFieldValidation(row, 'start');
                      return (
                        <>
                          <Input
                            type={(row.data as GigRow).all_day ? 'date' : 'datetime-local'}
                            value={formatGigDateTimeForInput((row.data as GigRow).start, (row.data as GigRow).timezone, (row.data as GigRow).all_day)}
                            onChange={(e) => {
                              const isDateOnly = e.target.type === 'date';
                              const utcValue = parseGigDateTimeFromInput(e.target.value, (row.data as GigRow).timezone, isDateOnly);
                              onEdit(row.rowIndex, 'start', utcValue);
                            }}
                            className={validation.className}
                          />
                          {validation.hasError && (
                            <div className="text-xs text-red-600 mt-1">
                              {validation.error?.message}
                            </div>
                          )}
                          {(row.data as GigRow).originalStart && (
                            <div className="text-xs text-gray-600 mt-1">
                              Original: "{(row.data as GigRow).originalStart}"
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <Label className="text-xs">End</Label>
                    {(() => {
                      const validation = getFieldValidation(row, 'end');
                      return (
                        <>
                          <Input
                            type={(row.data as GigRow).all_day ? 'date' : 'datetime-local'}
                            value={formatGigDateTimeForInput((row.data as GigRow).end, (row.data as GigRow).timezone, (row.data as GigRow).all_day)}
                            onChange={(e) => {
                              const isDateOnly = e.target.type === 'date';
                              const utcValue = parseGigDateTimeFromInput(e.target.value, (row.data as GigRow).timezone, isDateOnly);
                              onEdit(row.rowIndex, 'end', utcValue);
                            }}
                            className={validation.className}
                          />
                          {validation.hasError && (
                            <div className="text-xs text-red-600 mt-1">
                              {validation.error?.message}
                            </div>
                          )}
                          {(row.data as GigRow).originalEnd && (
                            <div className="text-xs text-gray-600 mt-1">
                              Original: "{(row.data as GigRow).originalEnd}"
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <Label className="text-xs">Timezone</Label>
                    {(() => {
                      const validation = getFieldValidation(row, 'timezone');
                      const selectClassName = validation.hasError 
                        ? "h-8 text-sm border-red-300 focus:border-red-500 focus:ring-red-500" 
                        : validation.isValid 
                        ? "h-8 text-sm border-green-300 focus:border-green-500 focus:ring-green-500"
                        : "h-8 text-sm";
                      
                      return (
                        <>
                          <Select
                            value={(row.data as GigRow).timezone}
                            onValueChange={(value) => onEdit(row.rowIndex, 'timezone', value)}
                          >
                            <SelectTrigger className={selectClassName}>
                              <SelectValue placeholder="Select timezone" />
                            </SelectTrigger>
                            <SelectContent>
                              {getTimezoneOptions().map(tz => (
                                <SelectItem key={tz.value} value={tz.value}>
                                  {tz.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {validation.hasError && (
                            <div className="text-xs text-red-600 mt-1">
                              {validation.error?.message}
                            </div>
                          )}
                          {(row.data as GigRow).originalTimezone && (
                            <div className="text-xs text-gray-600 mt-1">
                              Original: "{(row.data as GigRow).originalTimezone}"
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <Label className="text-xs">Status</Label>
                    {(() => {
                      const validation = getFieldValidation(row, 'status');
                      const selectClassName = validation.hasError 
                        ? "h-8 text-sm border-red-300 focus:border-red-500 focus:ring-red-500" 
                        : validation.isValid 
                        ? "h-8 text-sm border-green-300 focus:border-green-500 focus:ring-green-500"
                        : "h-8 text-sm";
                      
                      return (
                        <>
                          <Select
                            value={(row.data as GigRow).status}
                            onValueChange={(value) => onEdit(row.rowIndex, 'status', value)}
                          >
                            <SelectTrigger className={selectClassName}>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(GIG_STATUS_CONFIG).map(([value, config]) => (
                                <SelectItem key={value} value={value}>
                                  {config.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {validation.hasError && (
                            <div className="text-xs text-red-600 mt-1">
                              {validation.error?.message}
                            </div>
                          )}
                          {(row.data as GigRow).originalStatus && (
                            <div className="text-xs text-gray-600 mt-1">
                              Original: "{(row.data as GigRow).originalStatus}"
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <Label className="text-xs">Act</Label>
                    {(() => {
                      const validation = getFieldValidation(row, 'act');
                      return (
                        <>
                          <Input
                            value={(row.data as GigRow).act || ''}
                            onChange={(e) => onEdit(row.rowIndex, 'act', e.target.value)}
                            className={validation.className}
                          />
                          {validation.hasError && (
                            <div className="text-xs text-red-600 mt-1">
                              {validation.error?.message}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <Label className="text-xs">Venue</Label>
                    {(() => {
                      const validation = getFieldValidation(row, 'venue');
                      return (
                        <>
                          <Input
                            value={(row.data as GigRow).venue || ''}
                            onChange={(e) => onEdit(row.rowIndex, 'venue', e.target.value)}
                            className={validation.className}
                          />
                          {validation.hasError && (
                            <div className="text-xs text-red-600 mt-1">
                              {validation.error?.message}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label className="text-xs">Category</Label>
                    <Input
                      value={(row.data as AssetRow).category}
                      onChange={(e) => onEdit(row.rowIndex, 'category', e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Manufacturer/Model</Label>
                    <Input
                      value={(row.data as AssetRow).manufacturer_model}
                      onChange={(e) => onEdit(row.rowIndex, 'manufacturer_model', e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Acquisition Date</Label>
                    <Input
                      value={(row.data as AssetRow).acquisition_date}
                      onChange={(e) => onEdit(row.rowIndex, 'acquisition_date', e.target.value)}
                      className="h-8 text-sm"
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                  {/* Units, lots and kits (#183 D): one serial or tag per unit, separated by ";". */}
                  {([
                    ['quantity', 'Quantity', ''],
                    ['serial_number', 'Serial numbers', 'One per unit, separated by ;'],
                    ['tag_number', 'Tags', 'One per unit, separated by ;'],
                    ['kit', 'Kit', 'Kit name'],
                  ] as const).map(([field, label, placeholder]) => {
                    const validation = getFieldValidation(row, field);
                    const id = `import-row-${row.rowIndex}-${field}`;
                    return (
                      <div key={field}>
                        <Label htmlFor={id} className="text-xs">{label}</Label>
                        <Input
                          id={id}
                          value={(row.data as AssetRow)[field] ?? ''}
                          onChange={(e) => onEdit(row.rowIndex, field, e.target.value)}
                          className={validation.hasError ? validation.className : 'h-8 text-sm'}
                          placeholder={placeholder}
                        />
                      </div>
                    );
                  })}
                </>
              )}
            </div>
            <div className="mt-2">
              <p className="text-xs font-medium text-red-800 mb-1">Errors:</p>
              <ul className="list-disc list-inside text-xs text-red-700 space-y-1">
                {row.errors.map((error, idx) => (
                  <li key={idx}>
                    <span className="font-medium">{error.field}:</span> {error.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
