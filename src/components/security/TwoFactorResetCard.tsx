import { useState } from 'react';
import { KeyRound, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';
import { resetTwoFactorForAccount } from '../../services/twoFactor.service';

/**
 * A lost device (#361): a platform moderator, once they have confirmed who is asking, removes the
 * account's authenticators. The person sets one up again at their next sign-in. The server logs it.
 */
export default function TwoFactorResetCard() {
  const [email, setEmail] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await resetTwoFactorForAccount(email);
      toast.success(`Two-factor sign-in reset for ${email.trim()}`);
      setEmail('');
      setConfirming(false);
    } catch (err: any) {
      setError(err?.message || 'Could not reset two-factor sign-in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6 space-y-3">
      <h2 className="text-gray-900 flex items-center gap-2"><KeyRound className="h-5 w-5" /> Lost authenticator</h2>
      <p className="text-sm text-gray-600">
        Confirm who is asking first. This removes the account's two-factor sign-in; they set it up again when they next sign in.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="space-y-1 flex-1">
          <Label htmlFor="two-factor-reset-email">Account email</Label>
          <Input id="two-factor-reset-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setConfirming(false); }} disabled={busy} />
        </div>
        {!confirming ? (
          <Button variant="outline" onClick={() => setConfirming(true)} disabled={busy || !email.trim()}>
            Reset two-factor sign-in
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="destructive" onClick={reset} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Yes, reset
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
          </div>
        )}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </Card>
  );
}
