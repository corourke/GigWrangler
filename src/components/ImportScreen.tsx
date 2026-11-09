import { useState, useRef, useCallback, useMemo } from 'react';
import { Upload, Download, FileText, CheckCircle, XCircle, AlertCircle, Loader2, Save, RotateCcw, ChevronRight, Info, Package, Tag, Layers, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { Badge } from './ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { cn } from './ui/utils';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { Organization, User, UserRole } from '../utils/supabase/types';
import { GIG_STATUS_CONFIG } from '../utils/supabase/constants';
import { getTimezoneOptions } from '../utils/timezones';
import {
  parseAndValidateCSV,
  downloadTemplate,
  validateGigRow,
  validateAssetRow,
  revalidateAssetRows,
  downloadAssetExample,
  ASSET_COLUMN_GUIDE,
  type AssetColumnGuideGroup,
  type ImportType,
  type ParsedRow,
  type GigRow,
  type AssetRow,
  parseTags,
  findOrCreateOrganization,
} from '../utils/csvImport';
import { createGig } from '../services/gig.service';
import { importPurchases } from '../services/purchase.service';
import { getItems } from '../services/equipmentItem.service';
import { getKitOptions } from '../services/kit.service';
import { buildAssetImportPlan, type AssetImportPlan, type AssetImportSummary, type ExistingItem, type PurchaseState } from '../utils/csvAssetImportPlan';
import { searchOrganizations, createOrganization } from '../services/organization.service';
import { createClient } from '../utils/supabase/client';
import { 
  parseLocalToUTC, 
  formatGigDateTimeForDisplay, 
  formatGigDateTimeForInput, 
  parseGigDateTimeFromInput 
} from '../utils/dateUtils';

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
  /** The organization's items and kit names, which an assets import matches by name (#183 D). */
  const [catalog, setCatalog] = useState<{ items: ExistingItem[]; kitNames: string[] }>({ items: [], kitNames: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadCatalog = useCallback(async () => {
    try {
      const [items, kits] = await Promise.all([getItems(organization.id), getKitOptions(organization.id)]);
      const next = {
        items: (items ?? []).map((i) => ({ id: i.id, manufacturer_model: i.manufacturer_model, category: i.category,
          type: i.type, description: i.description, insurance_class: i.insurance_class })),
        kitNames: (kits ?? []).map((k) => k.name),
      };
      setCatalog(next);
      return next;
    } catch (error) {
      console.error('Error loading items and kits for the import:', error);
      toast.warning('Couldn’t load your items and kits, so the preview treats every item and kit as new. Saving still reuses them.');
      return null;
    }
  }, [organization.id]);

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

      const result = await importPurchases(organization.id, { purchases }, (count) => {
        setImportResults({ success: count, errors: [] }); // Partial update
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
      // Items and kits made by this import are matched by the next one.
      void loadCatalog();

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

            const gigData = row.data as GigRow;
            
            // Find or create act/venue organizations
            let actOrgId: string | undefined;
            let venueOrgId: string | undefined;

            if (gigData.act && gigData.act.trim()) {
              const actOrg = await findOrCreateOrganization(
                gigData.act,
                'Act',
                searchOrganizations,
                async (orgData) => {
                  const created = await createOrganization({
                    name: orgData.name,
                    roles: orgData.roles,
                    autoJoin: false,
                  });
                  return created;
                }
              );
              actOrgId = actOrg.id;
            }

            if (gigData.venue && gigData.venue.trim()) {
              const venueOrg = await findOrCreateOrganization(
                gigData.venue,
                'Venue',
                searchOrganizations,
                async (orgData) => {
                  const created = await createOrganization({
                    name: orgData.name,
                    roles: orgData.roles,
                    autoJoin: false,
                  });
                  return created;
                }
              );
              venueOrgId = venueOrg.id;
            }

            // Create gig
            const participants: Array<{ organization_id: string; role: string }> = [];
            if (actOrgId) {
              participants.push({ organization_id: actOrgId, role: 'Act' });
            }
            if (venueOrgId) {
              participants.push({ organization_id: venueOrgId, role: 'Venue' });
            }
            // Add current organization as participant
            participants.push({ organization_id: organization.id, role: organization.roles?.[0] || 'Production' });

            await createGig({
              title: gigData.title,
              start: parseLocalToUTC(gigData.start, gigData.timezone),
              end: parseLocalToUTC(gigData.end, gigData.timezone),
              all_day: gigData.all_day ?? false,
              timezone: gigData.timezone,
              status: gigData.status as any,
              tags: parseTags(gigData.tags),
              notes: gigData.notes || undefined,
              amount: gigData.amount ? parseFloat(gigData.amount) : undefined,
              primary_organization_id: organization.id,
              participants: participants,
            }, { skipActivityLog: true });

            // Mark as success
            row.importStatus = 'success';
            row.importError = undefined;
            setValidRows(prev => prev.map(r => r.rowIndex === row.rowIndex ? row : r));
            successCount++;
          } catch (error: any) {
            let errorMessage = 'Failed to import gig';
            
            // Provide user-friendly error messages
            if (error.message) {
              if (error.message.includes('duplicate key value')) {
                errorMessage = 'A gig with similar data already exists';
              } else if (error.message.includes('invalid input syntax')) {
                errorMessage = 'Invalid date or time format';
              } else if (error.message.includes('foreign key constraint')) {
                errorMessage = 'Related organization not found';
              } else if (error.message.includes('not null constraint')) {
                errorMessage = 'Missing required field';
              } else if (error.message.includes('check constraint')) {
                errorMessage = 'Invalid data format or value';
              } else {
                errorMessage = error.message.length > 100 ? 
                  error.message.substring(0, 100) + '...' : 
                  error.message;
              }
            }
            
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
        {(validRows.length > 0 || invalidRows.length > 0) && (
          <Card className="p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Import Summary</h2>
              <div className="flex items-center gap-2">
                {/* Assets: a purchase that failed to save is retried alone (#183 D). */}
                {importType === 'assets' && !isImporting && purchasesIn('failed').length > 0 && (
                  <Button variant="outline" onClick={() => handleImportAssets('failed')}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Retry {purchasesIn('failed').length} Failed Purchase(s)
                  </Button>
                )}
                {(() => {
                  const readyCount = importType === 'assets' ? purchasesIn('ready').length : getReadyToImportRows().length;
                  return readyCount > 0 && (
                    <Button
                      onClick={handleImportValidRows}
                      disabled={isImporting}
                      className="bg-sky-500 hover:bg-sky-600 text-white"
                    >
                      {isImporting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4 mr-2" />
                          {/* Assets import whole purchases: only those with every row valid. */}
                          {importType === 'assets' ? `Import ${readyCount} Complete Purchase(s)` : `Import ${readyCount} Ready Row(s)`}
                        </>
                      )}
                    </Button>
                  );
                })()}
              </div>
            </div>
            {/* What the file will create, before anything is saved (mockup 11, #183 D2). */}
            {(() => {
              const summary = importType === 'assets' ? assetPlan?.summary : undefined;
              const kits = summary ? [...summary.kitsNew, ...summary.kitsExisting] : [];
              return (
                <>
                  <div className={cn('grid grid-cols-2 gap-3', !summary ? '' : kits.length ? 'md:grid-cols-3 lg:grid-cols-5' : 'md:grid-cols-4')}>
                    <SummaryCard label="Valid rows" icon={CheckCircle} tone="green" value={validRows.length} />
                    <SummaryCard
                      label="Invalid rows"
                      icon={XCircle}
                      tone="red"
                      value={invalidRows.length}
                      detail={summary?.rowsHeld
                        ? `${plural(summary.rowsHeld, 'more row')} held with ${invalidRows.length === 1 ? 'it' : 'them'}`
                        : undefined}
                    />
                    {summary && <AssetSummaryCards summary={summary} />}
                  </div>
                  {summary && summary.notes.length > 0 && (
                    <ul aria-label="Notes on the rows" className="mt-3 space-y-1">
                      {summary.notes.map((n) => (
                        <li key={`${n.rowIndex}-${n.text}`} className="text-sm text-gray-700 flex items-start gap-2">
                          <Info className="w-4 h-4 mt-0.5 shrink-0 text-sky-600" aria-hidden />
                          {`Row ${n.rowIndex}: ${n.text}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              );
            })()}
            {importType === 'assets' && purchasesIn('held').length > 0 && (
              <p className="text-sm text-amber-800 mt-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                {purchasesIn('held').length === 1
                  ? '1 purchase held back until its invalid rows are fixed.'
                  : `${purchasesIn('held').length} purchases held back until their invalid rows are fixed.`}
              </p>
            )}
          </Card>
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
                  const totalReady = getReadyToImportRows().length + importingCount + successCount + failedCount;
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
                {invalidRows.length > 0 && (
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
        )}

        {/* Invalid Rows Table with Editing */}
        {invalidRows.length > 0 && (
          <Card className="p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-600" />
                Invalid Rows ({invalidRows.length})
              </h2>
              <Button
                variant="outline"
                onClick={handleRevalidateInvalidRows}
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
                                  onChange={(e) => handleEditInvalidRow(row.rowIndex, 'title', e.target.value)}
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
                                    handleEditInvalidRow(row.rowIndex, 'start', utcValue);
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
                                    handleEditInvalidRow(row.rowIndex, 'end', utcValue);
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
                                  onValueChange={(value) => handleEditInvalidRow(row.rowIndex, 'timezone', value)}
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
                                  onValueChange={(value) => handleEditInvalidRow(row.rowIndex, 'status', value)}
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
                                  onChange={(e) => handleEditInvalidRow(row.rowIndex, 'act', e.target.value)}
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
                                  onChange={(e) => handleEditInvalidRow(row.rowIndex, 'venue', e.target.value)}
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
                            onChange={(e) => handleEditInvalidRow(row.rowIndex, 'category', e.target.value)}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Manufacturer/Model</Label>
                          <Input
                            value={(row.data as AssetRow).manufacturer_model}
                            onChange={(e) => handleEditInvalidRow(row.rowIndex, 'manufacturer_model', e.target.value)}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Acquisition Date</Label>
                          <Input
                            value={(row.data as AssetRow).acquisition_date}
                            onChange={(e) => handleEditInvalidRow(row.rowIndex, 'acquisition_date', e.target.value)}
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
                                onChange={(e) => handleEditInvalidRow(row.rowIndex, field, e.target.value)}
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
        )}

        {/* Valid Rows Table */}
        {validRows.length > 0 && (
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
        )}
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const CARD_TONES = {
  green: { box: 'bg-green-50', label: 'text-green-800', value: 'text-green-900' },
  red: { box: 'bg-red-50', label: 'text-red-800', value: 'text-red-900' },
  gray: { box: 'bg-gray-50', label: 'text-gray-700', value: 'text-gray-900' },
  sky: { box: 'bg-sky-50', label: 'text-sky-800', value: 'text-sky-900' },
} as const;

/** One card of the import summary (mockup 11). */
function SummaryCard({ label, value, detail, icon: Icon, tone }: {
  label: string;
  value: string | number;
  detail?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone: keyof typeof CARD_TONES;
}) {
  const t = CARD_TONES[tone];
  return (
    <div role="group" aria-label={label} className={cn('rounded-lg p-3', t.box)}>
      <div className={cn('flex items-center gap-2 text-sm', t.label)}>
        {Icon && <Icon className="w-4 h-4" />}
        {label}
      </div>
      <div className={cn('text-2xl', t.value)}>{value}</div>
      {detail && <div className="text-xs text-gray-500">{detail}</div>}
    </div>
  );
}

/** What an assets file will create: items new and existing, units and lots, lines, and kits (#183 D2). */
function AssetSummaryCards({ summary: s }: { summary: AssetImportSummary }) {
  const kits = s.kitsNew.length + s.kitsExisting.length;
  return (
    <>
      <SummaryCard label="Items" tone="gray" value={s.itemsNew + s.itemsMatched} detail={`${s.itemsNew} new · ${s.itemsMatched} existing`} />
      <SummaryCard
        label="Creates"
        tone="sky"
        value={`${plural(s.units, 'unit')}, ${plural(s.lots, 'lot')}`}
        detail={`${plural(s.pieces, 'piece')} on ${plural(s.lines, 'purchase line')} in ${plural(s.purchases, 'purchase')}`}
      />
      {kits > 0 && (
        <SummaryCard
          label="Kits"
          tone="gray"
          value={kits}
          detail={(
            <>
              {s.kitsNew.length > 0 && <div>{`New: ${s.kitsNew.join(', ')}`}</div>}
              {s.kitsExisting.length > 0 && <div>{`Adds to: ${s.kitsExisting.join(', ')}`}</div>}
            </>
          )}
        />
      )}
    </>
  );
}

const GUIDE_GROUP_STYLE: Record<AssetColumnGuideGroup['group'], { box: string; icons: React.ComponentType<{ className?: string }>[] }> = {
  item: { box: 'border-gray-200 bg-gray-50', icons: [Package] },
  unit: { box: 'border-sky-200 bg-sky-50/50', icons: [Tag, Layers] },
  line: { box: 'border-green-200 bg-green-50/50', icons: [Receipt] },
};

/** The assets template's columns, grouped as in the template, with a word on each (mockup 11, #183 D2). */
function AssetColumnGuide() {
  return (
    <Collapsible className="border-t pt-4">
      <CollapsibleTrigger asChild>
        <button type="button" className="group flex items-center gap-2 text-sm font-medium text-gray-900 hover:text-sky-700">
          <ChevronRight className="w-4 h-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
          Template columns: one row per unit or lot
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {ASSET_COLUMN_GUIDE.map((g) => {
            const style = GUIDE_GROUP_STYLE[g.group];
            const headingId = `import-columns-${g.group}`;
            return (
              <section key={g.group} aria-labelledby={headingId} className={cn('rounded-lg border p-3', style.box)}>
                <h3 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  {style.icons.map((Icon, i) => <Icon key={i} className="w-3.5 h-3.5 text-gray-600" aria-hidden />)}
                  {g.title}
                </h3>
                <p className="text-xs text-gray-600 mb-2">{g.summary}</p>
                <dl className="space-y-1.5">
                  {g.columns.map((c) => (
                    <div key={c.name}>
                      <dt>
                        <code className={cn(
                          'inline-flex items-center rounded border bg-white px-1.5 py-0.5 font-mono text-[11.5px]',
                          c.required ? 'border-gray-400 font-semibold text-gray-900' : 'border-gray-200 text-gray-700',
                        )}>
                          {c.name}
                        </code>
                        {c.required && <span className="sr-only"> (required)</span>}
                      </dt>
                      <dd className="text-xs text-gray-600 mt-0.5">{c.description}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Columns in bold are needed: a model and category on every equipment row, and a date on every purchase. Files are read by column name, so the order doesn’t matter.
          Not imported: <span className="font-mono">status</span> (imported equipment is Active), and{' '}
          <span className="font-mono">retired_on</span> and <span className="font-mono">liquidation_amt</span> (record sales and retirements on the equipment page).
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
