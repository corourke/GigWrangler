import { AlertCircle, CheckCircle, Loader2, XCircle } from 'lucide-react';
import { Card } from '../ui/card';
import type { AssetRow, GigRow, ImportType, ParsedRow } from '../../utils/csvImport';

interface ImportProgressCardProps {
  importType: ImportType;
  isImporting: boolean;
  importResults: { success: number; errors: string[] } | null;
  validRows: ParsedRow<GigRow | AssetRow>[];
  invalidCount: number;
  /** Rows still waiting to be imported (for the progress bar). */
  readyCount: number;
}

/** The import's live progress, then its results and next steps. */
export default function ImportProgressCard({ importType, isImporting, importResults, validRows, invalidCount, readyCount }: ImportProgressCardProps) {
  return (
    <Card className="p-6 mb-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          {isImporting ? (
            <>
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              Import Progress
            </>
          ) : (importResults?.errors.length ?? 0) > 0 ? (
            <>
              <AlertCircle className="w-5 h-5 text-yellow-600" />
              Import Results
            </>
          ) : (
            <>
              <CheckCircle className="w-5 h-5 text-green-600" />
              Import Results
            </>
          )}
        </h2>
      </div>
      
      {/* Live Progress During Import */}
      {isImporting && (
        <div className="space-y-4 mb-4">
          {(() => {
            const importingCount = validRows.filter(r => r.importStatus === 'importing').length;
            const successCount = validRows.filter(r => r.importStatus === 'success').length;
            const failedCount = validRows.filter(r => r.importStatus === 'failed').length;
            const totalReady = readyCount + importingCount + successCount + failedCount;
            const completed = successCount + failedCount;
            const progressPercent = totalReady > 0 ? Math.round((completed / totalReady) * 100) : 0;
            
            return (
              <>
                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                
                {/* Progress Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                    <span className="text-blue-700 font-medium">
                      {importingCount} importing
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-green-700 font-medium">
                      {successCount} completed
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-600" />
                    <span className="text-red-700 font-medium">
                      {failedCount} failed
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-600 font-medium">
                      {progressPercent}% complete
                    </span>
                  </div>
                </div>
                
                {/* Currently Processing Row */}
                {importingCount > 0 && (() => {
                  const currentRow = validRows.find(r => r.importStatus === 'importing');
                  return currentRow && (
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                      <p className="text-sm text-blue-800">
                        <strong>Processing:</strong> Row {currentRow.rowIndex} - {importType === 'gigs' ? (currentRow.data as GigRow).title : (currentRow.data as AssetRow).manufacturer_model}
                      </p>
                    </div>
                  );
                })()}
              </>
            );
          })()}
        </div>
      )}
      
      {/* Final Results */}
      {importResults && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="font-medium text-green-700">
                {importResults.success} successfully imported
              </span>
            </div>
            {importResults.errors.length > 0 && (
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-600" />
                <span className="font-medium text-red-700">
                  {importResults.errors.length} failed
                </span>
              </div>
            )}
          </div>
          {invalidCount > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
              <p className="text-sm text-yellow-800">
                <strong>Next steps:</strong>{' '}
                {importType === 'assets'
                  ? 'Purchases with an invalid row are held back and aren’t imported. Fix the invalid rows below, use "Re-validate Fixed Rows", then import the complete purchases.'
                  : 'Fix the invalid rows below and use "Re-validate & Import Fixed Rows" to continue.'}
              </p>
            </div>
          )}
          {importResults.errors.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer font-medium text-gray-700 hover:text-gray-900">
                View detailed error messages
              </summary>
              <ul className="list-disc list-inside space-y-1 text-sm mt-2 ml-4 text-gray-600">
                {importResults.errors.map((error, idx) => (
                  <li key={idx}>{error}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
