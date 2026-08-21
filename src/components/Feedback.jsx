import { useCallback, useEffect, useRef, useState } from 'react';
import ToastContainer from 'react-bootstrap/ToastContainer';
import Icon from './Icon';
import { useShop } from '../context/ShopContext';
import { isToastActionAvailable } from '../utils/toast-actions';

const toastPresentation = {
  success: {
    icon: 'check',
    label: 'All set',
    delay: 4800,
    live: 'polite',
    role: 'status',
  },
  error: {
    icon: 'alert',
    label: 'Something needs attention',
    delay: 7600,
    live: 'assertive',
    role: 'alert',
  },
  warning: {
    icon: 'shield',
    label: 'Please note',
    delay: 6500,
    live: 'polite',
    role: 'status',
  },
  info: {
    icon: 'spark',
    label: 'Good to know',
    delay: 5600,
    live: 'polite',
    role: 'status',
  },
  neutral: {
    icon: 'spark',
    label: 'Studio update',
    delay: 5200,
    live: 'polite',
    role: 'status',
  },
};

function StudioToast({ toast, dismissToast }) {
  const tone = toastPresentation[toast.tone] ? toast.tone : 'neutral';
  const presentation = toastPresentation[tone];
  const timeoutDuration = Math.max(
    presentation.delay,
    Number(toast.duration) || 0,
    Number(toast.action?.expiresMs) || 0,
  );
  const timeoutRef = useRef(null);
  const remainingRef = useRef(timeoutDuration);
  const startedAtRef = useRef(0);

  const startTimer = useCallback(() => {
    window.clearTimeout(timeoutRef.current);
    startedAtRef.current = Date.now();
    timeoutRef.current = window.setTimeout(() => dismissToast(toast.id), remainingRef.current);
  }, [dismissToast, toast.id]);

  const pauseTimer = () => {
    if (!timeoutRef.current) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
  };

  const resumeTimer = (event) => {
    const toastElement = event.currentTarget;
    if (toastElement.matches(':hover') || toastElement.contains(document.activeElement)) return;
    startTimer();
  };

  useEffect(() => {
    remainingRef.current = timeoutDuration;
    startTimer();
    return () => window.clearTimeout(timeoutRef.current);
  }, [startTimer, timeoutDuration]);

  useEffect(() => {
    const expiresAt = Number(toast.action?.expiresAt);
    if (!Number.isFinite(expiresAt)) return undefined;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      dismissToast(toast.id);
      return undefined;
    }
    const expiryTimer = window.setTimeout(() => dismissToast(toast.id), remaining);
    return () => window.clearTimeout(expiryTimer);
  }, [dismissToast, toast.action?.expiresAt, toast.id]);

  const runAction = () => {
    try {
      if (isToastActionAvailable(toast.action)) toast.action.onClick();
    } finally {
      dismissToast(toast.id);
    }
  };

  return (
    <div
      className={`studio-toast tone-${tone}`}
      role="group"
      aria-label={`${presentation.label}: ${String(toast.message || 'Your request has been updated.')}`}
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
      onFocusCapture={pauseTimer}
      onBlurCapture={resumeTimer}
    >
      <div className="toast-body">
        <span className="toast-icon" aria-hidden="true"><Icon name={presentation.icon} size={16} /></span>
        <span className="toast-copy">
          <strong>{presentation.label}</strong>
          <span>{String(toast.message || 'Your request has been updated.')}</span>
          {toast.action?.label && typeof toast.action.onClick === 'function' && (
            <button type="button" className="studio-toast__action" onClick={runAction}>
              {toast.action.label}
            </button>
          )}
        </span>
        <button type="button" onClick={() => dismissToast(toast.id)} aria-label={`Dismiss ${presentation.label.toLowerCase()} notification`}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}

export function ToastStack({ aboveBuyBar = false }) {
  const { toasts, dismissToast } = useShop();
  const lastAnnouncedRef = useRef(null);
  const [announcement, setAnnouncement] = useState({ text: '', tone: 'neutral' });

  useEffect(() => {
    const newest = toasts.at(-1);
    if (!newest || newest.id === lastAnnouncedRef.current) return undefined;
    const tone = toastPresentation[newest.tone] ? newest.tone : 'neutral';
    setAnnouncement((current) => ({ ...current, text: '' }));
    const timer = window.setTimeout(() => {
      lastAnnouncedRef.current = newest.id;
      setAnnouncement({
        text: `${toastPresentation[tone].label}: ${String(newest.message || 'Your request has been updated.')}`,
        tone,
      });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  return (
    <>
      <p
        className="visually-hidden"
        role={announcement.tone === 'error' ? 'alert' : 'status'}
        aria-live={announcement.tone === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
      >
        {announcement.text}
      </p>
      <ToastContainer position="bottom-end" containerPosition="fixed" className={`toast-stack ${aboveBuyBar ? 'toast-stack--above-buy-bar' : ''}`} role="region" aria-label="Notifications">
        {toasts.map((toast) => <StudioToast key={toast.id} toast={toast} dismissToast={dismissToast} />)}
      </ToastContainer>
    </>
  );
}

export function RouteLoader() {
  return (
    <div className="route-loader" role="status" aria-label="Loading page">
      <span /><span /><span />
    </div>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="product-skeleton" aria-hidden="true">
      <div className="skeleton skeleton-image" />
      <div className="skeleton skeleton-line short" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line medium" />
    </div>
  );
}
