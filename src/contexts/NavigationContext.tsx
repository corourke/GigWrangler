import { createContext, useContext } from 'react';

// The provider is in NavigationProvider.tsx, so a file that renders components exports only components.

export interface NavigationContextValue {
  onNavigateToDashboard: () => void;
  onNavigateToGigs: () => void;
  onNavigateToTeam: () => void;
  onNavigateToAssets: () => void;
  onNavigateToFinancials: () => void;
  onNavigateToPurchase?: (purchaseId: string, returnGigId?: string) => void;
  onNavigateToGigDetail?: (gigId: string) => void;
  onEditProfile?: () => void;
  onNavigateToSettings?: () => void;
}

export const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useNavigation() {
  const context = useContext(NavigationContext);
  // Return null if context is not available (for screens outside NavigationProvider)
  return context;
}
