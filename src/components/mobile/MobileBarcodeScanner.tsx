import React, { useState, useCallback, useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, CheckCircle2, AlertCircle, Keyboard, Camera } from 'lucide-react';

interface MobileBarcodeScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
  isScanning: boolean;
  statusMessage?: string;
  error?: string | null;
}

const getCameraCapabilityState = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      available: false,
      message: 'Camera access is not available in this environment.',
    };
  }

  if (!window.isSecureContext) {
    return {
      available: false,
      message: 'Camera access requires HTTPS or localhost in Safari/PWA. Open the app from a secure origin or use manual entry.',
    };
  }

  const hasModernCameraApi = Boolean(navigator.mediaDevices?.getUserMedia);
  const hasLegacyCameraApi = typeof (navigator as any).webkitGetUserMedia === 'function';

  if (!hasModernCameraApi && !hasLegacyCameraApi) {
    return {
      available: false,
      message: 'Camera access is not available on this device/browser. You can still enter tag numbers manually.',
    };
  }

  return {
    available: true,
    message: null,
  };
};

const getCameraErrorMessage = (error: any) => {
  const errorName = String(error?.name || '').toLowerCase();

  if (errorName === 'notallowederror' || errorName === 'permissiondeniederror') {
    return 'Camera permission was denied. Enable camera access in Safari settings and reload.';
  }

  if (errorName === 'notreadableerror') {
    return 'Camera is in use by another app. Close other camera apps and try again.';
  }

  if (errorName === 'notfounderror' || errorName === 'overconstrainederror') {
    return 'No rear camera was found. Switch to manual entry or try a different device.';
  }

  if (errorName === 'securityerror') {
    return 'Camera access requires HTTPS or localhost in Safari/PWA. Open the app from a secure origin or use manual entry.';
  }

  return 'Unable to start camera scanning on this device. You can still enter tag numbers manually.';
};

let sharedAudioCtx: AudioContext | null = null;

const getAudioContext = () => {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return sharedAudioCtx;
};

const warmUpAudio = () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
  }
};

const playScanBeep = () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1200, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.15);
  } catch {
  }
};

export const MobileBarcodeScanner: React.FC<MobileBarcodeScannerProps> = ({
  onScan,
  onClose,
  isScanning,
  statusMessage,
  error
}) => {
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scanCooldown, setScanCooldown] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [BarcodeScanner, setBarcodeScanner] = useState<any>(null);
  const [stopStream, setStopStream] = useState(false);

  useEffect(() => {
    if (!isScanning) {
      setStopStream(false);
      return;
    }

    let cancelled = false;
    const capability = getCameraCapabilityState();

    warmUpAudio();
    setStopStream(false);
    setCameraAvailable(capability.available);
    setCameraErrorMessage(capability.message);
    setShowManualInput(!capability.available);
    setBarcodeScanner(null);

    if (!capability.available) {
      return;
    }

    const loadScanner = async () => {
      try {
        const mod = await import('react-qr-barcode-scanner');
        if (!cancelled) {
          setBarcodeScanner(() => mod.default);
        }
      } catch {
        if (!cancelled) {
          setCameraAvailable(false);
          setShowManualInput(true);
          setCameraErrorMessage('Unable to load the camera scanner. You can still enter tag numbers manually.');
        }
      }
    };

    loadScanner();

    return () => {
      cancelled = true;
    };
  }, [isScanning]);

  const handleScan = useCallback((err: any, result: any) => {
    if (!result || scanCooldown) {
      return;
    }

    const scannedText = result.getText();
    if (scannedText === lastScanned) return;

    setLastScanned(scannedText);
    setScanCooldown(true);
    onScan(scannedText);

    playScanBeep();

    setTimeout(() => setScanCooldown(false), 2000);
    setTimeout(() => setLastScanned(null), 5000);
  }, [lastScanned, onScan, scanCooldown]);

  const handleManualSubmit = () => {
    const tag = manualEntry.trim();
    if (!tag) return;
    onScan(tag);
    setLastScanned(tag);
    setManualEntry('');
  };

  const closeScanner = () => {
    setStopStream(true);
    window.setTimeout(() => onClose(), 0);
  };

  const handleClose = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    closeScanner();
  };

  if (!isScanning) return null;

  // The overlay is its own modal Radix Dialog layer, not a bare portal (#256). Desktop
  // "Track a gig" shows Inventory Mode inside a modal Radix Dialog, whose focus trap and
  // `pointer-events: none` on <body> would swallow a plain portal to <body>: the tag field
  // couldn't be focused or typed in, and Submit couldn't be clicked. As a nested Radix layer
  // the scanner pauses the outer dialog's focus trap and takes pointer events itself; on a
  // phone (no dialog around it) it behaves as before. Escape closes the scanner only.
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) closeScanner(); }}>
    <DialogPrimitive.Portal>
    <DialogPrimitive.Content
      aria-describedby={undefined}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#000000',
        outline: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px',
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          backgroundColor: 'rgba(0,0,0,0.8)',
          color: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <DialogPrimitive.Title asChild>
            <span style={{ fontWeight: 600, fontSize: '16px', color: '#ffffff' }}>Scanner</span>
          </DialogPrimitive.Title>
          {statusMessage && <span style={{ fontSize: '12px', color: '#a1a1aa' }}>{statusMessage}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              backgroundColor: showManualInput ? 'rgba(2,132,199,0.6)' : 'rgba(255,255,255,0.2)',
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={() => setShowManualInput(!showManualInput)}
          >
            {showManualInput
              ? <Camera style={{ width: 20, height: 20, color: '#ffffff' }} />
              : <Keyboard style={{ width: 20, height: 20, color: '#ffffff' }} />}
          </button>
          <button aria-label="Close scanner"
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.2)',
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={handleClose}
          >
            <X style={{ width: 24, height: 24, color: '#ffffff' }} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {showManualInput ? (
          <div style={{ padding: 24, width: '100%', maxWidth: 400 }}>
            <p style={{ color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
              {cameraErrorMessage || 'Enter a tag number manually'}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={manualEntry}
                onChange={(e) => setManualEntry(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                placeholder="Tag number..."
                // eslint-disable-next-line jsx-a11y/no-autofocus -- manual entry opens to type a tag, as before
                autoFocus
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  fontSize: 16,
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.3)',
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  color: '#ffffff',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleManualSubmit}
                style={{
                  padding: '12px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                Submit
              </button>
            </div>
          </div>
        ) : cameraAvailable && BarcodeScanner ? (
          <>
            <BarcodeScanner
              facingMode="environment"
              onError={(scannerError: any) => {
                setCameraAvailable(false);
                setShowManualInput(true);
                setCameraErrorMessage(getCameraErrorMessage(scannerError));
              }}
              onUpdate={handleScan}
              stopStream={stopStream}
              width="100%"
              height="100%"
              style={{ objectFit: 'cover' }}
            />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ width: 256, height: 256, border: '2px solid rgba(255,255,255,0.4)', borderRadius: 8 }} />
            </div>
          </>
        ) : (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <p style={{ color: '#a1a1aa', fontSize: 14 }}>
              {cameraAvailable === null ? 'Checking camera access...' : 'Starting camera scanner...'}
            </p>
          </div>
        )}
      </div>

      <div
        style={{
          padding: '16px 24px',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
          backgroundColor: 'rgba(0,0,0,0.8)',
          color: '#ffffff',
        }}
      >
        {error ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, backgroundColor: 'rgba(127,29,29,0.4)', border: '1px solid rgba(239,68,68,0.5)', borderRadius: 8 }}>
            <AlertCircle style={{ width: 20, height: 20, flexShrink: 0, color: '#f87171' }} />
            <div style={{ fontSize: 14 }}>
              <p style={{ fontWeight: 700, color: '#fca5a5' }}>Scan Error</p>
              <p style={{ color: '#fecaca' }}>{error}</p>
            </div>
          </div>
        ) : lastScanned ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, backgroundColor: 'rgba(6,78,59,0.4)', border: '1px solid rgba(16,185,129,0.5)', borderRadius: 8 }}>
            <CheckCircle2 style={{ width: 20, height: 20, flexShrink: 0, color: '#34d399' }} />
            <div style={{ fontSize: 14 }}>
              <p style={{ fontWeight: 700, color: '#6ee7b7' }}>Scanned: {lastScanned}</p>
              <p style={{ fontSize: 12, color: 'rgba(167,243,208,0.7)', fontStyle: 'italic' }}>Matching tag...</p>
            </div>
          </div>
        ) : (
          <p style={{ textAlign: 'center', color: '#a1a1aa', fontSize: 14 }}>
            {showManualInput ? 'Type a tag number and tap Submit' : 'Point camera at a barcode or QR code'}
          </p>
        )}
      </div>
    </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
