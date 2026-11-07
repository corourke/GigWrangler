import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import type { Organization } from '../../../utils/supabase/types';
import ExternalLink from '../../ExternalLink';

interface OrganizationDetailsDialogProps {
  organization: Partial<Organization> | null;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** Read-only details of a participating organization (moved from GigDetailScreen, #12). */
export default function OrganizationDetailsDialog({ organization: org, onClose }: OrganizationDetailsDialogProps) {
  const address = org ? [org.address_line1, org.address_line2, org.city, org.state, org.postal_code].filter(Boolean).join(', ') : '';
  return (
    <Dialog open={org !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Organization Details</DialogTitle>
        </DialogHeader>
        {org && (
          <div className="space-y-3">
            <Field label="Name">{org.name}</Field>
            {org.roles && org.roles.length > 0 && (
              <Field label="Roles">
                <div className="flex flex-wrap gap-1 mt-1">
                  {org.roles.map((role) => <Badge key={role} variant="outline" className="text-[10px]">{role}</Badge>)}
                </div>
              </Field>
            )}
            {org.phone_number && <Field label="Phone">{org.phone_number}</Field>}
            {address && <Field label="Address">{address}</Field>}
            {org.url && (
              <Field label="Website">
                <ExternalLink url={org.url} />
              </Field>
            )}
            {org.description && <Field label="Description"><span className="whitespace-pre-wrap">{org.description}</span></Field>}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
