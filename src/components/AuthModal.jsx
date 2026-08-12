import { useEffect, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Spinner from 'react-bootstrap/Spinner';
import Icon from './Icon';
import { useAuth } from '../context/AuthContext';

function credentialEmail(credential) {
  try {
    const payload = credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(window.atob(payload)).email?.toLowerCase() || '';
  } catch {
    return '';
  }
}

export default function AuthModal() {
  const {
    authModalOpen,
    authMessage,
    authIntent,
    authenticating,
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
  } = useAuth();
  const buttonRef = useRef(null);
  const googleCredentialRef = useRef('');
  const [googleReady, setGoogleReady] = useState(Boolean(window.google?.accounts?.id));
  const [localError, setLocalError] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [resending, setResending] = useState(false);

  const phoneEnabled = phoneAuthStatus.enabled;
  const phoneStatusReady = !phoneAuthStatus.loading && !phoneAuthStatus.error;
  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());
  const phoneValid = /^[6-9]\d{9}$/.test(phone);
  const detailsValid = phoneStatusReady && emailValid && (!phoneEnabled || phoneValid);

  useEffect(() => {
    if (!authModalOpen) {
      googleCredentialRef.current = '';
      setEmail('');
      setPhone('');
      setCode('');
      setLocalError('');
      return undefined;
    }
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setLocalError('Google sign-in is being configured. Please contact the studio in the meantime.');
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
          if (!detailsValid) {
            setLocalError(phoneEnabled
              ? 'Enter a valid email address and 10-digit Indian mobile number first.'
              : 'Enter the email address connected to your Google account first.');
            return;
          }
          const verifiedEmail = credentialEmail(credential);
          if (verifiedEmail && verifiedEmail !== email.trim().toLowerCase()) {
            setLocalError(`Continue with the Google account for ${email.trim().toLowerCase()}, or update the email field.`);
            return;
          }
          googleCredentialRef.current = credential;
          try {
            if (phoneEnabled) {
              await startPhoneAuthentication({
                credential,
                email: email.trim().toLowerCase(),
                phone: `+91${phone}`,
                intent: authIntent,
              });
            } else {
              await authenticateGoogle(credential);
            }
          } catch {
            // AuthContext renders the safe server error.
          }
        },
      });
      buttonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: 'continue_with',
        width: Math.min(390, buttonRef.current.clientWidth || 350),
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
  }, [authIntent, authModalOpen, authenticateGoogle, detailsValid, email, phone, phoneEnabled, startPhoneAuthentication]);

  useEffect(() => {
    setCode('');
    setLocalError('');
  }, [authIntent]);

  const verifyCode = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setLocalError('Enter the 6-digit code from the SMS.');
      return;
    }
    setLocalError('');
    try {
      await verifyPhoneAuthentication(code);
    } catch {
      // AuthContext renders the safe server error.
    }
  };

  const resendCode = async () => {
    if (!googleCredentialRef.current || !phoneValid) {
      resetPhoneChallenge();
      return;
    }
    setResending(true);
    setCode('');
    setLocalError('');
    try {
      await startPhoneAuthentication({
        credential: googleCredentialRef.current,
        email: email.trim().toLowerCase(),
        phone: `+91${phone}`,
        intent: authIntent,
      });
    } catch {
      // AuthContext renders the safe server error.
    } finally {
      setResending(false);
    }
  };

  return (
    <Modal show={authModalOpen} onHide={closeAuth} centered dialogClassName="auth-dialog auth-dialog--form">
      <Modal.Body>
        <button type="button" className="icon-button modal-close" onClick={closeAuth} aria-label="Close account dialog">
          <Icon name="close" />
        </button>
        <div className="auth-modal__mark" aria-hidden="true"><Icon name={phoneChallenge ? 'phone' : 'spark'} size={25} /></div>

        {!phoneChallenge ? (
          <>
            <div className="auth-mode-tabs" role="tablist" aria-label="Account action">
              <button type="button" role="tab" aria-selected={authIntent === 'login'} className={authIntent === 'login' ? 'is-active' : ''} onClick={() => openAuth('', 'login')}>Log in</button>
              <button type="button" role="tab" aria-selected={authIntent === 'signup'} className={authIntent === 'signup' ? 'is-active' : ''} onClick={() => openAuth('', 'signup')}>Create account</button>
            </div>
            <p className="eyebrow">{authIntent === 'signup' ? 'A place for every keepsake' : 'Welcome back'}</p>
            <h2>{authIntent === 'signup' ? 'Create your studio account.' : 'Return to your thoughtful details.'}</h2>
            <p className="muted-copy">
              {authIntent === 'signup'
                ? 'Use your verified email and mobile number to keep orders, custom requests and studio updates together.'
                : 'Confirm the email and mobile number connected to your account, then continue securely with Google.'}
            </p>
            {(authMessage || localError) && <Alert variant="danger" className="soft-alert">{authMessage || localError}</Alert>}
            {phoneAuthStatus.loading && <Alert variant="info" className="soft-alert auth-service-note"><Spinner size="sm" /> Checking secure sign-in options…</Alert>}
            {phoneAuthStatus.error && <Alert variant="warning" className="soft-alert auth-service-note"><Icon name="shield" /> Secure sign-in status could not be confirmed. <button type="button" className="plain-link" onClick={() => refreshPhoneAuthStatus().catch(() => {})}>Retry</button></Alert>}
            {phoneStatusReady && !phoneEnabled && (
              <Alert variant="info" className="soft-alert auth-service-note"><Icon name="shield" /> Mobile OTP is provider-ready but awaiting SMS activation. Google verification remains available.</Alert>
            )}
            <Form className="auth-details-form" onSubmit={(event) => event.preventDefault()} noValidate>
              <Form.Group controlId="account-email">
                <Form.Label>Email address</Form.Label>
                <Form.Control type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" isInvalid={email.length > 2 && !emailValid} />
                <Form.Control.Feedback type="invalid">Enter the email used by your Google account.</Form.Control.Feedback>
              </Form.Group>
              <Form.Group controlId="account-phone">
                <Form.Label>Mobile number {phoneEnabled ? '' : <small>OTP activation pending</small>}</Form.Label>
                <div className="auth-phone-field"><span>+91</span><Form.Control inputMode="numeric" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} autoComplete="tel" placeholder="10-digit number" disabled={!phoneEnabled} isInvalid={phoneEnabled && phone.length > 2 && !phoneValid} /></div>
                {phoneEnabled && <Form.Text>We’ll send a one-time SMS code. Standard messaging rates may apply.</Form.Text>}
              </Form.Group>
            </Form>
            <div className={`google-signin-slot ${googleReady ? 'is-ready' : ''} ${authenticating ? 'is-busy' : ''} ${!detailsValid ? 'is-disabled' : ''}`} aria-label={authIntent === 'signup' ? 'Create account with Google' : 'Log in with Google'} aria-busy={authenticating}>
              {!googleReady && !localError && <span className="google-button-placeholder">Preparing secure Google verification…</span>}
              <div className="google-signin-target" ref={buttonRef} />
            </div>
            {!detailsValid && <p className="auth-form-hint">Enter your {phoneEnabled ? 'email and mobile number' : 'email'} to unlock secure Google verification.</p>}
            {import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true' && (
              <div className="demo-auth"><span>Local preview only</span><div><button type="button" onClick={() => authenticateDemo('buyer').catch(() => {})}>Preview buyer</button><button type="button" onClick={() => authenticateDemo('admin').catch(() => {})}>Preview admin</button></div></div>
            )}
            <p className="privacy-note"><Icon name="lock" size={13} /> Google verifies your email. Your mobile number is used only for account security and studio communication.</p>
          </>
        ) : (
          <Form className="auth-otp" onSubmit={verifyCode}>
            <p className="eyebrow">One final stitch</p>
            <h2>Verify your mobile number.</h2>
            <p className="muted-copy">Enter the 6-digit code sent to <strong>{phoneChallenge.phoneMasked || `+91 ••••••${phone.slice(-4)}`}</strong>.</p>
            {(authMessage || localError) && <Alert variant="danger" className="soft-alert">{authMessage || localError}</Alert>}
            <Form.Group controlId="account-otp">
              <Form.Label>SMS verification code</Form.Label>
              <Form.Control className="auth-otp__input" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" maxLength={6} />
            </Form.Group>
            <Button type="submit" className="button-burgundy w-100" disabled={authenticating || code.length !== 6}>{authenticating ? <><Spinner size="sm" /> Verifying…</> : 'Verify and continue'}</Button>
            <div className="auth-otp__actions"><button type="button" className="plain-link" onClick={() => { resetPhoneChallenge(); setCode(''); }}>Change details</button><button type="button" className="plain-link" onClick={resendCode} disabled={resending}>{resending ? 'Sending…' : 'Send a new code'}</button></div>
            <p className="privacy-note"><Icon name="shield" size={13} /> Codes expire quickly and can be used only once.</p>
          </Form>
        )}
      </Modal.Body>
    </Modal>
  );
}
