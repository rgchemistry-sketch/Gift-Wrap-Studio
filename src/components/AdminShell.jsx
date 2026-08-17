import { lazy, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { ToastStack } from './Feedback';
import { useAuth } from '../context/AuthContext';

const AuthModal = lazy(() => import('./AuthModal'));

export default function AdminShell() {
  const { authModalOpen } = useAuth();

  return (
    <div className="site-shell admin-site-shell">
      <main id="main-content" tabIndex="-1"><Outlet /></main>
      {authModalOpen && <Suspense fallback={null}><AuthModal /></Suspense>}
      <ToastStack />
    </div>
  );
}
