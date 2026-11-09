import { RefreshCw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../ui/alert-dialog';
import type { DbPurchase } from '../../../utils/supabase/types';
import { purchaseLineLedgerAmount } from '../../../services/purchase.service';

export type LedgerPrompt = { item: DbPurchase; gigId: string; gigTitle?: string };
export type ClearLedgerConfirm = { item: DbPurchase; financialIds: string[]; fromGigId: string; amount: number };
export type DeleteConfirm = { type: 'header' | 'item'; purchase: DbPurchase; childCount?: number; purchaseIds: string[] };

/** After a line is put on a gig: offer to record it in that gig's ledger. */
export function LedgerPromptDialog({ prompt, busy, onClose, onCreate }: {
  prompt: LedgerPrompt | null; busy: boolean; onClose: () => void; onCreate: () => void;
}) {
  return (
    <AlertDialog open={!!prompt} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Create gig expense record?</AlertDialogTitle>
          <AlertDialogDescription>
            This expense line is now linked to {prompt?.gigTitle ? `"${prompt.gigTitle}"` : 'a gig'}. Would you
            like to record it as a paid expense in that gig's financials
            {prompt && (
              <> for ${purchaseLineLedgerAmount(prompt.item).toFixed(2)}</>
            )}? You can skip this and the line will still be linked to the gig.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Skip</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); onCreate(); }} disabled={busy}>
            {busy && <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            Create record
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Clearing a line's gig would strand its ledger entry: confirm removing both. */
export function ClearLedgerDialog({ confirm, busy, onClose, onConfirm }: {
  confirm: ClearLedgerConfirm | null; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove gig association and its ledger entry?</AlertDialogTitle>
          <AlertDialogDescription>
            This line has a linked expense entry
            {confirm && <> for ${confirm.amount.toFixed(2)}</>} in the gig's
            financials. Unlinking the line will also delete that ledger entry so the gig's costs stay
            correct. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep linked</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); onConfirm(); }} disabled={busy}>
            {busy && <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            Unlink and delete entry
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Deleting a purchase or a line, saying which gig expenses go with it (B2). */
export function DeletePurchaseDialog({ confirm, linked, onClose, onConfirm }: {
  confirm: DeleteConfirm | null;
  linked: { entries: number; gigs: number; amount: number } | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirm?.type === 'header' ? 'Delete Purchase?' : 'Delete Line Item?'}
          </AlertDialogTitle>
          {/* A div, not the default <p>: it holds paragraphs. */}
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {confirm?.type === 'header' ? (
                <>
                  <p>This will delete the purchase header and all {confirm.childCount} line item(s).</p>
                </>
              ) : (
                <>
                  <p>This will permanently remove this line item.</p>
                  {confirm?.purchase.asset_id && (
                    <p className="text-amber-600">This item is linked to an asset. Deleting it will unlink the asset (the asset will not be deleted).</p>
                  )}
                </>
              )}
              {linked && linked.entries > 0 && (
                <p className="text-amber-600">
                  This also removes ${linked.amount.toFixed(2)} of expenses from {linked.gigs} {linked.gigs === 1 ? 'gig' : 'gigs'}.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-red-600 hover:bg-red-700">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
