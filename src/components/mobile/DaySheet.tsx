import React from 'react';
import {
  Check,
  Clock,
  Download,
  FileText,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Share2,
  Users,
  X,
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { toast } from 'sonner';
import { useDayOfShowDocuments, useKeepDayOfShowSheet } from './useDayOfShowData';
import { getSavedDocument, SAVE_REFUSAL } from '../../services/mobile/dayOfShowFiles.service';
import type { DayOfShowFile } from '../../utils/idb/store';
import { addressLines, mapsHref, smsHref, telHref } from '../../utils/contactLinks';
import { formatFileSize } from '../../utils/fileSize';
import { formatDateTimeDisplay, formatInTimeZone, formatTimeDisplay, isGigAllDay } from '../../utils/dateUtils';
import { GIG_STATUS_CONFIG, SCHEDULE_ACTIVITY_CONFIG } from '../../utils/supabase/constants';
import { getAttachmentUrl } from '../../services/attachment.service';
import type { DayOfShowDocument, DayOfShowPerson, DayOfShowSheet } from '../../services/mobile/dayOfShow.service';
import type { GigStatus } from '../../utils/supabase/types';


const SECTION_TITLE = 'text-[11px] font-semibold flex items-center gap-1.5 text-muted-foreground mb-2 uppercase tracking-wide';
const ACTION = 'inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-md border border-border text-xs font-medium bg-background active:bg-muted';

/**
 * A gig's day-of-show sheet (§3e): schedule, venue, contacts, crew and documents. Shown on the
 * Today tab and, for any gig, at /gigs/:id/day-sheet (#445).
 */
export default function DaySheet({ sheet, isOffline, onViewGigDetail }: { sheet: DayOfShowSheet; isOffline: boolean; onViewGigDetail: (id: string) => void }) {
  const { gig } = sheet;
  const tz = gig.timezone || undefined;
  const status = GIG_STATUS_CONFIG[gig.status as GigStatus];
  const savedAt = formatInTimeZone(new Date(sheet.saved_at), tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <>
      <Card style={{ gap: 0 }}>
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-tight">{gig.title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatDateTimeDisplay(gig.start, gig.end ?? gig.start, tz, isGigAllDay(gig))}
              </p>
            </div>
            {status && (
              <Badge variant="outline" className={cn('text-[10px] shrink-0', status.color)}>{status.label}</Badge>
            )}
          </div>
          <KeepRow sheet={sheet} isOffline={isOffline} />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-muted-foreground">{sheet.kept ? `Saved on this phone · ${savedAt}` : `Updated ${savedAt}`}</span>
            {!isOffline && (
              <button type="button" className="text-xs text-primary font-medium" onClick={() => onViewGigDetail(gig.id)}>
                Open gig
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <ScheduleSection sheet={sheet} />
      <VenueSection sheet={sheet} />
      <PeopleSection title="Contacts" people={sheet.contacts} />
      <PeopleSection title="Crew" people={sheet.crew} />
      <DocumentsSection sheet={sheet} isOffline={isOffline} />
    </>
  );
}

/** Save on this phone, or Saved on this phone · Remove (#445). Saving needs a connection. */
function KeepRow({ sheet, isOffline }: { sheet: DayOfShowSheet; isOffline: boolean }) {
  const { keep, forget } = useKeepDayOfShowSheet(sheet.gig_id);
  if (sheet.kept) {
    return (
      <div className="flex items-center justify-between mt-2 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800">
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          Saved on this phone
        </span>
        <button
          type="button"
          className="text-xs font-medium text-emerald-900 underline disabled:opacity-50"
          disabled={forget.isPending}
          onClick={() => forget.mutate(undefined, { onError: () => toast.error("Couldn't remove it. Try again.") })}
        >
          Remove
        </button>
      </div>
    );
  }
  if (isOffline) return null;
  return (
    <button
      type="button"
      className={cn(ACTION, 'w-full mt-2')}
      disabled={keep.isPending}
      onClick={() =>
        keep.mutate(undefined, {
          onSuccess: ({ roomShort }) => {
            if (roomShort) toast.error("Not enough room on this phone for this gig's documents. Remove a saved gig first.");
            else toast.success('Saved on this phone');
          },
          onError: () => toast.error("Couldn't save it. Try again."),
        })
      }
    >
      {keep.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
      Save on this phone
    </button>
  );
}

function ScheduleSection({ sheet }: { sheet: DayOfShowSheet }) {
  const tz = sheet.gig.timezone || undefined;
  const dayOf = (iso: string) => formatInTimeZone(iso, tz, { weekday: 'short', month: 'short', day: 'numeric' });
  const multiDay = new Set(sheet.schedule.map((e) => dayOf(e.start_time))).size > 1;
  return (
    <Card style={{ gap: 0 }}>
      <CardContent className="p-3">
        <p className={SECTION_TITLE}><Clock className="w-3.5 h-3.5" />Schedule</p>
        {sheet.schedule.length === 0 ? (
          <p className="text-sm text-muted-foreground">No schedule yet.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {sheet.schedule.map((e, i) => {
              const config = SCHEDULE_ACTIVITY_CONFIG[e.activity_type];
              const showDay = multiDay && (i === 0 || dayOf(sheet.schedule[i - 1].start_time) !== dayOf(e.start_time));
              return (
                <div key={e.id}>
                  {showDay && <p className="text-[10px] font-semibold text-muted-foreground pt-2">{dayOf(e.start_time)}</p>}
                  <div className="py-2 flex items-center gap-3">
                    <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">{formatTimeDisplay(e.start_time, tz)}</span>
                    <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded', config?.color || 'bg-gray-100 text-gray-700')}>
                      {e.label || config?.label || e.activity_type}
                    </span>
                    {e.act_name && <span className="text-xs text-muted-foreground truncate">{e.act_name}</span>}
                    {e.end_time && <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">to {formatTimeDisplay(e.end_time, tz)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VenueSection({ sheet }: { sheet: DayOfShowSheet }) {
  const venue = sheet.venue;
  if (!venue) return null;
  const directions = mapsHref(venue);
  const call = telHref(venue.phone_number);
  return (
    <Card style={{ gap: 0 }}>
      <CardContent className="p-3">
        <p className={SECTION_TITLE}><MapPin className="w-3.5 h-3.5" />Venue</p>
        <p className="text-sm font-semibold">{venue.name}</p>
        <div className="text-sm text-muted-foreground select-text">
          {addressLines(venue).map((line) => <div key={line}>{line}</div>)}
        </div>
        {venue.phone_number && <p className="text-sm select-text mt-1 tabular-nums">{venue.phone_number}</p>}
        <div className="flex gap-2 mt-2">
          {directions && (
            <a className={ACTION} href={directions} target="_blank" rel="noopener noreferrer">
              <Navigation className="w-4 h-4" />Directions
            </a>
          )}
          {call && (
            <a className={ACTION} href={call} aria-label={`Call ${venue.name}`}>
              <Phone className="w-4 h-4" />Call
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PeopleSection({ title, people }: { title: string; people: DayOfShowPerson[] }) {
  if (people.length === 0) return null;
  return (
    <Card style={{ gap: 0 }}>
      <CardContent className="p-3">
        <p className={SECTION_TITLE}><Users className="w-3.5 h-3.5" />{title}</p>
        <div className="divide-y divide-border/50">
          {people.map((p) => <PersonRow key={p.key} person={p} />)}
        </div>
      </CardContent>
    </Card>
  );
}

function PersonRow({ person }: { person: DayOfShowPerson }) {
  const call = telHref(person.phone);
  const text = smsHref(person.phone);
  const detail = [person.title, person.org_name && `${person.org_name}${person.org_role ? ` (${person.org_role})` : ''}`]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="py-2">
      <p className="text-sm font-medium">{person.name}</p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      {person.phone && <p className="text-sm select-text tabular-nums mt-0.5">{person.phone}</p>}
      {person.email && <p className="text-xs select-text text-muted-foreground break-all">{person.email}</p>}
      {(call || person.email) && (
        <div className="flex gap-2 mt-1.5">
          {call && <a className={ACTION} href={call} aria-label={`Call ${person.name}`}><Phone className="w-4 h-4" />Call</a>}
          {text && <a className={ACTION} href={text} aria-label={`Text ${person.name}`}><MessageSquare className="w-4 h-4" />Text</a>}
          {person.email && (
            <a className={ACTION} href={`mailto:${person.email}`} aria-label={`Email ${person.name}`}><Mail className="w-4 h-4" />Email</a>
          )}
        </div>
      )}
    </div>
  );
}

function DocumentsSection({ sheet, isOffline }: { sheet: DayOfShowSheet; isOffline: boolean }) {
  const { saved, save } = useDayOfShowDocuments(sheet);
  const [viewing, setViewing] = React.useState<DayOfShowFile | null>(null);
  const documents = sheet.documents;
  if (documents.length === 0) return null;

  // Not saved: as AttachmentManager, open the tab inside the tap, then send it to the signed link.
  const openOnline = async (doc: DayOfShowDocument) => {
    const tab = window.open('about:blank', '_blank');
    try {
      const url = await getAttachmentUrl(doc.file_path);
      if (tab) {
        tab.opener = null;
        tab.location.replace(url);
      } else {
        window.location.assign(url);
      }
    } catch {
      tab?.close();
      toast.error('Failed to open document');
    }
  };

  // Saved: open the phone's copy in the app (works offline and in the installed app).
  const openSaved = async (doc: DayOfShowDocument) => {
    const file = await getSavedDocument(doc.id).catch(() => undefined);
    if (file) setViewing(file);
    else if (!isOffline) void openOnline(doc);
    else toast.error('Not saved on this phone');
  };

  const saveForOffline = async (doc: DayOfShowDocument) => {
    const result = await save.mutateAsync(doc).catch(() => ({ saved: false as const, reason: 'error' as const }));
    if (!result.saved) toast.error(SAVE_REFUSAL[result.reason]);
  };

  return (
    <Card style={{ gap: 0 }}>
      <CardContent className="p-3">
        <p className={SECTION_TITLE}><FileText className="w-3.5 h-3.5" />Documents</p>
        <div className="divide-y divide-border/50">
          {documents.map((doc) => {
            const copy = saved[doc.id];
            const saving = save.isPending && save.variables?.id === doc.id;
            return (
              <div key={doc.id} className="py-2">
                <button
                  type="button"
                  disabled={isOffline && !copy}
                  onClick={() => (copy ? openSaved(doc) : openOnline(doc))}
                  className="w-full text-left text-sm font-medium text-primary disabled:text-muted-foreground flex items-center gap-2"
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  <span className="truncate">{doc.file_name}</span>
                </button>
                {copy ? (
                  <p className="text-[10px] text-muted-foreground mt-0.5">Saved on this phone · {formatFileSize(copy.size)}</p>
                ) : isOffline ? (
                  <p className="text-[10px] text-muted-foreground mt-0.5">Not saved on this phone – connect to open</p>
                ) : (
                  <button
                    type="button"
                    className="text-[11px] text-primary font-medium mt-1 inline-flex items-center gap-1 disabled:opacity-60"
                    aria-label={`Save ${doc.file_name} for offline`}
                    disabled={saving}
                    onClick={() => saveForOffline(doc)}
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                    Save for offline
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
      {viewing && <DocumentViewer file={viewing} onClose={() => setViewing(null)} />}
    </Card>
  );
}

/** A saved document, full screen in the app: an image, a PDF, or (other types) Share to open it elsewhere. */
function DocumentViewer({ file, onClose }: { file: DayOfShowFile; onClose: () => void }) {
  const [url] = React.useState(() => URL.createObjectURL(file.blob));
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const shareable = React.useMemo(() => {
    if (typeof navigator === 'undefined' || !navigator.canShare || typeof File === 'undefined') return null;
    const f = new File([file.blob], file.file_name, { type: file.type });
    return navigator.canShare({ files: [f] }) ? f : null;
  }, [file]);
  const share = () => {
    if (shareable) void navigator.share({ files: [shareable], title: file.file_name }).catch(() => {});
  };

  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';
  return (
    <div role="dialog" aria-modal="true" aria-label={file.file_name} className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border" style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}>
        <span className="flex-1 min-w-0 truncate text-sm font-semibold">{file.file_name}</span>
        {shareable && (
          <Button variant="ghost" size="sm" onClick={share} className="h-9 gap-1"><Share2 className="w-4 h-4" />Share</Button>
        )}
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="h-9 w-9"><X className="w-5 h-5" /></Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {isImage ? (
          <img src={url} alt={file.file_name} className="w-full h-auto" />
        ) : isPdf ? (
          <iframe src={url} title={file.file_name} className="w-full h-full border-0" />
        ) : (
          <p className="p-6 text-sm text-muted-foreground text-center">
            This file can't be shown here.{shareable ? ' Use Share to open it in another app.' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
