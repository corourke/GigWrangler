import { useState } from 'react';
import { Lock, Loader2, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { replaceTemporaryPassword } from '../services/user.service';

/** The shortest password an account may have (Supabase Auth is set to the same). */
const MIN_LENGTH = 10;

/**
 * An account an Admin created with a password: its owner chooses their own before using the app.
 */
export default function TemporaryPasswordScreen({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_LENGTH) { setError(`Password must be at least ${MIN_LENGTH} characters`); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setError(null);
    setSaving(true);
    try {
      await replaceTemporaryPassword(password);
      onComplete();
    } catch (err: any) {
      setError(err?.message || 'Could not set the password');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-blue-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-sky-500 rounded-full mb-3">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-sky-900 mb-2">Choose your password</h1>
          <p className="text-gray-600">Choose your own password: the one you were given was only for your first sign-in.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="temporary-new-password">New password</Label>
            <Input id="temporary-new-password" type="password" autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} disabled={saving} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="temporary-confirm-password">Confirm new password</Label>
            <Input id="temporary-confirm-password" type="password" autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} disabled={saving} />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Set my password
          </Button>
        </form>
      </Card>
    </div>
  );
}
