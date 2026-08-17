import { useState } from 'react';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';
import { useLocation } from 'react-router-dom';
import Icon from './Icon';
import { useAuth } from '../context/AuthContext';
import { useShop } from '../context/ShopContext';

const DISMISSED_KEY = 'gnw-first-offer-dismissed';
const CLAIMED_KEY = 'gnw-first-offer-claimed';
const hasSessionFlag = (key) => {
  try {
    return window.sessionStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
};

export default function OfferPopup() {
  const [dismissed, setDismissed] = useState(() => hasSessionFlag(DISMISSED_KEY));
  const location = useLocation();
  const { authModalOpen, loading: authLoading, user } = useAuth();
  const { notify, welcomeOffer, claimedOfferCode, claimWelcomeOffer } = useShop();
  const popup = welcomeOffer?.popup || welcomeOffer || {};
  const enabled = welcomeOffer?.enabled ?? popup.enabled ?? true;
  const eligible = welcomeOffer?.eligible ?? true;
  const code = String(welcomeOffer?.code || popup.code || 'FIRST10').toUpperCase();
  const percent = Number(welcomeOffer?.percent ?? popup.percent ?? 10);
  const claimed = Boolean(claimedOfferCode || hasSessionFlag(CLAIMED_KEY));
  const suppressed = authModalOpen || location.pathname.startsWith('/admin') || location.pathname.startsWith('/account') || user?.role === 'admin';
  const viewer = welcomeOffer?.viewer;
  const viewerMatches = viewer
    ? String(viewer.id || '') === String(user?.id || '')
    : !authLoading;
  const show = Boolean(
    welcomeOffer && enabled && eligible && viewerMatches && !dismissed && !claimed && !suppressed,
  );

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Local state still keeps the dialog closed for the current page.
    }
    setDismissed(true);
  };

  const claim = async () => {
    claimWelcomeOffer(code);
    if (!navigator.clipboard?.writeText) {
      notify(`Your offer code is ${code}. Eligibility is checked at checkout.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      notify(`Offer code ${code} copied. Eligibility is checked at checkout.`);
    } catch {
      notify(`Your offer code is ${code}. Eligibility is checked at checkout.`);
    }
  };

  return (
    <Modal show={show} onHide={dismiss} centered dialogClassName="offer-dialog" aria-labelledby="first-offer-title">
      <Modal.Body>
        <button type="button" className="icon-button modal-close" onClick={dismiss} aria-label="Dismiss first order offer">
          <Icon name="close" />
        </button>
        <div className="offer-dialog__art" aria-hidden="true">
          <span>{percent}</span><small>% off</small>
        </div>
        <div className="offer-dialog__copy">
          <p className="eyebrow">{popup.eyebrow || 'A little welcome'}</p>
          <h2 id="first-offer-title">{popup.title || 'Make your first keepsake even sweeter.'}</h2>
          <p>{popup.body || `Claim ${percent}% off your first eligible order. Your code stays with you for this visit.`}</p>
          <Button className="button-burgundy w-100" onClick={claim}>Claim my first-order offer</Button>
          <button type="button" className="plain-link" onClick={dismiss}>No thank you, I’ll keep browsing</button>
          <small>One use per customer. Excludes bulk and corporate orders. Final eligibility is confirmed before payment.</small>
        </div>
      </Modal.Body>
    </Modal>
  );
}
