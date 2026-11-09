/** Devices enrolled for biometric unlock (A10): the signed-in user's own rows (RLS). */
import { getSupabase } from '../base/dataAccess';

export interface EnrolledDevice {
  id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string;
}

export async function listMyDevices(): Promise<EnrolledDevice[]> {
  const { data, error } = await getSupabase()
    .from('user_devices')
    .select('id, device_name, created_at, last_used_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as EnrolledDevice[];
}

export async function removeMyDevice(id: string): Promise<void> {
  const { error } = await getSupabase().from('user_devices').delete().eq('id', id);
  if (error) throw error;
}

/** Step 1 of enrolling this device: the WebAuthn registration options from the server. */
export async function getDeviceRegistrationOptions() {
  const { data: options, error } = await getSupabase().functions.invoke('server/webauthn/register/options', {
    method: 'POST',
  });
  if (error) throw error;
  if (options.error) throw new Error(options.error);
  return options;
}

/** Step 3: the server checks the browser's registration response and saves the device. */
export async function verifyDeviceRegistration(registrationResponse: unknown, deviceName: string) {
  const { data, error } = await getSupabase().functions.invoke('server/webauthn/register/verify', {
    method: 'POST',
    body: { registrationResponse, deviceName },
  });
  if (error) throw error;
  if (data.error) throw new Error(data.error);
  return data;
}
