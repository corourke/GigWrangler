import { ShieldCheck } from 'lucide-react';
import { Button } from '../ui/button';
import TwoFactorSettings from './TwoFactorSettings';

/** An Admin past the grace period without an authenticator sets one up before anything else (#361). */
export default function TwoFactorSetupRequiredScreen({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-sky-500 rounded-full mb-3">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-sky-900 mb-2">Set up two-factor sign-in</h1>
          <p className="text-gray-600">
            Admins must use two-factor sign-in. Set up an authenticator app to continue.
          </p>
        </div>
        <TwoFactorSettings onEnabled={onDone} />
        <Button type="button" variant="ghost" className="w-full" onClick={onSignOut}>Sign out</Button>
      </div>
    </div>
  );
}
