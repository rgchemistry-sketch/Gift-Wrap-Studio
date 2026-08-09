import { useEffect, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Modal from 'react-bootstrap/Modal';
import Icon from './Icon';
import { useAuth } from '../context/AuthContext';

export default function AuthModal() {
  const { authModalOpen, authMessage, closeAuth, authenticateGoogle, authenticateDemo } = useAuth();
  const buttonRef = useRef(null);
  const [googleReady, setGoogleReady] = useState(Boolean(window.google?.accounts?.id));
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!authModalOpen) return undefined;
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setLocalError('Google sign-in is being configured. Please contact the studio to place an order in the meantime.');
      return undefined;
    }

    let script = document.querySelector('script[data-gnw-google]');
    const render = () => {
      if (!window.google?.accounts?.id || !buttonRef.current) return;
      setGoogleReady(true);
      setLocalError('');
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          if (!credential) return;
          try {
            await authenticateGoogle(credential);
          } catch {
            // AuthContext renders the server-provided, user-safe error.
          }
        },
      });
      buttonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: 'continue_with',
        width: Math.min(360, buttonRef.current.clientWidth || 320),
      });
    };

    if (script) {
      if (window.google?.accounts?.id) render();
      else script.addEventListener('load', render, { once: true });
    } else {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.gnwGoogle = 'true';
      script.addEventListener('load', render, { once: true });
      script.addEventListener('error', () => setLocalError('Google sign-in could not load. Check your connection and try again.'), { once: true });
      document.head.appendChild(script);
    }
    const slowTimer = window.setTimeout(() => {
      if (!window.google?.accounts?.id) setLocalError('Google sign-in is taking longer than expected. Please refresh and try once more.');
    }, 8000);
    return () => {
      window.clearTimeout(slowTimer);
      script?.removeEventListener('load', render);
    };
  }, [authModalOpen, authenticateGoogle]);

  return (
    <Modal show={authModalOpen} onHide={closeAuth} centered dialogClassName="auth-dialog">
      <Modal.Body>
        <button type="button" className="icon-button modal-close" onClick={closeAuth} aria-label="Close sign-in dialog">
          <Icon name="close" />
        </button>
        <div className="auth-modal__mark" aria-hidden="true"><Icon name="spark" size={26} /></div>
        <p className="eyebrow">Your studio account</p>
        <h2>Keep every thoughtful detail together.</h2>
        <p className="muted-copy">
          Sign in to save pieces, revisit customization notes, and follow each handmade order from concept to delivery.
        </p>
        {(authMessage || localError) && <Alert variant="danger" className="soft-alert">{authMessage || localError}</Alert>}
        <div className={`google-signin-slot ${googleReady ? 'is-ready' : ''}`} ref={buttonRef} aria-label="Continue with Google">
          {!googleReady && !localError && <span className="google-button-placeholder">Preparing secure Google sign-in…</span>}
        </div>
        {import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true' && (
          <div className="demo-auth">
            <span>Local preview only</span>
            <div>
              <button type="button" onClick={() => authenticateDemo('buyer').catch(() => {})}>Preview buyer</button>
              <button type="button" onClick={() => authenticateDemo('admin').catch(() => {})}>Preview admin</button>
            </div>
          </div>
        )}
        <p className="privacy-note">
          By continuing, you agree to our terms and acknowledge our privacy policy. We never post on your behalf.
        </p>
      </Modal.Body>
    </Modal>
  );
}
