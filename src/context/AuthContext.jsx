import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { removeScopedDraft } from '../utils/scoped-draft';

const AuthContext = createContext(null);
const LEGACY_USER_KEY = 'gnw-user';
const AUTH_SYNC_KEY = 'gnw-auth-sync';
const AUTH_SYNC_CHANNEL = 'gift-n-wrap-auth';
const CHECKOUT_DRAFT_KEY = 'gnw-checkout-draft';

const userFrom = (result) => result?.user || result?.data?.user || null;
const dataFrom = (result) => result?.data || result;
const providerEnabled = (provider) => Boolean(
  typeof provider === 'object' && provider !== null ? provider.enabled : provider,
);
const cancelledAuthentication = () => Object.assign(
  new Error('This sign-in attempt was closed.'),
  { code: 'AUTH_FLOW_CANCELLED' },
);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authMessageTone, setAuthMessageTone] = useState('');
  const [authIntent, setAuthIntent] = useState('login');
  const [authenticating, setAuthenticating] = useState(false);
  const [authMethod, setAuthMethod] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [authStatus, setAuthStatus] = useState({
    loading: true,
    error: false,
    demo: false,
    providers: { google: false, email: false },
  });
  const [emailChallenge, setEmailChallenge] = useState(null);
  const authGenerationRef = useRef(0);
  const authInFlightRef = useRef(0);
  const sessionCheckRef = useRef(0);
  const authStatusRequestedRef = useRef(false);
  const pendingAuthActionRef = useRef(null);
  const authChannelRef = useRef(null);
  const tabIdRef = useRef('');
  const sessionUserRef = useRef(null);
  const localAuthCompletedForRef = useRef('');

  const updateUser = useCallback((nextUser) => {
    const normalizedUser = nextUser || null;
    const previousOwnerId = String(sessionUserRef.current?.id || '');
    const nextOwnerId = String(normalizedUser?.id || '');
    if (previousOwnerId && previousOwnerId !== nextOwnerId) {
      removeScopedDraft(CHECKOUT_DRAFT_KEY, previousOwnerId);
    }
    sessionUserRef.current = normalizedUser;
    setUser(normalizedUser);
    setSessionInvalid(false);
    // Older builds cached account PII in localStorage. Sessions now live only in
    // the secure HttpOnly cookie, so remove that legacy copy whenever auth runs.
    try {
      window.localStorage.removeItem(LEGACY_USER_KEY);
    } catch {
      // Secure cookie sessions continue to work when browser storage is blocked.
    }
  }, []);

  const publishAuthChange = useCallback(() => {
    if (!tabIdRef.current) {
      tabIdRef.current = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    }
    const marker = `${tabIdRef.current}:${Date.now()}:${Math.random()}`;
    try {
      window.localStorage.setItem(AUTH_SYNC_KEY, marker);
    } catch {
      // BroadcastChannel remains available in browsers that block storage.
    }
    try {
      authChannelRef.current?.postMessage(marker);
    } catch {
      // Focus/visibility synchronization is the final fallback.
    }
  }, []);

  const completePendingAuthAction = useCallback((nextUser) => {
    const pending = pendingAuthActionRef.current;
    pendingAuthActionRef.current = null;
    if (!pending) return;
    const nextUserId = String(nextUser?.id || '');
    if (pending.expectedUserId && pending.expectedUserId !== nextUserId) {
      if (pending.onAccountMismatch) {
        window.setTimeout(() => {
          Promise.resolve()
            .then(() => pending.onAccountMismatch(nextUser))
            .catch(() => {});
        }, 0);
      }
      return;
    }
    window.setTimeout(() => {
      Promise.resolve()
        .then(() => pending.action(nextUser))
        // The initiating page owns operation-specific errors and keeps its draft.
        .catch(() => {});
    }, 0);
  }, []);

  // Authentication promises can resolve before React commits the new context
  // value to consumers. Resume protected work only from an effect so DOM event
  // handlers (notably requestSubmit on product/checkout forms) see the newly
  // authenticated user instead of reopening the auth modal from a stale render.
  useEffect(() => {
    if (!user || sessionInvalid) return;
    const userId = String(user.id || '');
    const completedInThisTab = localAuthCompletedForRef.current === userId;
    localAuthCompletedForRef.current = '';
    if (!pendingAuthActionRef.current) return;
    if (!completedInThisTab) {
      // A session appearing through BroadcastChannel/storage/focus must never
      // auto-submit an order or another side effect queued in this tab.
      pendingAuthActionRef.current = null;
      setAuthModalOpen(false);
      setAuthMessage('');
      setAuthMessageTone('');
      setEmailChallenge(null);
      return;
    }
    setAuthModalOpen(false);
    setAuthMessage('');
    setAuthMessageTone('');
    completePendingAuthAction(user);
  }, [completePendingAuthAction, sessionInvalid, user]);

  const synchronizeSession = useCallback(async () => {
    if (authInFlightRef.current) return;
    const generation = authGenerationRef.current;
    const sessionCheck = ++sessionCheckRef.current;
    try {
      const result = await api.getCurrentUser();
      if (
        generation !== authGenerationRef.current
        || sessionCheck !== sessionCheckRef.current
      ) return;
      const nextUser = userFrom(result);
      updateUser(nextUser);
    } catch (error) {
      if (
        generation !== authGenerationRef.current
        || sessionCheck !== sessionCheckRef.current
      ) return;
      if (error.status === 401 || error.status === 403) updateUser(null);
    } finally {
      if (
        generation === authGenerationRef.current
        && sessionCheck === sessionCheckRef.current
      ) setLoading(false);
    }
  }, [updateUser]);

  useEffect(() => {
    let active = true;
    const generation = authGenerationRef.current;
    const sessionCheck = ++sessionCheckRef.current;
    try {
      window.localStorage.removeItem(LEGACY_USER_KEY);
    } catch {
      // The HttpOnly session does not depend on local storage.
    }
    api
      .getCurrentUser()
      .then((result) => {
        if (
          active
          && generation === authGenerationRef.current
          && sessionCheck === sessionCheckRef.current
        ) {
          const nextUser = userFrom(result);
          updateUser(nextUser);
        }
      })
      .catch((error) => {
        if (
          !active
          || generation !== authGenerationRef.current
          || sessionCheck !== sessionCheckRef.current
        ) return;
        updateUser(null);
        if (error.status !== 401 && error.status !== 403) {
          setAuthMessage('We could not verify your saved session. Please sign in again.');
          setAuthMessageTone('error');
        }
      })
      .finally(() => {
        if (
          active
          && generation === authGenerationRef.current
          && sessionCheck === sessionCheckRef.current
        ) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [updateUser]);

  useEffect(() => {
    let channel;
    const syncFromAnotherTab = () => {
      void synchronizeSession();
    };
    const syncOnStorage = (event) => {
      if (event.key === AUTH_SYNC_KEY && event.newValue) syncFromAnotherTab();
    };
    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') syncFromAnotherTab();
    };

    try {
      if ('BroadcastChannel' in window) {
        channel = new window.BroadcastChannel(AUTH_SYNC_CHANNEL);
        channel.addEventListener('message', syncFromAnotherTab);
        authChannelRef.current = channel;
      }
    } catch {
      channel = null;
    }
    window.addEventListener('storage', syncOnStorage);
    window.addEventListener('focus', syncFromAnotherTab);
    document.addEventListener('visibilitychange', syncWhenVisible);
    return () => {
      window.removeEventListener('storage', syncOnStorage);
      window.removeEventListener('focus', syncFromAnotherTab);
      document.removeEventListener('visibilitychange', syncWhenVisible);
      if (authChannelRef.current === channel) authChannelRef.current = null;
      channel?.removeEventListener('message', syncFromAnotherTab);
      channel?.close();
    };
  }, [synchronizeSession]);

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
      setAuthMessageTone('error');
      setAuthModalOpen(true);
      refreshAuthStatus().catch(() => {});
    }
  }, [refreshAuthStatus]);

  const openAuth = useCallback((message = '', intent = 'login', tone = 'info') => {
    setAuthMessage(message);
    setAuthMessageTone(message ? tone : '');
    setAuthIntent(intent === 'signup' ? 'signup' : 'login');
    setEmailChallenge(null);
    setAuthModalOpen(true);
    if (!authStatusRequestedRef.current || authStatus.error) {
      refreshAuthStatus().catch(() => {});
    }
  }, [authStatus.error, refreshAuthStatus]);

  const requireAuth = useCallback(({
    message = 'Log in or create an account to continue securely.',
    intent = 'login',
    onAuthenticated,
    onAccountMismatch,
    force = false,
  } = {}) => {
    if (user && !sessionInvalid && !force) return true;
    pendingAuthActionRef.current = typeof onAuthenticated === 'function'
      ? {
        action: onAuthenticated,
        expectedUserId: force || sessionInvalid ? String(user?.id || '') : '',
        onAccountMismatch,
      }
      : null;
    if (force) {
      if (user?.id) removeScopedDraft(CHECKOUT_DRAFT_KEY, user.id);
      setSessionInvalid(true);
    }
    openAuth(message, intent, 'info');
    return false;
  }, [openAuth, sessionInvalid, user]);

  const closeAuth = useCallback(() => {
    authGenerationRef.current += 1;
    authInFlightRef.current = 0;
    localAuthCompletedForRef.current = '';
    setAuthenticating(false);
    setAuthModalOpen(false);
    setAuthMessage('');
    setAuthMessageTone('');
    setEmailChallenge(null);
    setAuthMethod('');
    pendingAuthActionRef.current = null;
  }, []);

  const runAuthentication = useCallback(async (method, operation, fallbackMessage) => {
    if (authInFlightRef.current) {
      const busyError = new Error('Another sign-in is already in progress. Please wait a moment.');
      setAuthMessage(busyError.message);
      setAuthMessageTone('error');
      throw busyError;
    }
    const generation = ++authGenerationRef.current;
    authInFlightRef.current = generation;
    setAuthMessage('');
    setAuthMessageTone('');
    setAuthenticating(true);
    setAuthMethod(method);
    try {
      const result = await operation();
      if (generation !== authGenerationRef.current) throw cancelledAuthentication();
      const nextUser = userFrom(result);
      if (!nextUser) throw new Error('No account was returned. Please try again.');
      if (generation === authGenerationRef.current) {
        localAuthCompletedForRef.current = String(nextUser.id || '');
        updateUser(nextUser);
        setEmailChallenge(null);
        setAuthModalOpen(false);
        setAuthMessage('');
        setAuthMessageTone('');
        publishAuthChange();
      }
      return nextUser;
    } catch (error) {
      const message = error.code === 'ACCOUNT_LINK_REQUIRED'
        ? 'An account already uses that email. Use its existing sign-in method, or enter the email above for a secure login code.'
        : error.message || fallbackMessage;
      if (generation === authGenerationRef.current) {
        if (error.code === 'ACCOUNT_LINK_REQUIRED') setAuthIntent('login');
        setAuthMessage(message);
        setAuthMessageTone('error');
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
  }, [publishAuthChange, updateUser]);

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
      setAuthMessageTone('error');
      throw busyError;
    }
    const operationToken = Symbol('email-start');
    authInFlightRef.current = operationToken;
    setAuthMessage('');
    setAuthMessageTone('');
    setAuthenticating(true);
    setAuthMethod('email');
    try {
      const rawChallenge = dataFrom(await api.startEmailAuthentication({ email, name, intent }));
      if (authInFlightRef.current !== operationToken) throw cancelledAuthentication();
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
        setAuthMessageTone('error');
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
    setAuthMessageTone('');
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
    localAuthCompletedForRef.current = '';
    setAuthenticating(false);
    setAuthMethod('');
    setSigningOut(true);
    pendingAuthActionRef.current = null;
    try {
      await api.signOut();
      if (generation === authGenerationRef.current) {
        updateUser(null);
        publishAuthChange();
      }
      return true;
    } catch (error) {
      if (generation === authGenerationRef.current) {
        setAuthMessage('Sign-out could not be confirmed, so your session remains active. Please try again.');
        setAuthMessageTone('error');
      }
      throw error;
    } finally {
      if (generation === authGenerationRef.current) {
        setSigningOut(false);
        setLoading(false);
      }
    }
  }, [publishAuthChange, updateUser]);

  const authenticatedUser = sessionInvalid ? null : user;
  const sessionOwnerId = String(user?.id || '');

  const value = useMemo(
    () => ({
      user: authenticatedUser,
      sessionOwnerId,
      sessionInvalid,
      loading,
      authModalOpen,
      authMessage,
      authMessageTone,
      authIntent,
      authenticating,
      authMethod,
      signingOut,
      authStatus,
      emailChallenge,
      refreshAuthStatus,
      refreshSession: synchronizeSession,
      openAuth,
      requireAuth,
      closeAuth,
      authenticateGoogle,
      startEmailAuthentication,
      verifyEmailAuthentication,
      resetEmailChallenge,
      authenticateDemo,
      signOut,
      setUser: updateUser,
    }),
    [authenticatedUser, sessionOwnerId, sessionInvalid, loading, authModalOpen, authMessage, authMessageTone, authIntent, authenticating, authMethod, signingOut, authStatus, emailChallenge, refreshAuthStatus, synchronizeSession, openAuth, requireAuth, closeAuth, authenticateGoogle, startEmailAuthentication, verifyEmailAuthentication, resetEmailChallenge, authenticateDemo, signOut, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
