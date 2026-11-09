import { useEffect, useState } from 'react';

/** Whether the device is offline (navigator.onLine), kept current by the online and offline events. */
export function useIsOffline(): boolean {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return isOffline;
}
