import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);
const LEGACY_USER_KEY = 'gnw-user';

const userFrom = (result) => result?.user || result?.data?.user || null;
const dataFrom = (result) => result?.data || result;
const providerEnabled = (provider) => Boolean(
  typeof provider === 'object' && provider !== null ? provider.enabled : provider,
);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authIntent, setAuthIntent] = useState('login');
  const [authenticating, setAuthenticating] = useState(false);
  const [authMethod, setAuthMethod] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [authStatus, setAuthStatus] = useState({
    loading: true,
    error: false,
    providers: { google: false, email: false },
  });
  const [emailChallenge, setEmailChallenge] = useState(null);
  const authGenerationRef = useRef(0);
  const authInFlightRef = useRef(0);
  const authStatusRequestedRef = useRef(false);

  const updateUser = useCallback((nextUser) => {
    setUser(nextUser || null);
    // Older builds cached account PII in localStorage. Sessions now live only in
    // the secure HttpOnly cookie, so remove that legacy copy whenever auth runs.
    window.localStorage.removeItem(LEGACY_USER_KEY);
  }, []);

  useEffect(() => {
    let active = true;
    const generation = authGenerationRef.current;
    window.localStorage.removeItem(LEGACY_USER_KEY);
    api
      .getCurrentUser()
      .then((result) => {
        if (active && generation === authGenerationRef.current) updateUser(userFrom(result));
      })
      .catch((error) => {
        if (!active || generation !== authGenerationRef.current) return;
        updateUser(null);
        if (error.status !== 401 && error.status !== 403) {
          setAuthMessage('We could not verify your saved session. Please sign in again.');
        }
      })
      .finally(() => {
        if (active && generation === authGenerationRef.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [updateUser]);

  const refreshAuthStatus = useCallback(async () => {
    authStatusRequestedRef.current = true;
    setAuthStatus((current) => ({ ...current, loading: true, error: false }));
    try {
      const status = dataFrom(await api.getAuthStatus()) || {};
      setAuthStatus({
        ...status,
        loading: false,
        error: false,
        providers: {
          google: providerEnabled(status.providers?.google),
          email: providerEnabled(status.providers?.email),
        },
      });
      return status;
    } catch (error) {
      setAuthStatus((current) => ({ ...current, loading: false, error: true }));
      throw error;
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authState = params.get('auth');
    if (authState === 'error') {
      setAuthMessage('Sign-in could not be completed. Please try again.');
      setAuthModalOpen(true);
      refreshAuthStatus().catch(() => {});
    }
  }, [refreshAuthStatus]);

  const openAuth = useCallback((message = '', intent = 'login') => {
    setAuthMessage(message);
    setAuthIntent(intent === 'signup' ? 'signup' : 'login');
    setEmailChallenge(null);
    setAuthModalOpen(true);
    if (!authStatusRequestedRef.current || authStatus.error) {
      refreshAuthStatus().catch(() => {});
    }
  }, [authStatus.error, refreshAuthStatus]);

  const closeAuth = useCallback(() => {
    if (authenticating) return;
    setAuthModalOpen(false);
    setAuthMessage('');
    setEmailChallenge(null);
    setAuthMethod('');
  }, [authenticating]);

  const runAuthentication = useCallback(async (method, operation, fallbackMessage) => {
    if (authInFlightRef.current) {
      const busyError = new Error('Another sign-in is already in progress. Please wait a moment.');
      setAuthMessage(busyError.message);
      throw busyError;
    }
    const generation = ++authGenerationRef.current;
    authInFlightRef.current = generation;
    setAuthMessage('');
    setAuthenticating(true);
    setAuthMethod(method);
    try {
      const result = await operation();
      const nextUser = userFrom(result);
      if (!nextUser) throw new Error('No account was returned. Please try again.');
      if (generation === authGenerationRef.current) {
        updateUser(nextUser);
        setEmailChallenge(null);
        setAuthModalOpen(false);
      }
      return nextUser;
    } catch (error) {
      const message = error.code === 'ACCOUNT_LINK_REQUIRED'
        ? 'An account already uses that email. Use its existing sign-in method, or enter the email above for a secure login code.'
        : error.message || fallbackMessage;
      if (generation === authGenerationRef.current) {
        if (error.code === 'ACCOUNT_LINK_REQUIRED') setAuthIntent('login');
        setAuthMessage(message);
      }
      throw error;
    } finally {
      if (authInFlightRef.current === generation) authInFlightRef.current = 0;
      if (generation === authGenerationRef.current) {
        setAuthenticating(false);
        setAuthMethod('');
        setLoading(false);
      }
    }
  }, [updateUser]);

  const authenticateGoogle = useCallback(
    (credential) => runAuthentication(
      'google',
      () => api.authenticateGoogle(credential, authIntent),
      'Google sign-in could not be completed. Please try again.',
    ),
    [authIntent, runAuthentication],
  );

  const startEmailAuthentication = useCallback(async ({ email, name, intent }) => {
    if (authInFlightRef.current) {
      const busyError = new Error('Another sign-in is already in progress. Please wait a moment.');
      setAuthMessage(busyError.message);
      throw busyError;
    }
    const operationToken = Symbol('email-start');
    authInFlightRef.current = operationToken;
    setAuthMessage('');
    setAuthenticating(true);
    setAuthMethod('email');
    try {
      const rawChallenge = dataFrom(await api.startEmailAuthentication({ email, name, intent }));
      if (!rawChallenge?.challengeId) throw new Error('The email verification code could not be sent.');
      const challenge = {
        ...rawChallenge,
        email,
        retryAfterSeconds: rawChallenge.retryAfterSeconds ?? rawChallenge.resendAfterSeconds ?? 60,
        expiresInMinutes: rawChallenge.expiresInMinutes
          ?? Math.max(1, Math.ceil(Number(rawChallenge.expiresInSeconds || 600) / 60)),
        previewCode: rawChallenge.previewCode ?? rawChallenge.demoCode,
      };
      if (authInFlightRef.current === operationToken) setEmailChallenge(challenge);
      return challenge;
    } catch (error) {
      if (authInFlightRef.current === operationToken) {
        setAuthMessage(error.message || 'The email verification code could not be sent. Please try again.');
      }
      throw error;
    } finally {
      if (authInFlightRef.current === operationToken) {
        authInFlightRef.current = 0;
        setAuthenticating(false);
        setAuthMethod('');
      }
    }
  }, []);

  const verifyEmailAuthentication = useCallback(async (code) => {
    if (!emailChallenge?.challengeId) throw new Error('Request a new verification code first.');
    return runAuthentication(
      'email',
      () => api.verifyEmailAuthentication({ challengeId: emailChallenge.challengeId, code }),
      'That verification code could not be confirmed.',
    );
  }, [emailChallenge, runAuthentication]);

  const resetEmailChallenge = useCallback(() => {
    setEmailChallenge(null);
    setAuthMessage('');
  }, []);

  const authenticateDemo = useCallback(
    (role = 'buyer') => runAuthentication(
      'demo',
      () => api.authenticateDemo(role),
      'Preview sign-in could not be completed.',
    ),
    [runAuthentication],
  );

  const signOut = useCallback(async () => {
    const generation = ++authGenerationRef.current;
    authInFlightRef.current = 0;
    setAuthenticating(false);
    setAuthMethod('');
    setSigningOut(true);
    try {
      await api.signOut();
      if (generation === authGenerationRef.current) updateUser(null);
      return true;
    } catch (error) {
      if (generation === authGenerationRef.current) {
        setAuthMessage('Sign-out could not be confirmed, so your session remains active. Please try again.');
      }
      throw error;
    } finally {
      if (generation === authGenerationRef.current) {
        setSigningOut(false);
        setLoading(false);
      }
    }
  }, [updateUser]);

  const value = useMemo(
    () => ({
      user,
      loading,
      authModalOpen,
      authMessage,
      authIntent,
      authenticating,
      authMethod,
      signingOut,
      authStatus,
      emailChallenge,
      refreshAuthStatus,
      openAuth,
      closeAuth,
      authenticateGoogle,
      startEmailAuthentication,
      verifyEmailAuthentication,
      resetEmailChallenge,
      authenticateDemo,
      signOut,
      setUser: updateUser,
    }),
    [user, loading, authModalOpen, authMessage, authIntent, authenticating, authMethod, signingOut, authStatus, emailChallenge, refreshAuthStatus, openAuth, closeAuth, authenticateGoogle, startEmailAuthentication, verifyEmailAuthentication, resetEmailChallenge, authenticateDemo, signOut, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
