import { useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';
import { verifyTwoFactorCode } from '../../services/twoFactor.service';

/** The second sign-in step for an account with two-factor sign-in: the code from the authenticator app. */
export default function TwoFactorChallengeScreen({ onVerified, onSignOut }: { onVerified: () => void; onSignOut: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerifying(true);
    try {
      await verifyTwoFactorCode(code);
      onVerified();
    } catch (err: any) {
      setError(err?.message || "That code didn't work.");
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-blue-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-sky-500 rounded-full mb-3">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-sky-900 mb-2">Two-factor sign-in</h1>
          <p className="text-gray-600">Enter the 6-digit code from your authenticator app.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="two-factor-code">6-digit code</Label>
            <Input id="two-factor-code" inputMode="numeric" autoComplete="one-time-code"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the sign-in step is this one field, as before
              autoFocus maxLength={7}
              value={code} onChange={(e) => setCode(e.target.value)} disabled={verifying} />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={verifying || code.replace(/\s/g, '').length < 6}>
            {verifying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Verify
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={onSignOut}>
            Sign out
          </Button>
          <p className="text-xs text-gray-500 text-center">
            Lost your phone? Ask a platform moderator to reset your two-factor sign-in.
          </p>
        </form>
      </Card>
    </div>
  );
}
