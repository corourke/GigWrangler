import { lazy, Suspense, useState } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '../../ui/button';
import { useAuth } from '../../../contexts/AuthContext';
import { canManage } from '../../../utils/permissions';

// The sheet (and its image code) loads only when someone opens it.
const ReceiptCaptureSheet = lazy(() => import('./ReceiptCaptureSheet'));

interface CaptureReceiptButtonProps {
  /** On a gig's page: the receipt is queued as a cost of this gig. */
  gigId?: string;
  gigTitle?: string;
}

/**
 * Mobile receipt capture (11-10): a camera button that opens the capture sheet.
 * Admins and Managers only, as for the scan queue and the scan itself.
 */
export default function CaptureReceiptButton({ gigId, gigTitle }: CaptureReceiptButtonProps) {
  const { selectedOrganization, user, userRole } = useAuth();
  const [open, setOpen] = useState(false);
  if (!canManage(userRole) || !selectedOrganization?.id || !user?.id) return null;

  return (
    <>
      <Button
        aria-label={gigId ? 'Capture receipt for this gig' : 'Capture receipt'}
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={() => setOpen(true)}
      >
        <Camera className="w-5 h-5" />
      </Button>
      {open && (
        <Suspense fallback={null}>
          <ReceiptCaptureSheet
            open={open}
            onOpenChange={setOpen}
            organizationId={selectedOrganization.id}
            userId={user.id}
            gigId={gigId}
            gigTitle={gigTitle}
          />
        </Suspense>
      )}
    </>
  );
}
