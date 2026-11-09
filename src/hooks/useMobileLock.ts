import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { hasEnrolledDevice as checkEnrolledDevice, getUnlockOptions, verifyUnlock } from '../services/mobile/mobileLock.service';
import { startAuthentication } from '@simplewebauthn/browser';
import { toast } from 'sonner';

const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour background inactivity
const SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour session expiry

export function useMobileLock(userEmail: string | undefined, isMobile: boolean, userId?: string) {
  const [isLocked, setIsLocked] = useState(false);
  const [lastActiveTime, setLastActiveTime] = useState(() => Date.now());
  // The lock can only be cleared by biometric unlock, which requires an enrolled
  // device. Arming the lock without one traps the user on a screen they can never
  // pass (authenticate/options 400s with "No registered devices found").
  // A10: whether the signed-in user has an enrolled device, keyed by the user (a device change
  // refreshes it through invalidateAfterDeviceChange). A failed check leaves the lock unarmed.
  const enrolled = useQuery({
    queryKey: queryKeys.enrolledDevice(userId ?? ''),
    queryFn: () => checkEnrolledDevice(),
    enabled: isMobile && !!userEmail && !!userId,
    staleTime: 0,
  });
  const hasEnrolledDevice = isMobile && !!userEmail && !!userId && enrolled.data === true;

  const lock = useCallback(() => {
    if (isMobile && hasEnrolledDevice) {
      setIsLocked(true);
      localStorage.setItem('mobile_locked', 'true');
    }
  }, [isMobile, hasEnrolledDevice]);

  const unlock = useCallback(async () => {
    if (!userEmail) return false;

    try {
      // 1. Get authentication options
      const options = await getUnlockOptions(userEmail);

      // 2. Start WebAuthn authentication
      const authResponse = await startAuthentication({ optionsJSON: options });

      // 3. Verify authentication
      const verifyData = await verifyUnlock(authResponse, userEmail);

      if (verifyData.success) {
        setIsLocked(false);
        localStorage.removeItem('mobile_locked');
        setLastActiveTime(Date.now());
        return true;
      }
      return false;
    } catch (error: any) {
      console.error('Unlock error:', error);
      if (error.name === 'NotAllowedError') {
        toast.error('Authentication cancelled');
      } else {
        toast.error(error.message || 'Failed to unlock');
      }
      return false;
    }
  }, [userEmail]);

  useEffect(() => {
    if (!isMobile) return;
    localStorage.removeItem('mobile_locked');
  }, [isMobile]);

  // Inactivity tracking
  useEffect(() => {
    if (!isMobile || isLocked || !userEmail || !hasEnrolledDevice) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        const timeSinceLastActive = now - lastActiveTime;
        
        if (timeSinceLastActive > INACTIVITY_TIMEOUT_MS) {
          lock();
        } else {
          setLastActiveTime(now);
        }
      } else {
        setLastActiveTime(Date.now());
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isMobile, isLocked, lastActiveTime, lock, userEmail, hasEnrolledDevice]);

  // Session expiry interval
  useEffect(() => {
    if (!isMobile || isLocked || !userEmail || !hasEnrolledDevice) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActive = now - lastActiveTime;
      if (timeSinceLastActive > SESSION_EXPIRY_MS) {
        lock();
      }
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [isMobile, isLocked, lastActiveTime, lock, userEmail, hasEnrolledDevice]);

  return { isLocked, lock, unlock };
}
