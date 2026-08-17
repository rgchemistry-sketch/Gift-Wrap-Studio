import { useCallback, useEffect, useRef } from 'react';
import ToastContainer from 'react-bootstrap/ToastContainer';
import Icon from './Icon';
import { useShop } from '../context/ShopContext';

const toastPresentation = {
  success: {
    icon: 'check',
    label: 'All set',
    delay: 4800,
    live: 'polite',
    role: 'status',
  },
  error: {
    icon: 'close',
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
  const timeoutRef = useRef(null);
  const remainingRef = useRef(presentation.delay);
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
    remainingRef.current = presentation.delay;
    startTimer();
    return () => window.clearTimeout(timeoutRef.current);
  }, [presentation.delay, startTimer]);

  return (
    <div
      className={`studio-toast tone-${tone}`}
      role={presentation.role}
      aria-live={presentation.live}
      aria-atomic="true"
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
        </span>
        <button type="button" onClick={() => dismissToast(toast.id)} aria-label={`Dismiss ${presentation.label.toLowerCase()} notification`}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}

export function ToastStack() {
  const { toasts, dismissToast } = useShop();
  return (
    <ToastContainer position="bottom-end" containerPosition="fixed" className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map((toast) => <StudioToast key={toast.id} toast={toast} dismissToast={dismissToast} />)}
    </ToastContainer>
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
