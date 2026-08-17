import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Spinner from 'react-bootstrap/Spinner';
import Icon from './Icon';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';

const sdkPromises = new Map();

function loadScript(key, src, attributes = {}) {
  if (sdkPromises.has(key)) return sdkPromises.get(key);
  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-auth-sdk="${key}"]`);
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    const script = existing || document.createElement('script');
    const loaded = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', () => {
      script.remove();
      reject(new Error(`${key} sign-in could not load.`));
    }, { once: true });
    if (!existing) {
      script.src = src;
      script.async = true;
      script.defer = true;
      script.dataset.authSdk = key;
      Object.entries(attributes).forEach(([name, value]) => script.setAttribute(name, value));
      document.head.appendChild(script);
    }
  }).catch((error) => {
    sdkPromises.delete(key);
    throw error;
  });
  sdkPromises.set(key, promise);
  return promise;
}

function SocialMark() {
  return <span className="social-mark social-mark--google" aria-hidden="true">G</span>;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const errorMessage = (error, fallback) => String(error?.message || fallback);

function signedInMessage(user, intent) {
  const firstName = String(user?.name || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `, ${firstName}` : '';
  return intent === 'signup'
    ? `Welcome${greeting}. Your studio account is ready.`
    : `Welcome back${greeting}. You’re signed in securely.`;
}

export default function AuthModal() {
  const {
    authModalOpen,
    authMessage,
    authMessageTone,
    authIntent,
    authenticating,
    authMethod,
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
  } = useAuth();
  const { notify } = useShop();
  const googleButtonRef = useRef(null);
  const googleInitializedRef = useRef(false);
  const authenticateGoogleRef = useRef(authenticateGoogle);
  const authIntentRef = useRef(authIntent);
  const notifyRef = useRef(notify);
  const codeInputRef = useRef(null);
  const providerBusyRef = useRef(false);
  const providerFlowRef = useRef(0);
  const googleErrorToastRef = useRef(-1);
  const [sdkReady, setSdkReady] = useState({ google: false });
  const [sdkErrors, setSdkErrors] = useState({});
  const [sdkRetry, setSdkRetry] = useState(0);
  const [providerStarting, setProviderStarting] = useState('');
  const [localError, setLocalError] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);
  const [entrySubmitted, setEntrySubmitted] = useState(false);

  const providers = authStatus.providers || {};
  const emailValid = emailPattern.test(email.trim());
  const nameValid = authIntent !== 'signup' || name.trim().length >= 2;
  const googleConfigured = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID) && providers.google;
  const uiBusy = authenticating || Boolean(providerStarting);
  const providerErrors = Object.entries(sdkErrors).filter(([, message]) => Boolean(message));

  useEffect(() => {
    authenticateGoogleRef.current = authenticateGoogle;
    authIntentRef.current = authIntent;
    notifyRef.current = notify;
  }, [authenticateGoogle, authIntent, notify]);

  const beginProviderFlow = useCallback((provider) => {
    if (providerBusyRef.current) return 0;
    providerBusyRef.current = true;
    const flowId = ++providerFlowRef.current;
    setProviderStarting(provider);
    setLocalError('');
    return flowId;
  }, []);

  const finishProviderFlow = useCallback((flowId) => {
    if (flowId !== providerFlowRef.current) return;
    providerBusyRef.current = false;
    setProviderStarting('');
  }, []);

  const requestClose = useCallback(() => {
    if (uiBusy) return;
    providerFlowRef.current += 1;
    providerBusyRef.current = false;
    closeAuth();
  }, [closeAuth, uiBusy]);

  const chooseIntent = (intent) => {
    if (uiBusy) return;
    providerFlowRef.current += 1;
    providerBusyRef.current = false;
    openAuth('', intent);
  };

  const retryProviderSdks = () => {
    if (uiBusy) return;
    setSdkErrors({});
    setSdkReady({ google: false });
    setSdkRetry((current) => current + 1);
    refreshAuthStatus().catch((error) => {
      notify(errorMessage(error, 'Secure sign-in options could not be refreshed.'), 'error');
    });
  };

  useEffect(() => {
    if (!authModalOpen) {
      providerFlowRef.current += 1;
      providerBusyRef.current = false;
      setProviderStarting('');
      setEmail('');
      setName('');
      setCode('');
      setLocalError('');
      setResendSeconds(0);
      setEntrySubmitted(false);
    }
  }, [authModalOpen]);

  useEffect(() => {
    setCode('');
    setLocalError('');
    setEntrySubmitted(false);
    if (authIntent === 'login') setName('');
  }, [authIntent]);

  useEffect(() => {
    if (authStatus.loading || !authModalOpen || !googleConfigured || !googleButtonRef.current) return undefined;
    let active = true;
    let resizeTimer;
    let repaintOnResize;
    let paintedWidth = 0;
    const markGoogleUnavailable = () => {
      if (!active) return;
      setSdkReady((current) => ({ ...current, google: false }));
      setSdkErrors((current) => ({ ...current, google: 'Google sign-in could not load.' }));
      if (googleErrorToastRef.current !== sdkRetry) {
        googleErrorToastRef.current = sdkRetry;
        notifyRef.current('Google sign-in is unavailable right now. You can still use a secure email code.', 'warning');
      }
    };
    const renderGoogle = async () => {
      try {
        await loadScript('google', 'https://accounts.google.com/gsi/client');
        if (!active || !googleButtonRef.current) return;
        if (!window.google?.accounts?.id) throw new Error('Google Identity Services was unavailable.');
        if (!googleInitializedRef.current) {
          window.google.accounts.id.initialize({
            client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
            callback: ({ credential }) => {
              if (!credential) return;
              const flowId = beginProviderFlow('google');
              if (!flowId) return;
              authenticateGoogleRef.current(credential)
                .then((user) => notifyRef.current(signedInMessage(user, authIntentRef.current)))
                .catch((error) => notifyRef.current(errorMessage(error, 'Google sign-in could not be completed. Please try again.'), 'error'))
                .finally(() => finishProviderFlow(flowId));
            },
          });
          googleInitializedRef.current = true;
        }
        const paintButton = ({ force = false } = {}) => {
          const target = googleButtonRef.current;
          if (!active || !target) return false;
          const availableWidth = Math.floor(target.getBoundingClientRect().width);
          const nextWidth = Math.min(400, Math.max(200, availableWidth || 320));
          if (!force && target.contains(document.activeElement)) return true;
          if (!force && paintedWidth && Math.abs(nextWidth - paintedWidth) < 2) return true;
          try {
            target.replaceChildren();
            window.google.accounts.id.renderButton(target, {
              theme: 'outline',
              // Google does not expose a direct personalization switch. Its
              // documented medium size always uses the generic button label.
              size: 'medium',
              shape: 'rectangular',
              text: authIntent === 'signup' ? 'signup_with' : 'continue_with',
              logo_alignment: 'left',
              width: nextWidth,
            });
            paintedWidth = nextWidth;
            return true;
          } catch {
            markGoogleUnavailable();
            return false;
          }
        };
        if (!paintButton({ force: true })) return;
        repaintOnResize = () => {
          window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(paintButton, 120);
        };
        window.addEventListener('resize', repaintOnResize);
        setSdkReady((current) => ({ ...current, google: true }));
        setSdkErrors((current) => ({ ...current, google: '' }));
      } catch {
        markGoogleUnavailable();
      }
    };
    renderGoogle();
    return () => {
      active = false;
      window.clearTimeout(resizeTimer);
      if (repaintOnResize) window.removeEventListener('resize', repaintOnResize);
    };
  }, [authIntent, authModalOpen, authStatus.loading, beginProviderFlow, finishProviderFlow, googleConfigured, sdkRetry]);

  useEffect(() => {
    if (!emailChallenge) return undefined;
    setResendSeconds(Number(emailChallenge.retryAfterSeconds || 60));
    setCode('');
    window.setTimeout(() => codeInputRef.current?.focus(), 120);
    const timer = window.setInterval(() => {
      setResendSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [emailChallenge]);

  const submitEmail = async (event) => {
    event.preventDefault();
    setEntrySubmitted(true);
    if (!emailValid) {
      setLocalError('Enter a valid email address.');
      return;
    }
    if (!nameValid) {
      setLocalError('Enter the name you would like on your account.');
      return;
    }
    setLocalError('');
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await startEmailAuthentication({
        email: normalizedEmail,
        name: authIntent === 'signup' ? name.trim() : '',
        intent: authIntent,
      });
      notify(`Verification code sent to ${normalizedEmail}.`, 'info');
    } catch (error) {
      notify(errorMessage(error, 'The verification email could not be sent. Please try again.'), 'error');
    }
  };

  const verifyCode = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setLocalError('Enter the complete 6-digit code from your email.');
      return;
    }
    setLocalError('');
    try {
      const user = await verifyEmailAuthentication(code);
      notify(signedInMessage(user, authIntent));
    } catch (error) {
      notify(errorMessage(error, 'That verification code could not be confirmed.'), 'error');
    }
  };

  const resendCode = async () => {
    if (resendSeconds > 0) return;
    setLocalError('');
    try {
      await startEmailAuthentication({
        email: emailChallenge.email || email.trim().toLowerCase(),
        name: authIntent === 'signup' ? name.trim() : '',
        intent: authIntent,
      });
      notify('A new verification code is on its way.', 'info');
    } catch (error) {
      notify(errorMessage(error, 'A new verification code could not be sent yet.'), 'error');
    }
  };

  const previewAccount = async (role) => {
    try {
      const user = await authenticateDemo(role);
      notify(signedInMessage(user, 'login'));
    } catch (error) {
      notify(errorMessage(error, 'Preview sign-in could not be completed.'), 'error');
    }
  };

  const authMessageVariant = authMessageTone === 'info' ? 'info' : 'danger';

  return (
    <Modal
      show={authModalOpen}
      onHide={requestClose}
      centered
      scrollable
      restoreFocus
      aria-labelledby="auth-dialog-title"
      aria-describedby="auth-dialog-description"
      dialogClassName="auth-dialog auth-dialog--passwordless"
    >
      <Modal.Body>
        <button type="button" className="icon-button modal-close" onClick={requestClose} disabled={uiBusy} aria-label="Close account dialog">
          <Icon name="close" />
        </button>

        {!emailChallenge ? (
          <div className="auth-dialog__entry">
            <div className="auth-modal__topline">
              <div className="auth-modal__brand" aria-hidden="true">
                <span>G</span><i>·</i><span>W</span>
              </div>
              <div className="auth-mode-tabs" role="group" aria-label="Choose account action">
                <button type="button" disabled={uiBusy} aria-pressed={authIntent === 'login'} className={authIntent === 'login' ? 'is-active' : ''} onClick={() => chooseIntent('login')}>Log in</button>
                <button type="button" disabled={uiBusy} aria-pressed={authIntent === 'signup'} className={authIntent === 'signup' ? 'is-active' : ''} onClick={() => chooseIntent('signup')}>Create account</button>
              </div>
            </div>

            <div className="auth-heading">
              <p className="eyebrow">{authIntent === 'signup' ? 'Begin your keepsake collection' : 'Welcome back'}</p>
              <h2 id="auth-dialog-title">{authIntent === 'signup' ? 'Create your studio account.' : 'Your thoughtful details, kept together.'}</h2>
              <p className="muted-copy" id="auth-dialog-description">
                {authIntent === 'signup'
                  ? 'Save personalized pieces, follow orders and make every future gift a little easier.'
                  : 'Use a secure email code or continue with an account you already trust.'}
              </p>
            </div>

            {(authMessage || localError) && (
              <Alert
                variant={localError ? 'danger' : authMessageVariant}
                className={`soft-alert ${!localError && authMessageTone === 'info' ? 'auth-intent-note' : ''}`}
                role={localError || authMessageTone !== 'info' ? 'alert' : 'status'}
              >
                <Icon name={localError || authMessageTone !== 'info' ? 'shield' : 'lock'} size={16} />
                <span>{authMessage || localError}</span>
              </Alert>
            )}
            {authStatus.loading && <Alert variant="info" className="soft-alert auth-service-note" role="status"><Spinner size="sm" /> Checking secure sign-in options…</Alert>}
            {(authStatus.error || providerErrors.length > 0) && !authMessage && !localError && (
              <Alert variant="warning" className="soft-alert auth-service-note" role="alert">
                <Icon name="shield" /> {providerErrors.length
                  ? `${providerErrors.map(([provider]) => provider[0].toUpperCase() + provider.slice(1)).join(', ')} sign-in could not load.`
                  : 'Sign-in availability could not be checked.'}{' '}
                <button type="button" className="plain-link" disabled={uiBusy} onClick={retryProviderSdks}>Retry</button>
              </Alert>
            )}

            <div className="social-auth-list" role="group" aria-label="Google sign-in option">
              <div
                className={`social-auth-button social-auth-button--google ${googleConfigured && !sdkErrors.google ? 'is-ready' : ''} ${authStatus.loading || !googleConfigured || sdkErrors.google || (uiBusy && providerStarting !== 'google' && authMethod !== 'google') ? 'is-disabled' : ''}`}
                aria-busy={providerStarting === 'google' || authMethod === 'google'}
                aria-disabled={uiBusy || authStatus.loading || !googleConfigured || Boolean(sdkErrors.google)}
                inert={uiBusy ? true : undefined}
              >
                {authStatus.loading
                  ? <><SocialMark /><span>Checking Google…</span></>
                  : googleConfigured && !sdkErrors.google
                    ? <div className="google-signin-target" ref={googleButtonRef} />
                    : <><SocialMark /><span>Continue with Google</span><small>{sdkErrors.google ? 'Unavailable' : 'Not configured'}</small></>}
                {googleConfigured && !sdkReady.google && !sdkErrors.google && !authStatus.loading && <span className="social-auth-loading" role="status">Preparing Google…</span>}
                {(providerStarting === 'google' || authMethod === 'google') && <span className="social-auth-busy" role="status" aria-label="Signing in with Google"><Spinner size="sm" /></span>}
              </div>
            </div>

            <div className="auth-divider"><span>or use your email</span></div>

            <Form className={`email-auth-form ${authIntent === 'signup' ? 'is-signup' : ''}`} onSubmit={submitEmail} noValidate aria-busy={authenticating && authMethod === 'email'}>
              {authIntent === 'signup' && (
                <Form.Group className="email-auth-form__group" controlId="account-name">
                  <Form.Label>Your name</Form.Label>
                  <Form.Control
                    type="text"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value.slice(0, 100));
                      if (localError) setLocalError('');
                    }}
                    autoComplete="name"
                    placeholder="How should we address you?"
                    isInvalid={(entrySubmitted || name.length > 0) && !nameValid}
                    aria-invalid={(entrySubmitted || name.length > 0) && !nameValid}
                    aria-describedby={(entrySubmitted || name.length > 0) && !nameValid ? 'account-name-error' : undefined}
                    disabled={uiBusy}
                    autoFocus
                  />
                  <Form.Control.Feedback id="account-name-error" type="invalid">Enter at least 2 characters.</Form.Control.Feedback>
                </Form.Group>
              )}
              <Form.Group className="email-auth-form__group" controlId="account-email">
                <Form.Label>Email address</Form.Label>
                <div className="email-auth-form__field">
                  <Icon name="mail" size={18} />
                  <Form.Control
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value.slice(0, 254));
                      if (localError) setLocalError('');
                    }}
                    autoComplete="email"
                    placeholder="you@example.com"
                    isInvalid={(entrySubmitted || email.length > 2) && !emailValid}
                    aria-invalid={(entrySubmitted || email.length > 2) && !emailValid}
                    aria-describedby={(entrySubmitted || email.length > 2) && !emailValid ? 'account-email-error' : undefined}
                    disabled={uiBusy}
                    autoFocus={authIntent === 'login'}
                  />
                </div>
                {(entrySubmitted || email.length > 2) && !emailValid && <div id="account-email-error" className="invalid-feedback d-block">Enter a valid email address.</div>}
              </Form.Group>
              <Button type="submit" className="button-burgundy auth-email-submit" disabled={uiBusy || authStatus.loading || !providers.email}>
                {authenticating && authMethod === 'email' ? <><Spinner size="sm" /> Sending code…</> : <>Email me a verification code <Icon name="arrow" size={17} /></>}
              </Button>
              {!authStatus.loading && !providers.email && <p className="auth-provider-note">Email verification is awaiting activation by the studio.</p>}
            </Form>

            {import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true' && (
              <div className="demo-auth"><span>Local preview only</span><div><button type="button" disabled={uiBusy} onClick={() => previewAccount('buyer')}>Preview buyer</button><button type="button" disabled={uiBusy} onClick={() => previewAccount('admin')}>Preview admin</button></div></div>
            )}
            <p className="privacy-note"><Icon name="lock" size={13} /> Password-free sign-in. We only use verified identity details to secure your account.</p>
          </div>
        ) : (
          <Form className="auth-otp auth-otp--email" onSubmit={verifyCode}>
            <div className="auth-modal__mark" aria-hidden="true"><Icon name="mail" size={25} /></div>
            <p className="eyebrow">Check your inbox</p>
            <h2 id="auth-dialog-title">One small code, then you’re in.</h2>
            <p className="muted-copy" id="auth-dialog-description">Enter the 6-digit verification code sent to <strong>{emailChallenge.emailMasked || emailChallenge.email || email}</strong>.</p>
            {(authMessage || localError) && (
              <Alert variant="danger" className="soft-alert auth-otp__alert" role="alert">
                <Icon name="shield" size={16} />
                <span>{authMessage || localError}</span>
              </Alert>
            )}
            {emailChallenge.previewCode && (
              <Alert variant="info" className="soft-alert auth-preview-code"><strong>Local preview code:</strong> <code>{emailChallenge.previewCode}</code></Alert>
            )}
            <Form.Group controlId="account-email-code">
              <Form.Label>Email verification code</Form.Label>
              <Form.Control
                ref={codeInputRef}
                className="auth-otp__input"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                  if (localError) setLocalError('');
                }}
                placeholder="000000"
                maxLength={6}
                aria-describedby={`email-code-help${code.length > 0 && code.length !== 6 ? ' email-code-error' : ''}`}
                aria-invalid={code.length > 0 && code.length !== 6}
                disabled={uiBusy}
              />
              {code.length > 0 && code.length !== 6 && <div id="email-code-error" className="invalid-feedback d-block">Enter all 6 digits from the email.</div>}
              <Form.Text id="email-code-help">The code expires in {emailChallenge.expiresInMinutes || 10} minutes and works once.</Form.Text>
            </Form.Group>
            <Button type="submit" className="button-burgundy w-100" disabled={uiBusy || code.length !== 6}>
              {authenticating ? <><Spinner size="sm" /> Verifying…</> : 'Verify and continue'}
            </Button>
            <div className="auth-otp__actions">
              <button type="button" className="plain-link" disabled={uiBusy} onClick={() => { resetEmailChallenge(); setCode(''); }}>Use another email</button>
              <button type="button" className="plain-link" onClick={resendCode} disabled={uiBusy || resendSeconds > 0}>
                {resendSeconds > 0 ? `Send again in ${resendSeconds}s` : 'Send a new code'}
              </button>
            </div>
            <p className="privacy-note"><Icon name="shield" size={13} /> Sent only by Gift N Wrap’s configured verification address.</p>
          </Form>
        )}
      </Modal.Body>
    </Modal>
  );
}
