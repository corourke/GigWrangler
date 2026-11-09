import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';

import { connectGoogleCalendar } from '../services/googleCalendar.service';

interface CalendarAuthCallbackProps {
  userId: string;
  onAuthComplete: () => void;
  onBack: () => void;
}

export default function CalendarAuthCallback({
  userId,
  onAuthComplete,
  onBack,
}: CalendarAuthCallbackProps) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handleAuthCallback();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the code in the URL is exchanged once, on mount
  }, []);

  const handleAuthCallback = async () => {
    try {
      // Get authorization code from URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const error = urlParams.get('error');

      if (error) {
        throw new Error(`Authorization failed: ${error}`);
      }

      if (!code) {
        throw new Error('No authorization code received');
      }

      // The server exchanges the code and keeps the connection. A new connection has no
      // calendar chosen yet; the person chooses one, and turns sync on, in settings.
      await connectGoogleCalendar(code);

      setStatus('success');

      // Clean up URL
      window.history.replaceState({}, document.title, '/');

      toast.success('Google Calendar connected successfully!');

      // Persist settings route so it survives org re-selection after page reload
      localStorage.setItem('currentRoute', 'settings');

      setTimeout(() => {
        onAuthComplete();
      }, 10000);

    } catch (err) {
      console.error('Auth callback error:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Authentication failed');
      toast.error('Failed to connect Google Calendar');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            {status === 'loading' && <Loader2 className="h-5 w-5 animate-spin" />}
            {status === 'success' && <CheckCircle className="h-5 w-5 text-green-600" />}
            {status === 'error' && <AlertCircle className="h-5 w-5 text-red-600" />}
            Google Calendar Setup
          </CardTitle>
          <CardDescription>
            {status === 'loading' && 'Completing authentication...'}
            {status === 'success' && 'Successfully connected to Google Calendar!'}
            {status === 'error' && 'Authentication failed'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {status === 'loading' && (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}

          {status === 'success' && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                Your Google Calendar has been connected. You'll be redirected to select
                which calendar to sync with and configure your settings.
              </AlertDescription>
            </Alert>
          )}

          {status === 'error' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error || 'An error occurred during authentication. Please try again.'}
              </AlertDescription>
            </Alert>
          )}

          {(status === 'success' || status === 'error') && (
            <Button onClick={onBack} className="w-full">
              Continue to Settings
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}