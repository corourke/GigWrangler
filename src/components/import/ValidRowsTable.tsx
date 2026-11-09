import { AlertCircle, CheckCircle, Loader2, XCircle } from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { formatGigDateTimeForDisplay } from '../../utils/dateUtils';
import type { AssetRow, GigRow, ImportType, ParsedRow } from '../../utils/csvImport';
import type { AssetImportPlan } from '../../utils/csvAssetImportPlan';

interface ValidRowsTableProps {
  importType: ImportType;
  validRows: ParsedRow<GigRow | AssetRow>[];
  assetPlan: AssetImportPlan | null;
}

/** The valid rows, with what each will make (assets) and its import status. */
export default function ValidRowsTable({ importType, validRows, assetPlan }: ValidRowsTableProps) {
  return (
    <Card className="p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <CheckCircle className="w-5 h-5 text-green-600" />
        Valid Rows ({validRows.length})
      </h2>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {importType === 'gigs' ? (
                <>
                  <TableHead>Row</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Act</TableHead>
                  <TableHead>Venue</TableHead>
                </>
              ) : (
                <>
                  <TableHead className="text-[0.8rem] px-2">Date</TableHead>
                  <TableHead className="text-[0.8rem] px-2">Source</TableHead>
                  <TableHead className="text-[0.8rem] px-2">Vendor</TableHead>
                  <TableHead className="text-[0.8rem] px-2">Model</TableHead>
                  <TableHead className="text-[0.8rem] px-2">Inv AMT</TableHead>
                  <TableHead className="text-[0.8rem] px-2">Line AMT</TableHead>
                  <TableHead className="text-[0.8rem] px-2">Line Cost</TableHead>
                  <TableHead className="text-[0.8rem] px-2">Qty</TableHead>
                  <TableHead className="text-[0.8rem] px-2">Price</TableHead>
                  <TableHead className="text-[0.8rem] px-2">Cost</TableHead>
                  <TableHead className="text-[0.8rem] px-2">Kit</TableHead>
                  <TableHead className="text-[0.8rem] px-2">Notes</TableHead>
                </>
              )}
              <TableHead>Import Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {validRows.map((row) => (
              <TableRow key={row.rowIndex}>
                {importType === 'gigs' ? (
                  <>
                    <TableCell>{row.rowIndex}</TableCell>
                    <TableCell>{(row.data as GigRow).title}</TableCell>
                    <TableCell>{formatGigDateTimeForDisplay((row.data as GigRow).start, (row.data as GigRow).timezone, (row.data as GigRow).all_day)}</TableCell>
                    <TableCell>{formatGigDateTimeForDisplay((row.data as GigRow).end, (row.data as GigRow).timezone, (row.data as GigRow).all_day)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{(row.data as GigRow).status}</Badge>
                    </TableCell>
                    <TableCell>{(row.data as GigRow).act || '-'}</TableCell>
                    <TableCell>{(row.data as GigRow).venue || '-'}</TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="text-[0.8rem] px-2">{(row.data as AssetRow).acquisition_date}</TableCell>
                    <TableCell className="text-[0.8rem] px-2">{(row.data as AssetRow).source}</TableCell>
                    <TableCell className="text-[0.8rem] px-2">{(row.data as AssetRow).vendor || '-'}</TableCell>
                    <TableCell className="text-[0.8rem] px-2" title={(row.data as AssetRow).manufacturer_model}>
                      {(row.data as AssetRow).manufacturer_model?.length > 20 
                        ? (row.data as AssetRow).manufacturer_model.substring(0, 17) + '...' 
                        : (row.data as AssetRow).manufacturer_model}
                    </TableCell>
                    <TableCell className="text-[0.8rem] px-2">{(row.data as AssetRow).total_inv_amount || '-'}</TableCell>
                    <TableCell className="text-[0.8rem] px-2">{(row.data as AssetRow).line_amount || '-'}</TableCell>
                    <TableCell className="text-[0.8rem] px-2">{(row.data as AssetRow).line_cost || '-'}</TableCell>
                    <TableCell className="text-[0.8rem] px-2">{(row.data as AssetRow).quantity || '-'}</TableCell>
                    <TableCell className="text-[0.8rem] px-2">{(row.data as AssetRow).item_price || '-'}</TableCell>
                    <TableCell className="text-[0.8rem] px-2">{(row.data as AssetRow).item_cost || '-'}</TableCell>
                    {(() => {
                      const plan = assetPlan?.rows[row.rowIndex];
                      return (
                        <>
                          <TableCell className="text-[0.8rem] px-2">
                            {plan?.kit ? `${plan.kit.name}${plan.kit.isNew ? ' (new kit)' : ''}` : '-'}
                          </TableCell>
                          <TableCell className="text-[0.8rem] px-2 text-gray-600">
                            {(plan?.notes ?? row.notes ?? []).map((n) => <div key={n}>{n}</div>)}
                          </TableCell>
                        </>
                      );
                    })()}
                  </>
                )}
                <TableCell>
                  <div className="flex items-center gap-2">
                    {row.importStatus === 'pending' && (
                      <div className="flex items-center gap-1">
                        <AlertCircle className="w-4 h-4 text-yellow-600" />
                        <span className="text-sm text-yellow-700">Ready</span>
                      </div>
                    )}
                    {row.importStatus === 'importing' && (
                      <div className="flex items-center gap-1">
                        <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                        <span className="text-sm text-blue-700">Importing...</span>
                      </div>
                    )}
                    {row.importStatus === 'success' && (
                      <div className="flex items-center gap-1">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        <span className="text-sm text-green-700">Success</span>
                      </div>
                    )}
                    {row.importStatus === 'failed' && (
                      <div className="flex items-center gap-1">
                        <XCircle className="w-4 h-4 text-red-600" />
                        <span className="text-sm text-red-700">Failed</span>
                        {row.importError && (
                          <span className="text-xs text-red-600 ml-1" title={row.importError}>
                            ({row.importError.substring(0, 30)}{row.importError.length > 30 ? '...' : ''})
                          </span>
                        )}
                      </div>
                    )}
                    {!row.importStatus && (() => {
                      // Assets: a purchase with an invalid row isn't imported (#183 D).
                      const plan = importType === 'assets' ? assetPlan?.rows[row.rowIndex] : undefined;
                      const held = plan ? assetPlan?.purchases[plan.purchaseIndex].heldBy ?? [] : [];
                      return held.length > 0 ? (
                        <div className="flex items-center gap-1">
                          <AlertCircle className="w-4 h-4 text-amber-600" />
                          <span className="text-sm text-amber-700">
                            {`Held: fix ${held.length === 1 ? 'row' : 'rows'} ${held.join(', ')}`}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <AlertCircle className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-500">Ready</span>
                        </div>
                      );
                    })()}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
