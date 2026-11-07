import { useState } from 'react';
import { Building2, Lock, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { createClient } from '../utils/supabase/client';
import { validatePassword, MIN_PASSWORD_LENGTH } from '../utils/passwordValidation';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';

interface ResetPasswordScreenProps {
  // Called after the password is updated (and the user signed out) so the app
  // can return to the login screen.
  onComplete: () => void;
}

export default function ResetPasswordScreen({ onComplete }: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validatePassword(password, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      // Sign out so the user re-authenticates with their new password.
      await supabase.auth.signOut();
      setDone(true);
    } catch (err: any) {
      console.error('Error resetting password:', err);
      setError(err?.message || 'Failed to reset password. The link may have expired — request a new one.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 to-blue-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-sky-500 rounded-2xl mb-4">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-sky-900 mb-2">Reset your password</h1>
          <p className="text-gray-600">Choose a new password for your account</p>
        </div>

        <Card className="p-8">
          {done ? (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-10 h-10 text-green-600" />
                </div>
              </div>
              <p className="text-gray-700">Your password has been updated. Please sign in with your new password.</p>
              <Button onClick={onComplete} className="w-full h-11 bg-sky-500 hover:bg-sky-600">
                Go to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="mb-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    disabled={isSubmitting}
                  />
                </div>
                <p className="text-xs text-gray-500">Minimum {MIN_PASSWORD_LENGTH} characters</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-new-password">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="confirm-new-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10"
                    required
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full h-11 bg-sky-500 hover:bg-sky-600" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update password'
                )}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
