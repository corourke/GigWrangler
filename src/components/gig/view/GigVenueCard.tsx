import type { Organization } from '../../../utils/supabase/types';
import { useGigParticipantContacts } from '../useGigParticipantContacts';
import GigSection from './GigSection';
import ExternalLink from '../../ExternalLink';

interface GigVenueCardProps {
  gigId: string;
  venue?: Partial<Organization> | null;
}

/** The venue's address, main line and main contact for this gig (#12). */
export default function GigVenueCard({ gigId, venue }: GigVenueCardProps) {
  const { data: contacts = [] } = useGigParticipantContacts(gigId, venue?.id ?? '');
  const main = contacts[0];

  if (!venue) {
    return (
      <GigSection title="Venue">
        <p className="text-sm text-muted-foreground italic">No venue yet</p>
      </GigSection>
    );
  }

  const cityLine = [venue.city, [venue.state, venue.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return (
    <GigSection title="Venue">
      <div className="text-sm flex flex-col gap-0.5">
        <span className="font-semibold">{venue.name}</span>
        {venue.address_line1 && <span>{venue.address_line1}</span>}
        {venue.address_line2 && <span>{venue.address_line2}</span>}
        {cityLine && <span>{cityLine}</span>}
        {(venue.phone_number || venue.url) && (
          <span>
            {venue.phone_number && <>Main <a className="text-sky-700 hover:underline" href={`tel:${venue.phone_number}`}>{venue.phone_number}</a></>}
            {venue.phone_number && venue.url && ' · '}
            {venue.url && <ExternalLink url={venue.url} label={venue.url.replace(/^https?:\/\//, '')} />}
          </span>
        )}
      </div>
      {main?.user && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground pt-1">Main contact</p>
          <div className="text-sm flex flex-col gap-0.5">
            <span className="font-semibold">
              {main.user.first_name} {main.user.last_name}
              {main.title && <span className="font-normal text-muted-foreground"> · {main.title}</span>}
            </span>
            {main.user.phone && <a className="text-sky-700 hover:underline" href={`tel:${main.user.phone}`}>{main.user.phone}</a>}
            {main.user.email && <a className="text-sky-700 hover:underline" href={`mailto:${main.user.email}`}>{main.user.email}</a>}
          </div>
        </>
      )}
    </GigSection>
  );
}
