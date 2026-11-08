import { useEffect, useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';
import {
  getTwoFactorStatus, startTwoFactorSetup, confirmTwoFactorSetup, removeTwoFactor, type TwoFactorStatus,
} from '../../services/twoFactor.service';

/** Settings → Security: set up or turn off two-factor sign-in with an authenticator app (#361). */
export default function TwoFactorSettings({ onEnabled }: { onEnabled?: () => void } = {}) {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [setup, setSetup] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setStatus(await getTwoFactorStatus());
    } catch (err) {
      console.error('Error loading two-factor status:', err);
      setError('Could not load your two-factor settings');
    }
  };

  useEffect(() => { load(); }, []);

  const begin = async () => {
    setError(null);
    setBusy(true);
    try {
      setSetup(await startTwoFactorSetup());
      setCode('');
    } catch (err: any) {
      setError(err?.message || 'Could not start two-factor setup');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setup) return;
    setError(null);
    setBusy(true);
    try {
      await confirmTwoFactorSetup(setup.factorId, code);
      setSetup(null);
      toast.success('Two-factor sign-in is on');
      await load();
      onEnabled?.();
    } catch (err: any) {
      setError(err?.message || "That code didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async (factorId: string) => {
    setError(null);
    setBusy(true);
    try {
      await removeTwoFactor(factorId);
      toast.success('Two-factor sign-in is off');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not turn off two-factor sign-in');
    } finally {
      setBusy(false);
    }
  };

  const factor = status?.factors[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Two-factor sign-in</CardTitle>
        <CardDescription>
          After your password, enter a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy and the like).
          Required for Admins.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status && !error && <Loader2 className="h-5 w-5 animate-spin" />}

        {status && factor && !setup && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm">Two-factor sign-in is on{factor.friendly_name ? ` (${factor.friendly_name})` : ''}.</p>
            <Button variant="outline" size="sm" onClick={() => turnOff(factor.id)} disabled={busy}>Turn off</Button>
          </div>
        )}

        {status && !factor && !setup && (
          <Button onClick={begin} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Set up two-factor sign-in
          </Button>
        )}

        {setup && (
          <form onSubmit={confirm} className="space-y-4">
            <p className="text-sm">1. Scan this QR code with your authenticator app.</p>
            <img src={setup.qrCode} alt="QR code for your authenticator app" className="h-44 w-44 border rounded" />
            <p className="text-sm">
              Or type this key: <code className="font-mono break-all">{setup.secret}</code>
            </p>
            <div className="space-y-1 max-w-xs">
              <Label htmlFor="two-factor-setup-code">2. Enter the 6-digit code it shows</Label>
              <Input id="two-factor-setup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7}
                value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}>Confirm</Button>
              <Button type="button" variant="ghost" onClick={() => setSetup(null)} disabled={busy}>Cancel</Button>
            </div>
          </form>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
