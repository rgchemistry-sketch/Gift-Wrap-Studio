import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { RouteLoader, ToastStack } from './Feedback';
import AuthModal from './AuthModal';

export default function AdminShell() {
  return (
    <div className="site-shell admin-site-shell">
      <main id="main-content" tabIndex="-1"><Suspense fallback={<RouteLoader label="Preparing your studio desk…" />}><Outlet /></Suspense></main>
      <AuthModal />
      <ToastStack />
    </div>
  );
}
