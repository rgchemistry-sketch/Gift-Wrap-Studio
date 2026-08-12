import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);
const USER_KEY = 'gnw-user';

function readCachedUser() {
  try {
    return JSON.parse(window.localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [cachedUser] = useState(readCachedUser);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authIntent, setAuthIntent] = useState('login');
  const [authenticating, setAuthenticating] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [phoneAuthStatus, setPhoneAuthStatus] = useState({ loading: true, enabled: false, error: false });
  const [phoneChallenge, setPhoneChallenge] = useState(null);

  const cacheUser = useCallback((nextUser) => {
    setUser(nextUser);
    if (nextUser) window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    else window.localStorage.removeItem(USER_KEY);
  }, []);

  useEffect(() => {
    let active = true;
    api
      .getCurrentUser()
      .then((result) => {
        if (!active) return;
        const nextUser = result.user || result.data?.user || null;
        cacheUser(nextUser);
      })
      .catch((error) => {
        if (!active) return;
        cacheUser(null);
        if (cachedUser && error.status !== 401 && error.status !== 403) {
          setAuthMessage('We could not verify your saved session. Please sign in again.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cacheUser, cachedUser]);

  const refreshPhoneAuthStatus = useCallback(async () => {
    setPhoneAuthStatus((current) => ({ ...current, loading: true, error: false }));
    try {
      const result = await api.getPhoneAuthStatus();
      const status = result.data || result;
      setPhoneAuthStatus({ loading: false, enabled: Boolean(status.enabled), error: false, ...status });
      return status;
    } catch (error) {
      setPhoneAuthStatus({ loading: false, enabled: false, error: true });
      throw error;
    }
  }, []);

  useEffect(() => {
    refreshPhoneAuthStatus().catch(() => {});
  }, [refreshPhoneAuthStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authState = params.get('auth');
    if (authState === 'error') {
      setAuthMessage('Google sign-in could not be completed. Please try again.');
      setAuthModalOpen(true);
    }
  }, []);

  const openAuth = useCallback((message = '', intent = 'login') => {
    setAuthMessage(message);
    setAuthIntent(intent === 'signup' ? 'signup' : 'login');
    setPhoneChallenge(null);
    setAuthModalOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    setAuthModalOpen(false);
    setAuthMessage('');
    setPhoneChallenge(null);
  }, []);

  const authenticateGoogle = useCallback(async (credential) => {
    setAuthMessage('');
    setAuthenticating(true);
    try {
      const result = await api.authenticateGoogle(credential);
      const nextUser = result.user || result.data?.user || null;
      if (!nextUser) throw new Error('No user was returned');
      cacheUser(nextUser);
      setAuthModalOpen(false);
      return nextUser;
    } catch (error) {
      setAuthMessage(error.message || 'Google sign-in could not be completed. Please try again.');
      throw error;
    } finally {
      setAuthenticating(false);
    }
  }, [cacheUser]);

  const startPhoneAuthentication = useCallback(async ({ credential, email, phone, intent }) => {
    setAuthMessage('');
    setAuthenticating(true);
    try {
      const result = await api.startPhoneAuthentication({ credential, email, phone, intent });
      const challenge = result.data || result;
      if (!challenge?.challengeId) throw new Error('The verification challenge could not be started.');
      setPhoneChallenge(challenge);
      return challenge;
    } catch (error) {
      setAuthMessage(error.message || 'The verification code could not be sent. Please try again.');
      throw error;
    } finally {
      setAuthenticating(false);
    }
  }, []);

  const verifyPhoneAuthentication = useCallback(async (code) => {
    if (!phoneChallenge?.challengeId) throw new Error('Request a new verification code first.');
    setAuthMessage('');
    setAuthenticating(true);
    try {
      const result = await api.verifyPhoneAuthentication({
        challengeId: phoneChallenge.challengeId,
        code,
      });
      const nextUser = result.user || result.data?.user || null;
      if (!nextUser) throw new Error('No user was returned');
      cacheUser(nextUser);
      setPhoneChallenge(null);
      setAuthModalOpen(false);
      return nextUser;
    } catch (error) {
      setAuthMessage(error.message || 'That verification code could not be confirmed.');
      throw error;
    } finally {
      setAuthenticating(false);
    }
  }, [cacheUser, phoneChallenge]);

  const resetPhoneChallenge = useCallback(() => {
    setPhoneChallenge(null);
    setAuthMessage('');
  }, []);

  const authenticateDemo = useCallback(async (role = 'buyer') => {
    setAuthMessage('');
    try {
      const result = await api.authenticateDemo(role);
      const nextUser = result.user || result.data?.user || null;
      if (!nextUser) throw new Error('No preview user was returned');
      cacheUser(nextUser);
      setAuthModalOpen(false);
      return nextUser;
    } catch (error) {
      setAuthMessage(error.message || 'Preview sign-in could not be completed.');
      throw error;
    }
  }, [cacheUser]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await api.signOut();
      cacheUser(null);
      return true;
    } catch (error) {
      setAuthMessage('Sign-out could not be confirmed, so your session remains active. Please try again.');
      throw error;
    } finally {
      setSigningOut(false);
    }
  }, [cacheUser]);

  const value = useMemo(
    () => ({
      user,
      loading,
      authModalOpen,
      authMessage,
      authIntent,
      authenticating,
      signingOut,
      phoneAuthStatus,
      phoneChallenge,
      refreshPhoneAuthStatus,
      openAuth,
      closeAuth,
      authenticateGoogle,
      startPhoneAuthentication,
      verifyPhoneAuthentication,
      resetPhoneChallenge,
      authenticateDemo,
      signOut,
      setUser: cacheUser,
    }),
    [user, loading, authModalOpen, authMessage, authIntent, authenticating, signingOut, phoneAuthStatus, phoneChallenge, refreshPhoneAuthStatus, openAuth, closeAuth, authenticateGoogle, startPhoneAuthentication, verifyPhoneAuthentication, resetPhoneChallenge, authenticateDemo, signOut, cacheUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
