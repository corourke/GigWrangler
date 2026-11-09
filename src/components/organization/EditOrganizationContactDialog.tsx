import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { useOrganizationContactMutations, type OrganizationContact } from './useOrganizationContacts';

interface EditOrganizationContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  contact: OrganizationContact | null;
}

export default function EditOrganizationContactDialog({
  open,
  onOpenChange,
  orgId,
  contact,
}: EditOrganizationContactDialogProps) {
  const { updateContact, setPrimary, unsetPrimary } = useOrganizationContactMutations(orgId);
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', title: '' });
  const [isPrimary, setIsPrimary] = useState(false);

  useEffect(() => {
    if (!contact) return;
    setForm({
      firstName: contact.user.first_name,
      lastName: contact.user.last_name,
      phone: contact.user.phone || '',
      title: contact.contact_title || '',
    });
    setIsPrimary(contact.is_primary_contact);
  }, [contact]);

  const isSaving = updateContact.isPending || setPrimary.isPending || unsetPrimary.isPending;

  const handleSave = async () => {
    if (!contact) return;
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('First and last name are required');
      return;
    }
    try {
      await updateContact.mutateAsync({
        memberId: contact.id,
        updates: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          title: form.title.trim(),
        },
      });
      if (isPrimary !== contact.is_primary_contact) {
        if (isPrimary) {
          await setPrimary.mutateAsync(contact.id);
        } else {
          await unsetPrimary.mutateAsync(contact.id);
        }
      }
      onOpenChange(false);
      toast.success('Contact updated');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update contact');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Contact</DialogTitle>
          <DialogDescription>
            {contact ? `Update ${contact.user.email}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit_contact_first_name">First Name *</Label>
              <Input
                id="edit_contact_first_name"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_contact_last_name">Last Name *</Label>
              <Input
                id="edit_contact_last_name"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit_contact_phone">Phone</Label>
              <Input
                id="edit_contact_phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_contact_title">Title</Label>
              <Input
                id="edit_contact_title"
                placeholder="Venue Manager"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                disabled={isSaving}
              />
            </div>
          </div>

          <label htmlFor="org-contact-primary" className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              id="org-contact-primary"
              checked={isPrimary}
              onCheckedChange={(checked) => setIsPrimary(checked === true)}
              disabled={isSaving}
            />
            Primary contact
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-sky-500 hover:bg-sky-600 text-white"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
