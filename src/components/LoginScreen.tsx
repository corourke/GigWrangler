import { useState, useEffect } from 'react';
import { Building2, Mail, Lock, Loader2, AlertCircle } from 'lucide-react';
import { createClient } from '../utils/supabase/client';
import { convertPendingToActive } from '../services/organization.service';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Alert, AlertDescription } from './ui/alert';
import { Separator } from './ui/separator';
import { getPasswordStrength, passwordLengthError, MIN_PASSWORD_LENGTH, type PasswordStrength } from '../utils/passwordValidation';

const STRENGTH_LABEL: Record<PasswordStrength, { text: string; className: string }> = {
  weak: { text: 'Weak', className: 'text-destructive' },
  fair: { text: 'Fair', className: 'text-amber-600' },
  strong: { text: 'Strong', className: 'text-green-600' },
};

export default function LoginScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [signUpSubmitted, setSignUpSubmitted] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    // We rely on AuthContext to handle the initial session detection
    // through its onAuthStateChange listener. This prevents redundant
    // calls that could cause race conditions or deadlocks.
    if (import.meta.env.DEV) console.log('[TRACE] LoginScreen: Mounted, waiting for AuthContext to detect session');
  }, []);

  const handleAuthenticatedUser = async (accessToken: string, userId: string) => {
    try {
      if (import.meta.env.DEV) console.log('[TRACE] LoginScreen: handleAuthenticatedUser starting for', userId);
      setIsLoading(true);

      // Get user metadata from Supabase auth for conversion check
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const userEmail = authUser?.email || email;

      // Check if there's a pending user with this email and convert to active
      if (userEmail) {
        try {
          if (import.meta.env.DEV) console.log('[TRACE] LoginScreen: Checking for pending user conversion...');
          await convertPendingToActive(userEmail, userId);
        } catch (convertErr) {
          if (import.meta.env.DEV) console.warn('[TRACE] LoginScreen: Error converting pending user:', convertErr);
        }
      }

      if (import.meta.env.DEV) console.log('[TRACE] LoginScreen: Authentication handling complete. Relying on AuthContext for data fetching.');
      // Note: We don't call onLogin here because AuthContext's onAuthStateChange 
      // will detect the session and call refreshProfile automatically.
      
    } catch (err: any) {
      if (import.meta.env.DEV) console.error('[TRACE] LoginScreen: Error handling authenticated user:', err);
      setError(err?.message || 'Failed to handle authentication');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        console.error('Sign in error:', authError.message);
        // Provide more user-friendly error messages
        if (authError.message.includes('Invalid login credentials')) {
          setError('Invalid email or password. Please check your credentials and try again.');
        } else {
          setError(authError.message);
        }
        setIsLoading(false);
        return;
      }

      if (data.session) {
        await handleAuthenticatedUser(data.session.access_token, data.session.user.id);
      }
    } catch (err: any) {
      console.error('Error during email sign in:', err);
      setError(err.message || 'Sign in failed. Please try again.');
      setIsLoading(false);
    }
  };

  const passwordsMismatch = password !== confirmPassword;
  // Show the mismatch once the user has typed a confirmation or tried to submit
  const showMismatchError = passwordsMismatch && (confirmPassword.length > 0 || signUpSubmitted);
  const passwordStrength = getPasswordStrength(password);

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignUpSubmitted(true);
    if (passwordsMismatch) return;

    setIsLoading(true);
    setError(null);

    if (!firstName || !lastName) {
      setError('Please provide your first and last name');
      setIsLoading(false);
      return;
    }

    const lengthError = passwordLengthError(password);
    if (lengthError) {
      setError(lengthError);
      setIsLoading(false);
      return;
    }

    try {
      // Sign up the user
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
          },
        },
      });

      if (authError) {
        console.error('Sign up error:', authError);
        setError(authError.message);
        setIsLoading(false);
        return;
      }

      if (data.session) {
        // User is automatically signed in
        await handleAuthenticatedUser(data.session.access_token, data.session.user.id);
      } else if (data.user && !data.session) {
        // Email confirmation required
        setError('Please check your email to confirm your account before signing in.');
        setIsLoading(false);
        setIsSignUp(false);
      }
    } catch (err: any) {
      console.error('Error during email sign up:', err);
      setError(err.message || 'Sign up failed. Please try again.');
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) throw resetError;
      // Always show success (don't reveal whether the email exists).
      setResetSent(true);
    } catch (err: any) {
      console.error('Error sending reset email:', err);
      setError(err.message || 'Failed to send reset email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: _data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (authError) {
        console.error('OAuth error:', authError);
        setError('Google authentication failed. Please try again.');
        setIsLoading(false);
        return;
      }

      // The redirect will happen automatically
    } catch (err: any) {
      console.error('Error during Google login:', err);
      setError(err.message || 'Authentication failed. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 to-blue-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo and Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-sky-500 rounded-2xl mb-4">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-sky-900 mb-2">GigWrangler</h1>
          <p className="text-gray-600">Production and event management platform</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <Tabs value={isSignUp ? 'signup' : 'signin'} onValueChange={(v) => setIsSignUp(v === 'signup')} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            {/* Error Alert */}
            {error && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Sign In Tab */}
            <TabsContent value="signin">
              {forgotMode ? (
                resetSent ? (
                  <div className="space-y-4 text-center py-4">
                    <p className="text-gray-700">
                      If an account exists for <span className="font-medium">{email}</span>, a password reset link has been sent. Check your email.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-11"
                      onClick={() => { setForgotMode(false); setResetSent(false); setError(null); }}
                    >
                      Back to sign in
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    <p className="text-sm text-gray-600">Enter your email and we'll send you a link to reset your password.</p>
                    <div className="space-y-2">
                      <Label htmlFor="forgot-email">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                          id="forgot-email"
                          type="email"
                          placeholder="your.email@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-10"
                          required
                          disabled={isLoading}
                        />
                      </div>
                    </div>
                    <Button type="submit" className="w-full h-11 bg-sky-500 hover:bg-sky-600" disabled={isLoading}>
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        'Send reset link'
                      )}
                    </Button>
                    <button
                      type="button"
                      className="w-full text-sm text-sky-600 hover:text-sky-700"
                      onClick={() => { setForgotMode(false); setError(null); }}
                    >
                      Back to sign in
                    </button>
                  </form>
                )
              ) : (
                <form onSubmit={handleEmailSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="signin-email"
                        type="email"
                        placeholder="your.email@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        required
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="signin-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10"
                        required
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11 bg-sky-500 hover:bg-sky-600"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      'Sign in with Email'
                    )}
                  </Button>

                  <button
                    type="button"
                    className="w-full text-sm text-sky-600 hover:text-sky-700"
                    onClick={() => { setForgotMode(true); setError(null); }}
                  >
                    Forgot password?
                  </button>
                </form>
              )}
            </TabsContent>

            {/* Sign Up Tab */}
            <TabsContent value="signup">
              <form onSubmit={handleEmailSignUp} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-firstname">First Name</Label>
                    <Input
                      id="signup-firstname"
                      type="text"
                      placeholder="John"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-lastname">Last Name</Label>
                    <Input
                      id="signup-lastname"
                      type="text"
                      placeholder="Doe"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="your.email@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                      required
                      minLength={MIN_PASSWORD_LENGTH}
                      disabled={isLoading}
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Minimum {MIN_PASSWORD_LENGTH} characters
                    {passwordStrength && (
                      <>
                        {' · '}
                        <span className={`font-medium ${STRENGTH_LABEL[passwordStrength].className}`}>
                          Password strength: {STRENGTH_LABEL[passwordStrength].text}
                        </span>
                      </>
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-confirm-password">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      id="signup-confirm-password"
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={`pl-10 ${showMismatchError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      aria-invalid={showMismatchError || undefined}
                      aria-describedby={showMismatchError ? 'signup-confirm-password-error' : undefined}
                      required
                      disabled={isLoading}
                    />
                  </div>
                  {showMismatchError && (
                    <p id="signup-confirm-password-error" className="text-destructive text-[11px] font-medium mt-1">
                      Passwords do not match
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 bg-sky-500 hover:bg-sky-600"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    'Create Account'
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {/* Divider */}
          <div className="relative my-6">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-xs text-gray-500">
              OR
            </span>
          </div>

          {/* Google OAuth Button */}
          <Button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full h-11 bg-white hover:bg-gray-50 text-gray-900 border-2 border-gray-300 hover:border-gray-400"
            variant="outline"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <svg className="mr-3 h-5 w-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </>
            )}
          </Button>

          {/* Additional Info */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              Secure authentication powered by Supabase
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-sm text-gray-600">
          <p>© {new Date().getFullYear()} GigWrangler. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}