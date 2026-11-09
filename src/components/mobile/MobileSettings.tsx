import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Settings, LogOut, Smartphone, Trash2, Plus, Fingerprint, Loader2, Lock } from 'lucide-react';
import { Button } from '../ui/button';
import { createClient } from '../../utils/supabase/client';
import { startRegistration } from '@simplewebauthn/browser';
import { toast } from 'sonner';

interface Device {
  id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string;
}

interface MobileSettingsProps {
  onLogout: () => void;
  onLock: () => void;
}

export default function MobileSettings({ onLogout, onLock }: MobileSettingsProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    fetchDevices();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loads the device list once, on mount
  }, []);

  const fetchDevices = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('user_devices')
        .select('id, device_name, created_at, last_used_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDevices(data || []);
    } catch (error) {
      console.error('Error fetching devices:', error);
      toast.error('Failed to load enrolled devices');
    } finally {
      setLoading(false);
    }
  };

  const enrollDevice = async () => {
    try {
      setEnrolling(true);
      
      // 1. Get registration options
      const { data: options, error: optionsError } = await supabase.functions.invoke(
        'server/webauthn/register/options',
        { method: 'POST' }
      );

      if (optionsError) throw optionsError;
      if (options.error) throw new Error(options.error);

      // 2. Start WebAuthn registration
      const regResponse = await startRegistration({ optionsJSON: options });

      // 3. Verify registration
      const deviceName = `${navigator.platform} (${new Date().toLocaleDateString()})`;
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
        'server/webauthn/register/verify',
        {
          method: 'POST',
          body: {
            registrationResponse: regResponse,
            deviceName,
          },
        }
      );

      if (verifyError) throw verifyError;
      if (verifyData.error) throw new Error(verifyData.error);

      toast.success('Device enrolled successfully!');
      fetchDevices();
    } catch (error: any) {
      console.error('Enrollment error:', error);
      if (error.name === 'NotAllowedError') {
        toast.error('Registration cancelled or timed out');
      } else {
        toast.error(error.message || 'Failed to enroll device');
      }
    } finally {
      setEnrolling(false);
    }
  };

  const removeDevice = async (id: string) => {
    if (!confirm('Are you sure you want to remove this device? Biometric unlock will no longer work for it.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('user_devices')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      setDevices(prev => prev.filter(d => d.id !== id));
      toast.success('Device removed');
    } catch (error) {
      console.error('Error removing device:', error);
      toast.error('Failed to remove device');
    }
  };

  return (
    <div className="space-y-4 pb-20">
      {/* The mobile layout has its own header style; the web page frame (#39) is desktop only. */}
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-sky-600" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-600">Mobile preferences and biometric auth</p>
        </div>
      </div>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center">
            <Fingerprint className="w-4 h-4 mr-2" />
            Biometric Unlock
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Use FaceID or TouchID to quickly unlock the app without typing your password.
          </p>

          <div className="space-y-2">
            {loading ? (
              <div className="flex justify-center p-4">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : devices.length > 0 ? (
              devices.map(device => (
                <div key={device.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                  <div className="flex items-center min-w-0">
                    <Smartphone className="w-4 h-4 mr-3 flex-shrink-0 text-muted-foreground" />
                    <div className="truncate">
                      <p className="text-sm font-medium truncate">{device.device_name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Enrolled: {new Date(device.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                    onClick={() => removeDevice(device.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))
            ) : (
              <div className="text-center p-6 border border-dashed rounded-lg">
                <p className="text-xs text-muted-foreground">No devices enrolled</p>
              </div>
            )}
          </div>

          <Button 
            className="w-full h-11" 
            onClick={enrollDevice} 
            disabled={enrolling}
          >
            {enrolling ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enrolling...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Enroll Current Device
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Security & Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {devices.length > 0 && (
            <Button 
              variant="outline" 
              className="w-full justify-start h-11" 
              onClick={onLock}
            >
              <Lock className="w-4 h-4 mr-2" />
              Lock App Now
            </Button>
          )}

          <Button 
            variant="destructive" 
            className="w-full justify-start h-11" 
            onClick={onLogout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </CardContent>
      </Card>

      <p className="text-center text-[10px] text-muted-foreground pt-4">
        Build: {__BUILD_TIMESTAMP__}
      </p>
    </div>
  );
}
