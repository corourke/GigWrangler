import { AlertTriangle, Loader2, User as UserIcon } from 'lucide-react';
import type { PersonMatch } from '../../utils/supabase/types';

interface PersonMatchResultsProps {
  matches: PersonMatch[];
  isLoading: boolean;
  hasQuery: boolean;
  onSelect: (match: PersonMatch) => void;
  emptyHint?: string;
  /** True when the search itself failed — must render distinctly from "no matches found", since those mean very different things. */
  isError?: boolean;
}

/**
 * Renders system-wide person-search matches found by usePersonMatches, for
 * the caller to offer "use this person instead of creating a new one" —
 * this is what prevents duplicate people, so a match found here is never
 * scoped to just the current organization. Renders nothing until there's an
 * actual query, so it never implies "no matches" before a search has even
 * happened.
 */
export default function PersonMatchResults({
  matches,
  isLoading,
  hasQuery,
  onSelect,
  emptyHint = "No existing match — you'll create a new person.",
  isError = false,
}: PersonMatchResultsProps) {
  if (!hasQuery) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-gray-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking for an existing match...
      </div>
    );
  }

  // Deliberately distinct from the "no matches" state below — a failed check
  // is not the same as a clean one, and must never be mistaken for it.
  if (isError) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-red-700">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        Couldn't check for existing matches — double-check this isn't a duplicate before adding.
      </div>
    );
  }

  if (matches.length === 0) {
    return <p className="text-xs text-gray-500 py-1">{emptyHint}</p>;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-amber-700">
        Found {matches.length === 1 ? 'a possible match' : `${matches.length} possible matches`}:
      </p>
      <div className="border border-amber-200 rounded-lg divide-y bg-amber-50/40 max-h-48 overflow-y-auto">
        {matches.map((m) => (
          <button
            type="button"
            key={m.id}
            onClick={() => onSelect(m)}
            className="w-full text-left px-3 py-2 hover:bg-amber-50 flex items-center gap-2"
          >
            <div className="p-1.5 bg-white rounded-full border border-amber-200 shrink-0">
              <UserIcon className="w-3.5 h-3.5 text-amber-700" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm truncate">{m.first_name} {m.last_name}</p>
              <p className="text-xs text-gray-500 truncate">
                {personMatchDetail(m)}
              </p>
            </div>
            <span className="text-xs text-amber-700 font-medium shrink-0">Use this person</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The line under a match's name: why it matched, when that isn't obvious. */
export function personMatchDetail(m: PersonMatch): string {
  return m.matched_on === 'phone' ? 'same phone' : m.matched_on === 'similar name' ? 'similar name' : '';
}
