import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Spinner from 'react-bootstrap/Spinner';
import Icon from './Icon';
import { useAuth } from '../context/AuthContext';

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

function SocialMark({ provider }) {
  if (provider === 'facebook') return <span className="social-mark social-mark--facebook" aria-hidden="true">f</span>;
  if (provider === 'apple') return <span className="social-mark social-mark--apple" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M17.05 12.54c-.02-2.52 2.06-3.74 2.15-3.8a4.62 4.62 0 0 0-3.64-1.97c-1.53-.16-3.02.92-3.8.92-.8 0-2-.9-3.3-.87a4.84 4.84 0 0 0-4.08 2.49c-1.76 3.04-.45 7.51 1.23 9.97.84 1.2 1.82 2.55 3.12 2.5 1.27-.05 1.75-.8 3.28-.8 1.52 0 1.97.8 3.3.77 1.36-.02 2.22-1.2 3.03-2.42a9.95 9.95 0 0 0 1.39-2.82 4.38 4.38 0 0 1-2.68-3.97ZM14.56 5.15a4.44 4.44 0 0 0 1.02-3.18 4.52 4.52 0 0 0-2.93 1.51 4.27 4.27 0 0 0-1.05 3.07 3.74 3.74 0 0 0 2.96-1.4Z" /></svg></span>;
  return <span className="social-mark social-mark--google" aria-hidden="true">G</span>;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthModal() {
  const {
    authModalOpen,
    authMessage,
    authIntent,
    authenticating,
    authMethod,
    authStatus,
    emailChallenge,
    refreshAuthStatus,
    openAuth,
    closeAuth,
    authenticateGoogle,
    authenticateFacebook,
    prepareAppleAuthentication,
    authenticateApple,
    startEmailAuthentication,
    verifyEmailAuthentication,
    resetEmailChallenge,
    authenticateDemo,
  } = useAuth();
  const googleButtonRef = useRef(null);
  const googleInitializedRef = useRef(false);
  const authenticateGoogleRef = useRef(authenticateGoogle);
  const codeInputRef = useRef(null);
  const providerBusyRef = useRef(false);
  const providerFlowRef = useRef(0);
  const [sdkReady, setSdkReady] = useState({ google: false, facebook: false, apple: false });
  const [sdkErrors, setSdkErrors] = useState({});
  const [sdkRetry, setSdkRetry] = useState(0);
  const [providerStarting, setProviderStarting] = useState('');
  const [localError, setLocalError] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);

  const providers = authStatus.providers || {};
  const emailValid = emailPattern.test(email.trim());
  const nameValid = authIntent !== 'signup' || name.trim().length >= 2;
  const googleConfigured = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID) && providers.google;
  const facebookConfigured = Boolean(import.meta.env.VITE_FACEBOOK_APP_ID) && providers.facebook;
  const appleConfigured = Boolean(import.meta.env.VITE_APPLE_CLIENT_ID && import.meta.env.VITE_APPLE_REDIRECT_URI) && providers.apple;
  const uiBusy = authenticating || Boolean(providerStarting);
  const providerErrors = Object.entries(sdkErrors).filter(([, message]) => Boolean(message));

  useEffect(() => {
    authenticateGoogleRef.current = authenticateGoogle;
  }, [authenticateGoogle]);

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
    setSdkReady({ google: false, facebook: false, apple: false });
    setSdkRetry((current) => current + 1);
    refreshAuthStatus().catch(() => {});
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
    }
  }, [authModalOpen]);

  useEffect(() => {
    setCode('');
    setLocalError('');
    if (authIntent === 'login') setName('');
  }, [authIntent]);

  useEffect(() => {
    if (authStatus.loading || !authModalOpen || !googleConfigured || !googleButtonRef.current) return undefined;
    let active = true;
    const renderGoogle = async () => {
      try {
        await loadScript('google', 'https://accounts.google.com/gsi/client');
        if (!active || !window.google?.accounts?.id || !googleButtonRef.current) return;
        if (!googleInitializedRef.current) {
          window.google.accounts.id.initialize({
            client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
            callback: ({ credential }) => {
              if (!credential) return;
              const flowId = beginProviderFlow('google');
              if (!flowId) return;
              authenticateGoogleRef.current(credential)
                .catch(() => {})
                .finally(() => finishProviderFlow(flowId));
            },
          });
          googleInitializedRef.current = true;
        }
        googleButtonRef.current.replaceChildren();
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: authIntent === 'signup' ? 'signup_with' : 'continue_with',
          // Google shows the browser's previously used account on buttons 200px or wider.
          // Keep the official button just below that threshold so it remains generic.
          width: 199,
        });
        setSdkReady((current) => ({ ...current, google: true }));
        setSdkErrors((current) => ({ ...current, google: '' }));
      } catch {
        if (active) setSdkErrors((current) => ({ ...current, google: 'Google sign-in could not load.' }));
      }
    };
    renderGoogle();
    return () => {
      active = false;
    };
  }, [authIntent, authModalOpen, authStatus.loading, beginProviderFlow, finishProviderFlow, googleConfigured, sdkRetry]);

  useEffect(() => {
    if (!authModalOpen || !facebookConfigured) return undefined;
    let active = true;
    loadScript('facebook', 'https://connect.facebook.net/en_US/sdk.js', { crossOrigin: 'anonymous' })
      .then(() => {
        if (!active || !window.FB) return;
        window.FB.init({
          appId: import.meta.env.VITE_FACEBOOK_APP_ID,
          cookie: false,
          xfbml: false,
          version: import.meta.env.VITE_FACEBOOK_API_VERSION || 'v25.0',
        });
        setSdkReady((current) => ({ ...current, facebook: true }));
        setSdkErrors((current) => ({ ...current, facebook: '' }));
      })
      .catch(() => {
        if (active) setSdkErrors((current) => ({ ...current, facebook: 'Facebook sign-in could not load.' }));
      });
    return () => {
      active = false;
    };
  }, [authModalOpen, facebookConfigured, sdkRetry]);

  useEffect(() => {
    if (!authModalOpen || !appleConfigured) return undefined;
    let active = true;
    loadScript('apple', 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js')
      .then(() => {
        if (!active || !window.AppleID?.auth) return;
        setSdkReady((current) => ({ ...current, apple: true }));
        setSdkErrors((current) => ({ ...current, apple: '' }));
      })
      .catch(() => {
        if (active) setSdkErrors((current) => ({ ...current, apple: 'Apple sign-in could not load.' }));
      });
    return () => {
      active = false;
    };
  }, [appleConfigured, authModalOpen, sdkRetry]);

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
      await startEmailAuthentication({
        email: email.trim().toLowerCase(),
        name: authIntent === 'signup' ? name.trim() : '',
        intent: authIntent,
      });
    } catch {
      // AuthContext presents the safe server response.
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
      await verifyEmailAuthentication(code);
    } catch {
      // AuthContext presents the safe server response.
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
    } catch {
      // AuthContext presents the safe server response.
    }
  };

  const signInFacebook = async () => {
    if (!window.FB || !sdkReady.facebook) return;
    const flowId = beginProviderFlow('facebook');
    if (!flowId) return;
    try {
      const response = await new Promise((resolve) => {
        window.FB.login(resolve, { scope: 'public_profile,email', return_scopes: true });
      });
      if (flowId !== providerFlowRef.current) return;
      const accessToken = response?.authResponse?.accessToken;
      if (!accessToken) {
        setLocalError('Facebook sign-in was cancelled.');
        return;
      }
      await authenticateFacebook(accessToken);
    } catch {
      // AuthContext presents provider errors.
    } finally {
      finishProviderFlow(flowId);
    }
  };

  const signInApple = async () => {
    if (!window.AppleID?.auth || !sdkReady.apple) return;
    const flowId = beginProviderFlow('apple');
    if (!flowId) return;
    try {
      const nonceChallenge = await prepareAppleAuthentication();
      if (flowId !== providerFlowRef.current) return;
      window.AppleID.auth.init({
        clientId: import.meta.env.VITE_APPLE_CLIENT_ID,
        scope: 'name email',
        redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI,
        nonce: nonceChallenge.nonce,
        usePopup: true,
      });
      const response = await window.AppleID.auth.signIn();
      if (flowId !== providerFlowRef.current) return;
      const idToken = response?.authorization?.id_token;
      if (!idToken) {
        setLocalError('Apple sign-in was cancelled.');
        return;
      }
      const appleName = [response?.user?.name?.firstName, response?.user?.name?.lastName]
        .filter(Boolean)
        .join(' ');
      await authenticateApple({ idToken, nonceId: nonceChallenge.nonceId, name: appleName });
    } catch (error) {
      if (!error?.error || error.error !== 'popup_closed_by_user') {
        setLocalError('Apple sign-in was not completed. Please try again.');
      }
    } finally {
      finishProviderFlow(flowId);
    }
  };

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
          <>
            <div className="auth-modal__brand" aria-hidden="true">
              <span>G</span><i>·</i><span>W</span>
            </div>
            <div className="auth-mode-tabs" role="group" aria-label="Choose account action">
              <button type="button" disabled={uiBusy} aria-pressed={authIntent === 'login'} className={authIntent === 'login' ? 'is-active' : ''} onClick={() => chooseIntent('login')}>Log in</button>
              <button type="button" disabled={uiBusy} aria-pressed={authIntent === 'signup'} className={authIntent === 'signup' ? 'is-active' : ''} onClick={() => chooseIntent('signup')}>Create account</button>
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

            {(authMessage || localError) && <Alert variant="danger" className="soft-alert" role="alert">{authMessage || localError}</Alert>}
            {authStatus.loading && <Alert variant="info" className="soft-alert auth-service-note" role="status"><Spinner size="sm" /> Checking secure sign-in options…</Alert>}
            {(authStatus.error || providerErrors.length > 0) && !authMessage && !localError && (
              <Alert variant="warning" className="soft-alert auth-service-note">
                <Icon name="shield" /> {providerErrors.length
                  ? `${providerErrors.map(([provider]) => provider[0].toUpperCase() + provider.slice(1)).join(', ')} sign-in could not load.`
                  : 'Sign-in availability could not be checked.'}{' '}
                <button type="button" className="plain-link" disabled={uiBusy} onClick={retryProviderSdks}>Retry</button>
              </Alert>
            )}

            <Form className="email-auth-form" onSubmit={submitEmail} noValidate>
              {authIntent === 'signup' && (
                <Form.Group controlId="account-name">
                  <Form.Label>Your name</Form.Label>
                  <Form.Control
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value.slice(0, 100))}
                    autoComplete="name"
                    placeholder="How should we address you?"
                    isInvalid={name.length > 0 && !nameValid}
                    aria-invalid={name.length > 0 && !nameValid}
                    aria-describedby={name.length > 0 && !nameValid ? 'account-name-error' : undefined}
                    disabled={uiBusy}
                  />
                  <Form.Control.Feedback id="account-name-error" type="invalid">Enter at least 2 characters.</Form.Control.Feedback>
                </Form.Group>
              )}
              <Form.Group controlId="account-email">
                <Form.Label>Email address</Form.Label>
                <div className="email-auth-form__field">
                  <Icon name="mail" size={18} />
                  <Form.Control
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                    isInvalid={email.length > 2 && !emailValid}
                    aria-invalid={email.length > 2 && !emailValid}
                    aria-describedby={email.length > 2 && !emailValid ? 'account-email-error' : undefined}
                    disabled={uiBusy}
                  />
                </div>
                {email.length > 2 && !emailValid && <div id="account-email-error" className="invalid-feedback d-block">Enter a valid email address.</div>}
              </Form.Group>
              <Button type="submit" className="button-burgundy auth-email-submit" disabled={uiBusy || authStatus.loading || !providers.email}>
                {authenticating && authMethod === 'email' ? <><Spinner size="sm" /> Sending code…</> : <>Email me a verification code <Icon name="arrow" size={17} /></>}
              </Button>
              {!authStatus.loading && !providers.email && <p className="auth-provider-note">Email verification is awaiting activation by the studio.</p>}
            </Form>

            <div className="auth-divider"><span>or continue with</span></div>

            <div className="social-auth-list" role="group" aria-label="Social sign-in options">
              <div
                className={`social-auth-button social-auth-button--google ${authStatus.loading || !googleConfigured || sdkErrors.google || (uiBusy && providerStarting !== 'google' && authMethod !== 'google') ? 'is-disabled' : ''}`}
                aria-busy={providerStarting === 'google' || authMethod === 'google'}
                aria-disabled={uiBusy || authStatus.loading || !googleConfigured || Boolean(sdkErrors.google)}
                inert={uiBusy ? true : undefined}
              >
                {authStatus.loading
                  ? <><SocialMark provider="google" /><span>Checking Google…</span></>
                  : googleConfigured && !sdkErrors.google
                    ? <div className="google-signin-target" ref={googleButtonRef} />
                    : <><SocialMark provider="google" /><span>Continue with Google</span><small>{sdkErrors.google ? 'Unavailable' : 'Not configured'}</small></>}
                {googleConfigured && !sdkReady.google && !sdkErrors.google && !authStatus.loading && <span className="social-auth-loading" role="status">Preparing Google…</span>}
                {(providerStarting === 'google' || authMethod === 'google') && <span className="social-auth-busy" role="status" aria-label="Signing in with Google"><Spinner size="sm" /></span>}
              </div>
              <button type="button" className="social-auth-button social-auth-button--facebook" onClick={signInFacebook} disabled={uiBusy || authStatus.loading || !facebookConfigured || !sdkReady.facebook}>
                <SocialMark provider="facebook" />
                <span>{authStatus.loading ? 'Checking Facebook…' : 'Continue with Facebook'}</span>
                {!authStatus.loading && (!facebookConfigured || sdkErrors.facebook) && <small>{sdkErrors.facebook ? 'Unavailable' : 'Not configured'}</small>}
                {(providerStarting === 'facebook' || authMethod === 'facebook') && <Spinner size="sm" role="status" aria-label="Signing in with Facebook" />}
              </button>
              <button type="button" className="social-auth-button social-auth-button--apple" onClick={signInApple} disabled={uiBusy || authStatus.loading || !appleConfigured || !sdkReady.apple}>
                <SocialMark provider="apple" />
                <span>{authStatus.loading ? 'Checking Apple…' : 'Continue with Apple'}</span>
                {!authStatus.loading && (!appleConfigured || sdkErrors.apple) && <small>{sdkErrors.apple ? 'Unavailable' : 'Not configured'}</small>}
                {(providerStarting === 'apple' || authMethod === 'apple') && <Spinner size="sm" role="status" aria-label="Signing in with Apple" />}
              </button>
            </div>

            {import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true' && (
              <div className="demo-auth"><span>Local preview only</span><div><button type="button" disabled={uiBusy} onClick={() => authenticateDemo('buyer').catch(() => {})}>Preview buyer</button><button type="button" disabled={uiBusy} onClick={() => authenticateDemo('admin').catch(() => {})}>Preview admin</button></div></div>
            )}
            <p className="privacy-note"><Icon name="lock" size={13} /> Password-free sign-in. We only use verified identity details to secure your account.</p>
          </>
        ) : (
          <Form className="auth-otp auth-otp--email" onSubmit={verifyCode}>
            <div className="auth-modal__mark" aria-hidden="true"><Icon name="mail" size={25} /></div>
            <p className="eyebrow">Check your inbox</p>
            <h2 id="auth-dialog-title">One small code, then you’re in.</h2>
            <p className="muted-copy" id="auth-dialog-description">Enter the 6-digit verification code sent to <strong>{emailChallenge.emailMasked || emailChallenge.email || email}</strong>.</p>
            {(authMessage || localError) && <Alert variant="danger" className="soft-alert" role="alert">{authMessage || localError}</Alert>}
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
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                aria-describedby="email-code-help"
                aria-invalid={code.length > 0 && code.length !== 6}
                disabled={uiBusy}
              />
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
