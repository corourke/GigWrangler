/** The mobile lock's server calls (A14): the enrolled-device check and passkey unlock. */
import { getSupabase } from '../base/dataAccess';

/** Whether the signed-in user has any device enrolled for biometric unlock. An error counts as none. */
export async function hasEnrolledDevice(): Promise<boolean> {
  const { data, error } = await getSupabase().from('user_devices').select('id').limit(1);
  return !error && (data?.length ?? 0) > 0;
}

/** Step 1 of unlocking: the WebAuthn authentication options for this email. */
export async function getUnlockOptions(email: string) {
  const { data: options, error } = await getSupabase().functions.invoke('server/webauthn/authenticate/options', {
    method: 'POST',
    body: { email },
  });
  if (error) throw error;
  if (options.error) throw new Error(options.error);
  return options;
}

/** Step 3: the server checks the browser's passkey response. */
export async function verifyUnlock(authenticationResponse: unknown, email: string) {
  const { data, error } = await getSupabase().functions.invoke('server/webauthn/authenticate/verify', {
    method: 'POST',
    body: { authenticationResponse, email },
  });
  if (error) throw error;
  if (data.error) throw new Error(data.error);
  return data;
}
