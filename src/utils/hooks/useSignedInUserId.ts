import { useContext } from 'react';
import { AuthContext } from '../../contexts/AuthContext';

/**
 * The signed-in user's id, for query keys whose answer depends on who is signed in (A10). Unlike
 * useAuth it doesn't throw outside an AuthProvider: there it is '' (tests, standalone renders).
 */
export function useSignedInUserId(): string {
  return useContext(AuthContext)?.user?.id ?? '';
}
