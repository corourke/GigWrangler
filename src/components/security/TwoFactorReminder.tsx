import { Link } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { daysLeft } from './daysLeft';

/** For an Admin in the grace period without an authenticator: how long they have (#361). */
export default function TwoFactorReminder({ requiredAfter }: { requiredAfter: string }) {
  const days = daysLeft(requiredAfter);
  return (
    <div role="status" className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm px-4 py-2 flex items-center justify-center gap-2">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>
        Two-factor sign-in will be required for Admins in {days} {days === 1 ? 'day' : 'days'}.{' '}
        <Link to="/settings/security" className="underline font-medium">Set it up</Link>
      </span>
    </div>
  );
}
