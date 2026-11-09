import { useState, useRef, useCallback, useMemo } from 'react';
import { Upload, Download, FileText, AlertCircle, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { Organization, User, UserRole } from '../utils/supabase/types';
import {
  parseAndValidateCSV,
  downloadTemplate,
  validateGigRow,
  validateAssetRow,
  revalidateAssetRows,
  downloadAssetExample,
  type ImportType,
  type ParsedRow,
  type GigRow,
  type AssetRow,
} from '../utils/csvImport';
import { buildAssetImportPlan, type AssetImportPlan, type PurchaseState } from '../utils/csvAssetImportPlan';
import { createClient } from '../utils/supabase/client';
import { useImportCatalog, useImportMutations, gigImportError } from './import/useImportData';
import AssetColumnGuide from './import/AssetColumnGuide';
import ImportSummaryCard from './import/ImportSummaryCard';
import ImportProgressCard from './import/ImportProgressCard';
import InvalidRowsCard from './import/InvalidRowsCard';
import ValidRowsTable from './import/ValidRowsTable';

interface ImportScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  onCancel: () => void;
  /** Names the Back button for where Import was opened from. */
  backLabel?: string;
  initialImportType?: ImportType;
  onNavigateToGigs: () => void;
  onSwitchOrganization: () => void;
  onLogout: () => void;
}

export default function ImportScreen({
  organization,
  user,
  userRole,
  onCancel,
  backLabel = 'Back to Gigs',
  initialImportType = 'gigs',
  onNavigateToGigs,
  onSwitchOrganization,
  onLogout,
}: ImportScreenProps) {
  const [importType, setImportType] = useState<ImportType>(initialImportType);

  // Helper function to format datetime for display in import preview

  const [file, setFile] = useState<File | null>(null);
  const [validRows, setValidRows] = useState<ParsedRow<GigRow | AssetRow>[]>([]);
  const [invalidRows, setInvalidRows] = useState<ParsedRow<GigRow | AssetRow>[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState<{ success: number; errors: string[] } | null>(null);
  /** Notes about the file that don't block it, e.g. columns no longer read (#183 D). */
  const [notices, setNotices] = useState<string[]>([]);
  /** The organization's items and kit names, which an assets import matches by name (#183 D, A10). */
  const { catalog, load: loadCatalog } = useImportCatalog(organization.id);
  const mutations = useImportMutations(organization);
  const fileInputRef = useRef<HTMLInputElement>(null);



  const handleFileSelect = useCallback(async (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }

    setFile(selectedFile);
    setIsProcessing(true);
    setImportResults(null);

    try {
      const [result] = await Promise.all([
        parseAndValidateCSV(selectedFile, importType, user?.timezone),
        importType === 'assets' ? loadCatalog() : Promise.resolve(null),
      ]);
      setValidRows(result.validRows);
      setInvalidRows(result.invalidRows);
      setNotices(result.notices);
      
      if (result.invalidRows.length > 0) {
        toast.warning(`${result.invalidRows.length} row(s) have validation errors. Please fix them before importing.`);
      } else {
        toast.success(`All ${result.validRows.length} row(s) are valid and ready to import.`);
      }
    } catch (error: any) {
      console.error('Error parsing CSV:', error);
      toast.error(error.message || 'Failed to parse CSV file');
      setFile(null);
    } finally {
      setIsProcessing(false);
    }
  }, [importType, user, loadCatalog]);

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  }, [handleFileSelect]);

  const handleDownloadTemplate = () => {
    downloadTemplate(importType);
  };

  // Every row of an assets file, for its plan. A row still listed as invalid holds its
  // purchase back until the file is re-validated, even once it's fixed on screen (#183 D).
  const allAssetRows = useCallback(
    (): ParsedRow<AssetRow>[] => [
      ...(validRows as ParsedRow<AssetRow>[]),
      ...(invalidRows as ParsedRow<AssetRow>[]).map((r) => ({ ...r, isValid: false })),
    ],
    [validRows, invalidRows],
  );

  // What an assets file will make, purchase by purchase and row by row: items matched or
  // new, units or a lot, kits, and which purchases are held (#183 D). A planning error is
  // shown on the screen rather than breaking it.
  const { assetPlan, assetPlanError } = useMemo((): { assetPlan: AssetImportPlan | null; assetPlanError: string | null } => {
    if (importType !== 'assets' || (!validRows.length && !invalidRows.length)) return { assetPlan: null, assetPlanError: null };
    try {
      return { assetPlan: buildAssetImportPlan(organization.id, allAssetRows(), catalog), assetPlanError: null };
    } catch (error) {
      console.error('Error planning the import:', error);
      return { assetPlan: null, assetPlanError: error instanceof Error ? error.message : String(error) };
    }
  }, [importType, validRows, invalidRows, allAssetRows, organization.id, catalog]);
  const purchasesIn = (state: PurchaseState) => assetPlan?.purchases.filter((p) => p.state === state) ?? [];

  const handleEditInvalidRow = (rowIndex: number, field: string, value: string) => {
    setInvalidRows(prev => prev.map(row => {
      if (row.rowIndex === rowIndex) {
        const updatedData = { ...row.data, [field]: value };
        // Re-validate the row
        if (importType === 'gigs') {
          const validated = validateGigRow(updatedData, rowIndex, user?.timezone);
          return validated as ParsedRow<GigRow | AssetRow>;
        } else {
          // From the row as read, so a later re-check re-runs the file's grouping and costs.
          // It stays in its purchase until then.
          const validated = validateAssetRow({ ...(row.raw ?? row.data), [field]: value }, rowIndex);
          return { ...validated, purchase: (row as ParsedRow<AssetRow>).purchase } as ParsedRow<GigRow | AssetRow>;
        }
      }
      return row;
    }));
  };


  // Helper function to get rows ready for import. Assets: the rows of complete purchases.
  const getReadyToImportRows = () => {
    if (importType === 'assets') {
      const ready = new Set(purchasesIn('ready').flatMap((p) => p.rowIndexes));
      return validRows.filter(row => ready.has(row.rowIndex));
    }
    return validRows.filter(row => !row.importStatus || row.importStatus === 'pending');
  };

  /**
   * Import an assets file's complete purchases ('ready'), or retry those that failed to save
   * ('failed'): one purchase at a time, each saved whole or not at all (#183 D). A purchase
   * with a row already imported is never sent again.
   */
  const handleImportAssets = async (which: 'ready' | 'failed') => {
    let plan: AssetImportPlan;
    try {
      plan = buildAssetImportPlan(organization.id, allAssetRows(), catalog);
    } catch (error: any) {
      toast.error(`Couldn’t plan the import: ${error?.message ?? error}`);
      return;
    }
    const purchases = plan.purchases.filter((p) => p.state === which);
    if (!purchases.length) {
      toast.error(which === 'ready' ? 'No complete purchases to import' : 'No failed purchases to retry');
      return;
    }

    setIsImporting(true);
    setImportResults(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      const sending = new Set(purchases.flatMap((p) => p.rowIndexes));
      setValidRows(prev => prev.map(r => sending.has(r.rowIndex) ? { ...r, importStatus: 'importing', importError: undefined } : r));

      const result = await mutations.importAssetPurchases.mutateAsync({
        purchases,
        onProgress: (count) => setImportResults({ success: count, errors: [] }), // Partial update
      });
      // Rows in purchases that didn't save (a kit warning alone isn't a failure).
      const failedRows = result.results.filter(r => r.status === 'failed').reduce((n, r) => n + r.rowIndexes.length, 0);

      const outcome = new Map<number, { status: 'success' | 'failed'; error?: string }>();
      for (const r of result.results) {
        for (const rowIndex of r.rowIndexes) outcome.set(rowIndex, { status: r.status, error: r.error ?? r.warning });
      }
      setValidRows(prev => prev.map(r => {
        const o = outcome.get(r.rowIndex);
        if (o) return { ...r, importStatus: o.status, importError: o.error };
        // Sent but not reported back: it didn't save.
        return sending.has(r.rowIndex) ? { ...r, importStatus: 'failed', importError: 'Not saved' } : r;
      }));
      // Items and kits made by this import are matched by the next one: the mutation reads them again.

      setImportResults({ success: result.successCount, errors: result.errors });
      if (result.successCount > 0) toast.success(`Successfully imported ${result.successCount} row(s)`);
      if (failedRows > 0) toast.error(`Failed to import ${failedRows} row(s). Check errors below.`);
      else if (result.errors.length > 0) toast.warning('Imported, with problems adding equipment to kits. Check errors below.');
    } catch (error: any) {
      console.error('Error importing rows:', error);
      toast.error(error.message || 'Failed to import rows');
      // Nothing came back: whatever was being sent is retried from here.
      setValidRows(prev => prev.map(r => r.importStatus === 'importing' ? { ...r, importStatus: 'failed', importError: error.message || 'Failed to import' } : r));
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportValidRows = async () => {
    if (importType === 'assets') return handleImportAssets('ready');
    const readyRows = getReadyToImportRows();
    if (readyRows.length === 0) {
      toast.error('No rows ready to import');
      return;
    }

    setIsImporting(true);
    setImportResults(null);
    const errors: string[] = [];
    let successCount = 0;

    // Only process rows that are ready for import
    const updatedValidRows = [...validRows];
    readyRows.forEach(row => {
      const rowInList = updatedValidRows.find(r => r.rowIndex === row.rowIndex);
      if (rowInList) {
        rowInList.importStatus = 'pending';
        rowInList.importError = undefined;
      }
    });
    setValidRows([...updatedValidRows]);

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      if (importType === 'gigs') {
        // ... existing gig import logic
        for (let i = 0; i < readyRows.length; i++) {
          const row = readyRows[i];
          try {
            // Update status to importing
            row.importStatus = 'importing';
            setValidRows(prev => prev.map(r => r.rowIndex === row.rowIndex ? row : r));

            // Its act and venue found or created, then the gig (useImportMutations).
            await mutations.importGigRow.mutateAsync(row.data as GigRow);

            // Mark as success
            row.importStatus = 'success';
            row.importError = undefined;
            setValidRows(prev => prev.map(r => r.rowIndex === row.rowIndex ? row : r));
            successCount++;
          } catch (error: any) {
            // Provide user-friendly error messages
            const errorMessage = gigImportError(error);

            row.importStatus = 'failed';
            row.importError = errorMessage;
            setValidRows(prev => prev.map(r => r.rowIndex === row.rowIndex ? row : r));
            errors.push(`Row ${row.rowIndex}: ${errorMessage}`);
          }
        }
      }

      setImportResults({ success: successCount, errors });
      
      if (successCount > 0) {
        toast.success(`Successfully imported ${successCount} gig(s)`);
        // Keep all rows visible to show import status - don't remove or navigate
      }
      
      if (errors.length > 0) {
        toast.error(`Failed to import ${errors.length} row(s). Check errors below.`);
      }
    } catch (error: any) {
      console.error('Error importing rows:', error);
      toast.error(error.message || 'Failed to import rows');
    } finally {
      setIsImporting(false);
    }
  };

  const handleRevalidateInvalidRows = () => {
    if (importType === 'assets') {
      // Re-run the whole file, so a fixed row joins its own invoice and its costs (#183 D).
      const next = revalidateAssetRows(validRows as ParsedRow<AssetRow>[], invalidRows as ParsedRow<AssetRow>[]);
      const moved = invalidRows.length - next.invalidRows.length;
      setValidRows(next.validRows);
      setInvalidRows(next.invalidRows);
      if (moved > 0) toast.success(`Moved ${moved} fixed row(s) to valid rows`);
      return;
    }
    // Move fixed rows from invalid to valid
    const fixedRows = invalidRows.filter(row => row.isValid);
    const stillInvalid = invalidRows.filter(row => !row.isValid);
    
    if (fixedRows.length > 0) {
      setValidRows(prev => [...prev, ...fixedRows]);
      setInvalidRows(stillInvalid);
      toast.success(`Moved ${fixedRows.length} fixed row(s) to valid rows`);
    }
  };


  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        organization={organization}
        user={user}
        userRole={userRole}
        currentRoute="import"
        onSwitchOrganization={onSwitchOrganization}
        onLogout={onLogout}
      />

      <PageHeader back={{ label: backLabel, onClick: onCancel }} title="CSV Import" />

      {/* Narrower than the header, but left-aligned with the title (#39). */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 *:max-w-6xl">

        {/* Import Type Selection */}
        <Card className="p-6 mb-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="import-type">Import Type</Label>
                <p className="text-sm text-gray-500 mt-1">Select what you want to import</p>
              </div>
              <Select value={importType} onValueChange={(value) => {
                setImportType(value as ImportType);
                setFile(null);
                setValidRows([]);
                setInvalidRows([]);
                setImportResults(null);
                setNotices([]);
              }}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gigs">Gigs</SelectItem>
                  <SelectItem value="assets">Assets</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleDownloadTemplate}
                className="flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download Template
              </Button>
              <p className="text-sm text-gray-500">
                Download a CSV template with example data
              </p>
            </div>
            {importType === 'assets' && (
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={downloadAssetExample} className="flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Download Example
                </Button>
                <p className="text-sm text-gray-500">
                  A microphone purchase that goes into a kit: serial numbers and tags separated by &quot;;&quot;, a lot, and an expensed line
                </p>
              </div>
            )}
            {importType === 'assets' && <AssetColumnGuide />}
          </div>
        </Card>

        {/* File Upload */}
        <Card className="p-6 mb-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Upload CSV File</Label>
              {(validRows.length > 0 || invalidRows.length > 0) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setFile(null);
                    setValidRows([]);
                    setInvalidRows([]);
                    setImportResults(null);
                    setNotices([]);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                >
                  Start New Import
                </Button>
              )}
            </div>
            <div
              onDrop={handleFileDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-sky-400 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileInputChange}
                className="hidden"
              />
              {isProcessing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
                  <p className="text-gray-600">Processing CSV file...</p>
                </div>
              ) : file ? (
                <div className="flex flex-col items-center gap-2">
                  <FileText className="w-8 h-8 text-sky-500" />
                  <p className="text-gray-900 font-medium">{file.name}</p>
                  <p className="text-sm text-gray-500">Click to select a different file</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-gray-400" />
                  <p className="text-gray-900 font-medium">Drop CSV file here or click to browse</p>
                  <p className="text-sm text-gray-500">Supports .csv files</p>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Notes about the file that don't block it (#183 D) */}
        {notices.length > 0 && (
          <Card className="p-4 mb-6 border-amber-200 bg-amber-50">
            {notices.map((n) => (
              <p key={n} className="text-sm text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                {n}
              </p>
            ))}
          </Card>
        )}

        {/* Results Summary */}
        {/* Results Summary */}
        {(validRows.length > 0 || invalidRows.length > 0) && (
          <ImportSummaryCard
            importType={importType}
            validCount={validRows.length}
            invalidCount={invalidRows.length}
            assetPlan={assetPlan}
            readyCount={importType === 'assets' ? purchasesIn('ready').length : getReadyToImportRows().length}
            failedCount={purchasesIn('failed').length}
            heldCount={purchasesIn('held').length}
            isImporting={isImporting}
            onImport={handleImportValidRows}
            onRetryFailed={() => handleImportAssets('failed')}
          />
        )}

        {/* The preview couldn't be planned: say so, rather than break the screen (#183 D). */}
        {assetPlanError && (
          <Card className="p-4 mb-6 border-red-200 bg-red-50">
            <p className="text-sm text-red-800 flex items-start gap-2">
              <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
              {`Couldn’t build the import preview: ${assetPlanError}`}
            </p>
          </Card>
        )}
        {/* Import Progress & Results */}
        {(isImporting || importResults) && (
          <ImportProgressCard
            importType={importType}
            isImporting={isImporting}
            importResults={importResults}
            validRows={validRows}
            invalidCount={invalidRows.length}
            readyCount={getReadyToImportRows().length}
          />
        )}

        {/* Invalid Rows Table with Editing */}
        {invalidRows.length > 0 && (
          <InvalidRowsCard
            importType={importType}
            invalidRows={invalidRows}
            isImporting={isImporting}
            onEdit={handleEditInvalidRow}
            onRevalidate={handleRevalidateInvalidRows}
          />
        )}

        {/* Valid Rows Table */}
        {validRows.length > 0 && <ValidRowsTable importType={importType} validRows={validRows} assetPlan={assetPlan} />}
      </div>
    </div>
  );
}
