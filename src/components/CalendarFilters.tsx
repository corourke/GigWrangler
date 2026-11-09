import React, { useState, useEffect, useCallback } from 'react';
import {Filter, Calendar as CalendarIcon } from 'lucide-react';
import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { format } from 'date-fns';
import { GigStatus } from '../utils/supabase/types';
import { GIG_STATUS_CONFIG } from '../utils/supabase/constants';
import { searchOrganizations } from '../services/organization.service';
import { searchUsers } from '../services/user.service';
import { Organization, User } from '../utils/supabase/types';

interface CalendarFiltersProps {
  // Status filter
  statusFilter: GigStatus | 'all';
  setStatusFilter: (status: GigStatus | 'all') => void;

  // Venue filter
  venueFilter: string | 'all';
  setVenueFilter: (venueId: string | 'all') => void;

  // Act filter
  actFilter: string | 'all';
  setActFilter: (actId: string | 'all') => void;

  // Staff filter
  staffFilter: string | 'all';
  setStaffFilter: (staffId: string | 'all') => void;

  // Date range filter
  dateFrom: Date | undefined;
  setDateFrom: (date: Date | undefined) => void;
  dateTo: Date | undefined;
  setDateTo: (date: Date | undefined) => void;

  // Clear filters
  onClearFilters: () => void;
  hasActiveFilters: boolean;

  // Organization context for filtering venues/acts/staff
  organizationId: string;
}

export function CalendarFilters({
  statusFilter,
  setStatusFilter,
  venueFilter,
  setVenueFilter,
  actFilter,
  setActFilter,
  staffFilter,
  setStaffFilter,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  onClearFilters,
  hasActiveFilters,
  organizationId,
}: CalendarFiltersProps) {
  const [venues, setVenues] = useState<Organization[]>([]);
  const [acts, setActs] = useState<Organization[]>([]);
  const [staff, setStaff] = useState<User[]>([]);
  const [_loading, setLoading] = useState(false);

  // Load filter options
  const loadFilterOptions = useCallback(async () => {
    setLoading(true);
    try {
      // Load venues and acts (organizations of type 'Venue' and 'Act')
      const [venueOrgs, actOrgs] = await Promise.all([
        searchOrganizations({ type: 'Venue' }),
        searchOrganizations({ type: 'Act' }),
      ]);
      setVenues(venueOrgs);
      setActs(actOrgs);

      // Load staff (users in the organization)
      const staffUsers = await searchUsers('', [organizationId]);
      setStaff(staffUsers);
    } catch (error) {
      console.error('Error loading filter options:', error);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as GigStatus | 'all')}>
            <SelectTrigger className="w-full lg:w-48">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                <SelectValue placeholder="All Statuses" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {Object.entries(GIG_STATUS_CONFIG).map(([value, config]) => (
                <SelectItem key={value} value={value}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Venue Filter */}
          <Select value={venueFilter} onValueChange={setVenueFilter}>
            <SelectTrigger className="w-full lg:w-48">
              <SelectValue placeholder="All Venues" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Venues</SelectItem>
              {venues.map((venue) => (
                <SelectItem key={venue.id} value={venue.id}>
                  {venue.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Act Filter */}
          <Select value={actFilter} onValueChange={setActFilter}>
            <SelectTrigger className="w-full lg:w-48">
              <SelectValue placeholder="All Acts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Acts</SelectItem>
              {acts.map((act) => (
                <SelectItem key={act.id} value={act.id}>
                  {act.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Staff Filter */}
          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger className="w-full lg:w-48">
              <SelectValue placeholder="All Staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Staff</SelectItem>
              {staff.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.first_name} {user.last_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date Range Filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full lg:w-auto justify-start">
                <CalendarIcon className="w-4 h-4 mr-2" />
                {dateFrom && dateTo
                  ? `${format(dateFrom, 'MMM dd')} - ${format(dateTo, 'MMM dd')}`
                  : dateFrom
                  ? `From ${format(dateFrom, 'MMM dd')}`
                  : dateTo
                  ? `Until ${format(dateTo, 'MMM dd')}`
                  : 'Date Range'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <div className="p-3 border-b">
                <p className="text-sm">Select date range</p>
              </div>
              <div className="flex gap-2 p-3">
                <div>
                  <p className="text-xs text-gray-600 mb-2">From</p>
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    initialFocus
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-2">To</p>
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    initialFocus
                  />
                </div>
              </div>
              <div className="p-3 border-t flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDateFrom(undefined);
                    setDateTo(undefined);
                  }}
                >
                  Clear
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Active Filters */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 mt-3">
            <p className="text-sm text-gray-600">Active filters:</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="h-7 text-xs"
            >
              Clear all
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}