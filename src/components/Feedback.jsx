import Toast from 'react-bootstrap/Toast';
import ToastContainer from 'react-bootstrap/ToastContainer';
import Icon from './Icon';
import { useShop } from '../context/ShopContext';

export function ToastStack() {
  const { toasts, dismissToast } = useShop();
  return (
    <ToastContainer position="bottom-end" className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} onClose={() => dismissToast(toast.id)} delay={4200} autohide className={`studio-toast tone-${toast.tone}`}>
          <Toast.Body>
            <span className="toast-icon"><Icon name={toast.tone === 'success' ? 'check' : 'spark'} size={16} /></span>
            <span>{toast.message}</span>
            <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification"><Icon name="close" size={15} /></button>
          </Toast.Body>
        </Toast>
      ))}
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
