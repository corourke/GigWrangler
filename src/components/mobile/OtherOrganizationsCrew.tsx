import { Card, CardContent } from '../ui/card';
import { Mail, MessageSquare, Phone, Users } from 'lucide-react';
import { smsHref, telHref } from '../../utils/contactLinks';
import type { DayOfShowCrew } from '../../services/mobile/dayOfShow.service';

const ACTION = 'inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-md border border-border text-xs font-medium bg-background active:bg-muted';

/** Crew of the other organizations on the gig, read-only, with how to reach them (#466). */
export default function OtherOrganizationsCrew({ crew }: { crew: DayOfShowCrew[] }) {
  if (crew.length === 0) return null;
  return (
    <Card style={{ gap: 0 }}>
      <CardContent className="p-3" style={{ paddingBottom: '12px' }}>
        <p className="text-[11px] font-semibold flex items-center gap-1.5 text-muted-foreground mb-2">
          <Users className="w-3.5 h-3.5" />
          Other organizations' crew
        </p>
        <div className="divide-y divide-border/50">
          {crew.map((p) => {
            const call = telHref(p.phone);
            const text = smsHref(p.phone);
            const detail = [p.role, p.org_name].filter(Boolean).join(' · ');
            return (
              <div key={p.key} className="py-2 first:pt-0 last:pb-0">
                <p className="text-sm font-medium">{p.name}</p>
                {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
                {p.phone && <p className="text-sm select-text tabular-nums mt-0.5">{p.phone}</p>}
                {p.email && <p className="text-xs select-text text-muted-foreground break-all">{p.email}</p>}
                {(call || p.email) && (
                  <div className="flex gap-2 mt-1.5">
                    {call && <a className={ACTION} href={call} aria-label={`Call ${p.name}`}><Phone className="w-4 h-4" />Call</a>}
                    {text && <a className={ACTION} href={text} aria-label={`Text ${p.name}`}><MessageSquare className="w-4 h-4" />Text</a>}
                    {p.email && <a className={ACTION} href={`mailto:${p.email}`} aria-label={`Email ${p.name}`}><Mail className="w-4 h-4" />Email</a>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
