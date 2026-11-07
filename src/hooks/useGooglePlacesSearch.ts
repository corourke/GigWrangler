/**
 * Google Places business search, shared by OrganizationScreen (create mode)
 * and QuickCreateOrganizationDialog (#111). Searches through the server's
 * google-places proxy, then fetches each result's details (phone, website,
 * address components). A failed request sets `searchError`, which callers
 * must show apart from "no results found" (#29).
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '../utils/supabase/client';
import { handleFunctionsError } from '../utils/api-error-utils';
import { safeHref } from '../utils/safeHref';

export interface GooglePlace {
  place_id: string;
  name: string;
  formatted_address: string;
  formatted_phone_number?: string;
  website?: string;
  editorial_summary?: string;
  address_components: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
}

/** Organization fields a picked place fills; '' where Google has no value. */
export interface PlaceOrganizationFields {
  name: string;
  url: string;
  phone_number: string;
  description: string;
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

function parseAddressComponents(components: GooglePlace['address_components'] = []) {
  const address: {
    street_number?: string;
    route?: string;
    locality?: string;
    administrative_area_level_1?: string;
    postal_code?: string;
    country?: string;
  } = {};

  components.forEach(component => {
    if (component.types.includes('street_number')) {
      address.street_number = component.long_name;
    } else if (component.types.includes('route')) {
      address.route = component.long_name;
    } else if (component.types.includes('locality')) {
      address.locality = component.long_name;
    } else if (component.types.includes('sublocality_level_1')) {
      // Fallback for cities like NYC
      if (!address.locality) address.locality = component.long_name;
    } else if (component.types.includes('administrative_area_level_1')) {
      address.administrative_area_level_1 = component.short_name;
    } else if (component.types.includes('postal_code')) {
      address.postal_code = component.long_name;
    } else if (component.types.includes('country')) {
      address.country = component.long_name;
    }
  });

  return address;
}

export function placeToOrganizationFields(place: GooglePlace): PlaceOrganizationFields {
  const addressParts = parseAddressComponents(place.address_components);
  return {
    name: place.name || '',
    url: safeHref(place.website) ? place.website!.trim() : '',
    phone_number: place.formatted_phone_number || '',
    description: place.editorial_summary || '',
    address_line1: [addressParts.street_number, addressParts.route].filter(Boolean).join(' '),
    city: addressParts.locality || '',
    state: addressParts.administrative_area_level_1 || '',
    postal_code: addressParts.postal_code || '',
    country: addressParts.country || '',
  };
}

export function useGooglePlacesSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<GooglePlace[]>([]);
  const [showResults, setShowResults] = useState(false);
  /** True when the search request itself failed — must render distinctly from "no results found", since those mean very different things to the user. */
  const [searchError, setSearchError] = useState(false);

  const search = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setShowResults(true);
    setSearchError(false);

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        toast.error('Not authenticated. Please sign in again.');
        setIsSearching(false);
        setShowResults(false);
        return;
      }

      // Get user's location for proximity-based sorting
      let userLocation: { latitude: number; longitude: number } | null = null;

      try {
        if (navigator.geolocation) {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 5000,
              enableHighAccuracy: false,
            });
          });
          userLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
        }
      } catch (geoError) {
        // Silently fail - search will still work without location
        console.warn('Geolocation not available or denied:', geoError);
      }

      const searchParams: any = { query: searchQuery };
      if (userLocation) {
        searchParams.latitude = userLocation.latitude;
        searchParams.longitude = userLocation.longitude;
      }

      const queryStr = new URLSearchParams(searchParams).toString();
      const { data: searchResult, error: invokeError } = await supabase.functions.invoke(`server/integrations/google-places/search?${queryStr}`, {
        method: 'GET'
      });

      if (invokeError) {
        await handleFunctionsError(invokeError, 'search places');
      }

      const placeResults = searchResult?.results;

      if (!placeResults || placeResults.length === 0) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      // Fetch details for each place to get phone, website, etc.
      const detailedResults = await Promise.all(
        placeResults.map(async (place: any) => {
          try {
            const { data: details, error: detailsError } = await supabase.functions.invoke(`server/integrations/google-places/${place.place_id}`, {
              method: 'GET'
            });

            if (!detailsError && details) {
              return details;
            }
            // If details fetch fails, return basic info
            return place;
          } catch {
            return place;
          }
        })
      );

      setSearchResults(detailedResults);
      setIsSearching(false);
    } catch (error: any) {
      console.error('Error searching places:', error);
      setSearchResults([]);
      setSearchError(true);
      setIsSearching(false);
    }
  };

  /** Hide the results and clear the query, e.g. after a pick or on manual entry. */
  const dismiss = () => {
    setShowResults(false);
    setSearchError(false);
    setSearchQuery('');
  };

  return { searchQuery, setSearchQuery, isSearching, searchResults, showResults, searchError, search, dismiss };
}
