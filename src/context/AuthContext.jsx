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
  const [user, setUser] = useState(readCachedUser);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState('');

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
        if (error.status === 401 || error.status === 403) cacheUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cacheUser]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authState = params.get('auth');
    if (authState === 'error') {
      setAuthMessage('Google sign-in could not be completed. Please try again.');
      setAuthModalOpen(true);
    }
  }, []);

  const openAuth = useCallback((message = '') => {
    setAuthMessage(message);
    setAuthModalOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    setAuthModalOpen(false);
    setAuthMessage('');
  }, []);

  const authenticateGoogle = useCallback(async (credential) => {
    setAuthMessage('');
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
    }
  }, [cacheUser]);

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
    try {
      await api.signOut();
    } finally {
      cacheUser(null);
    }
  }, [cacheUser]);

  const value = useMemo(
    () => ({
      user,
      loading,
      authModalOpen,
      authMessage,
      openAuth,
      closeAuth,
      authenticateGoogle,
      authenticateDemo,
      signOut,
      setUser: cacheUser,
    }),
    [user, loading, authModalOpen, authMessage, openAuth, closeAuth, authenticateGoogle, authenticateDemo, signOut, cacheUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
