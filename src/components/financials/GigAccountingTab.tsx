import { useState, useMemo } from 'react';
import { Alert, AlertDescription } from '../ui/alert';
import { Card } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { Organization, UserRole, GigAccountingSummary } from '../../utils/supabase/types';
import { useGigAccountingData } from './useGigAccountingData';
import {
  classifyGig,
  DEFAULT_TIMEFRAME,
  inTimeframe,
  SECTION_LABELS,
  SECTION_ORDER,
  timeframeRange,
  type AccountingSectionId,
  type TimeframePreset,
} from '../../utils/gigAccountingSections';
import GigAccountingFilters from './GigAccountingFilters';
import GigAccountingSummaryBar from './GigAccountingSummaryBar';
import GigAccountingTable, { GigSection } from './GigAccountingTable';
import GigAccountingCardView from './GigAccountingCardView';

interface GigAccountingTabProps {
  organization: Organization;
  userRole?: UserRole;
  onNavigateToGigDetail?: (gigId: string) => void;
}

const DEFAULT_SECTIONS: Record<AccountingSectionId, boolean> = {
  'needs-attention': true,
  upcoming: true,
  settled: false,
};

export default function GigAccountingTab({
  organization,
  userRole,
  onNavigateToGigDetail,
}: GigAccountingTabProps) {
  const { summaries, isLoading, error } = useGigAccountingData(organization.id);

  const [searchQuery, setSearchQuery] = useState('');
  const [timeframe, setTimeframe] = useState<TimeframePreset>(DEFAULT_TIMEFRAME);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [visibleSections, setVisibleSections] = useState(DEFAULT_SECTIONS);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');

  // Every gig in the timeframe (and search), sorted into its one section.
  const allSections = useMemo((): GigSection[] => {
    const range = timeframeRange(timeframe, new Date(), { from: customFrom, to: customTo });
    const q = searchQuery.trim().toLowerCase();
    const now = new Date();
    const buckets: Record<AccountingSectionId, GigAccountingSummary[]> = {
      'needs-attention': [],
      upcoming: [],
      settled: [],
    };
    for (const s of summaries) {
      if (q && !s.gigTitle.toLowerCase().includes(q)) continue;
      if (!inTimeframe(s, range)) continue;
      const id = classifyGig(s, now);
      if (id) buckets[id].push(s);
    }
    // Attention and settled: most recent first. Upcoming: soonest first.
    buckets['needs-attention'].sort((a, b) => b.gigStart.localeCompare(a.gigStart));
    buckets.upcoming.sort((a, b) => a.gigStart.localeCompare(b.gigStart));
    buckets.settled.sort((a, b) => b.gigStart.localeCompare(a.gigStart));
    return SECTION_ORDER.map((id) => ({ id, label: SECTION_LABELS[id], gigs: buckets[id], defaultCollapsed: false }));
  }, [summaries, searchQuery, timeframe, customFrom, customTo]);

  const sections = allSections.filter((s) => visibleSections[s.id]);
  const visibleGigs = useMemo(() => sections.flatMap((s) => s.gigs), [sections]);
  const sectionCounts = Object.fromEntries(allSections.map((s) => [s.id, s.gigs.length])) as Record<AccountingSectionId, number>;

  if (userRole !== 'Admin') {
    return (
      <Alert>
        <AlertDescription>Financial data is restricted to Admins.</AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <Card className="p-8 flex flex-col items-center gap-4">
        <Skeleton className="h-8 w-full max-w-sm" />
        <Skeleton className="h-4 w-full max-w-xs" />
        <Skeleton className="h-4 w-full max-w-xs" />
        <Skeleton className="h-64 w-full" />
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (summaries.length === 0) {
    return (
      <Card className="p-12 text-center text-gray-500">
        <p className="text-lg font-medium">No gigs found.</p>
        <p className="text-sm">Create your first gig to start tracking financials.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <GigAccountingFilters
        searchQuery={searchQuery}
        timeframe={timeframe}
        customFrom={customFrom}
        customTo={customTo}
        visibleSections={visibleSections}
        sectionCounts={sectionCounts}
        viewMode={viewMode}
        onSearchChange={setSearchQuery}
        onTimeframeChange={setTimeframe}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        onToggleSection={(id) => setVisibleSections((v) => ({ ...v, [id]: !v[id] }))}
        onViewModeChange={setViewMode}
      />

      <GigAccountingSummaryBar summaries={visibleGigs} />

      {sections.length === 0 && (
        <Card className="p-8 text-center text-gray-500 text-sm">All sections are off. Turn one on above.</Card>
      )}

      {viewMode === 'table' ? (
        <GigAccountingTable
          sections={sections}
          onNavigateToGigDetail={onNavigateToGigDetail}
          organizationId={organization.id}
        />
      ) : (
        <GigAccountingCardView
          sections={sections}
          onNavigateToGigDetail={onNavigateToGigDetail}
        />
      )}
    </div>
  );
}
