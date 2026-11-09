import React from 'react';
import {
  Calendar as CalendarIcon,
  Edit,
  Copy,
  Trash2,
  Eye,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../ui/utils';
import {Gig } from '../../utils/supabase/types';
import { GIG_STATUS_CONFIG, getTagColor } from '../../utils/supabase/constants';
import { formatDateTimeDisplay, isGigAllDay } from '../../utils/dateUtils';

interface GigTableProps {
  gigs: Gig[];
  mode: 'list' | 'dashboard'; // Controls which columns and features to show
  showActions?: boolean;
  onGigClick?: (gigId: string) => void;
  onGigEdit?: (gigId: string) => void;
  onGigDuplicate?: (gigId: string) => void;
  onGigDelete?: (gigId: string) => void;
  loading?: boolean;
  emptyMessage?: string;
  onCreateGig?: () => void;
}



export default function GigTable({
  gigs,
  mode,
  showActions = true,
  onGigClick,
  onGigEdit,
  onGigDuplicate,
  onGigDelete,
  loading = false,
  emptyMessage = 'No gigs found',
  onCreateGig,
}: GigTableProps) {
  const formatDateTime = (gig: Gig) => formatDateTimeDisplay(gig.start, gig.end, gig.timezone, isGigAllDay(gig));

  // Dashboard mode shows all columns but no inline editing, limited rows
  const displayGigs = mode === 'dashboard' ? gigs.slice(0, 5) : gigs;
  const showVenueActColumns = true; // Show in both modes
  const showTagsColumn = mode === 'list'; // Only show tags in list mode

  if (loading) {
    return (
      <Card className="p-6">
        <Table>
          <TableHeader>
            <TableRow>
              {showActions && <TableHead className="w-12"></TableHead>}
              <TableHead>Title</TableHead>
              <TableHead>Date & Time</TableHead>
              <TableHead>Status</TableHead>
              {showVenueActColumns && <TableHead>Venue</TableHead>}
              {showVenueActColumns && <TableHead>Act</TableHead>}
              {showTagsColumn && <TableHead>Tags</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3, 4, 5].map((i) => (
              <TableRow key={i}>
                {showActions && <TableCell><Skeleton className="h-8 w-8" /></TableCell>}
                <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                {showVenueActColumns && <TableCell><Skeleton className="h-5 w-32" /></TableCell>}
                {showVenueActColumns && <TableCell><Skeleton className="h-5 w-32" /></TableCell>}
                {showTagsColumn && <TableCell><Skeleton className="h-5 w-24" /></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    );
  }

  if (displayGigs.length === 0) {
    return (
      <Card className="p-6">
        <div className="max-w-md mx-auto">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CalendarIcon className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-gray-900 mb-2">{emptyMessage}</h3>
          <p className="text-gray-600 mb-6">
            {mode === 'dashboard'
              ? 'Upcoming gigs will appear here'
              : 'Create your first gig to get started'}
          </p>
          {mode === 'list' && onCreateGig && (
            <Button onClick={onCreateGig} className="bg-sky-500 hover:bg-sky-600 text-white">
              <Edit className="w-4 h-4 mr-2" />
              Create First Gig
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <>
      {mode === 'list' && (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Showing {displayGigs.length} {displayGigs.length === 1 ? 'gig' : 'gigs'}
          </p>
        </div>
      )}

      <Card className="p-6">
        <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Title</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Status</TableHead>
                {showVenueActColumns && <TableHead>Venue</TableHead>}
                {showVenueActColumns && <TableHead>Act</TableHead>}
                {showTagsColumn && <TableHead>Tags</TableHead>}
                {showActions && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayGigs.map((gig) => (
                <TableRow
                  key={gig.id}
                  className={cn(
                    (onGigClick || onGigEdit) ? 'hover:bg-gray-50' : ''
                  )}
                  onClick={() => {
                    if (mode === 'dashboard' && onGigEdit) {
                      onGigEdit(gig.id);
                    } else if (onGigClick) {
                      onGigClick(gig.id);
                    }
                  }}
                >
                  <TableCell>
                    <div className="text-sm text-gray-900">
                      {gig.title || <span className="text-gray-400 italic">Untitled Gig</span>}
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="text-sm text-gray-700">
                      {formatDateTime(gig)}
                    </div>
                  </TableCell>

                  <TableCell>
                    <Badge variant="outline" className={`truncate ${GIG_STATUS_CONFIG[gig.status].color}`}>
                      {GIG_STATUS_CONFIG[gig.status].label}
                    </Badge>
                  </TableCell>

                  {showVenueActColumns && (
                    <TableCell>
                      {gig.venue ? (
                        <Badge variant="outline" className="truncate bg-gray-100 text-gray-800 border-gray-200">
                          {gig.venue.name}
                        </Badge>
                      ) : (
                        <span className="text-gray-400 italic">-</span>
                      )}
                    </TableCell>
                  )}

                  {showVenueActColumns && (
                    <TableCell>
                      {gig.act ? (
                        <Badge variant="outline" className="truncate bg-gray-100 text-gray-800 border-gray-200">
                          {gig.act.name}
                        </Badge>
                      ) : (
                        <span className="text-gray-400 italic">-</span>
                      )}
                    </TableCell>
                  )}

                  {showTagsColumn && (
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {gig.tags?.map((tag, index) => (
                          <Badge key={index} variant="outline" className={`${getTagColor(tag)} text-[10px] h-4 py-0`}>
                            {tag}
                          </Badge>
                        )) || <span className="text-gray-400">-</span>}
                      </div>
                    </TableCell>
                  )}

                  {showActions && (
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      {onGigClick && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-gray-500 hover:text-sky-600"
                          onClick={() => onGigClick(gig.id)}
                          title="View"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      {onGigEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-gray-500 hover:text-sky-600"
                          onClick={() => onGigEdit(gig.id)}
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                      {onGigDuplicate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-gray-500 hover:text-sky-600"
                          onClick={() => onGigDuplicate(gig.id)}
                          title="Duplicate"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                      {onGigDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-gray-500 hover:text-red-600"
                          onClick={() => onGigDelete(gig.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
          </Table>
        </div>
      </Card>
    </>
  );
}
