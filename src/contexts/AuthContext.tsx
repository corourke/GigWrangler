import { createContext, useContext } from 'react';
import type { User, Organization, OrganizationMembership, UserRole } from '../utils/supabase/types';

// The provider is in AuthProvider.tsx; this file holds the context and its hook, so a file that
// renders components exports only components (react-refresh, A11).
export interface AuthContextType {
  user: User | null;
  organizations: OrganizationMembership[];
  selectedOrganization: Organization | null;
  isLoading: boolean;
  /** Set when the signed-in user's profile couldn't be loaded (#94); cleared by a successful refreshProfile. */
  profileLoadError: string | null;
  userRole: UserRole | undefined;
  login: (user: User, organizations: OrganizationMembership[]) => void;
  logout: () => Promise<void>;
  selectOrganization: (org: Organization | null) => void;
  refreshProfile: () => Promise<void>;
  setOrganizations: (organizations: OrganizationMembership[]) => void;
  setUser: (user: User | null) => void;
  /** An account an Admin created with a password: its owner must choose their own first. */
  mustChangePassword: boolean;
  /** Call once the temporary password has been replaced. */
  passwordChanged: () => void;
  /** Two-factor sign-in (#361): this session still needs the authenticator code. */
  twoFactorPending: boolean;
  /** An Admin past the grace period with no authenticator: they set one up first. */
  twoFactorSetupRequired: boolean;
  /** An Admin in the grace period without an authenticator: when it becomes required. */
  twoFactorReminderUntil: string | null;
  /** Call once the code has been verified (or the authenticator set up). */
  twoFactorVerified: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
