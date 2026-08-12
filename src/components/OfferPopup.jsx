import { useEffect, useState } from 'react';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';
import Icon from './Icon';
import { useShop } from '../context/ShopContext';

const DISMISSED_KEY = 'gnw-first-offer-dismissed';
const CLAIMED_KEY = 'gnw-first-offer-claimed';

export default function OfferPopup() {
  const [show, setShow] = useState(false);
  const { notify, welcomeOffer, claimedOfferCode, claimWelcomeOffer } = useShop();
  const popup = welcomeOffer?.popup || welcomeOffer || {};
  const enabled = welcomeOffer?.enabled ?? popup.enabled ?? true;
  const eligible = welcomeOffer?.eligible ?? true;
  const code = String(welcomeOffer?.code || popup.code || 'FIRST10').toUpperCase();
  const percent = Number(welcomeOffer?.percent ?? popup.percent ?? 10);
  const delaySeconds = Math.max(0, Number(popup.delaySeconds ?? welcomeOffer?.popupDelaySeconds ?? 7.5));
  const claimed = Boolean(claimedOfferCode || window.sessionStorage.getItem(CLAIMED_KEY) === 'true');

  useEffect(() => {
    if (!welcomeOffer || !enabled || !eligible || window.sessionStorage.getItem(DISMISSED_KEY) || claimed) return undefined;
    const timer = window.setTimeout(() => setShow(true), delaySeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [claimed, delaySeconds, eligible, enabled, welcomeOffer]);

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISSED_KEY, 'true');
    setShow(false);
  };

  const claim = async () => {
    claimWelcomeOffer(code);
    try {
      await navigator.clipboard?.writeText(code);
      notify(`Offer code ${code} copied. Eligibility is checked at checkout.`);
    } catch {
      notify(`Your offer code is ${code}. Eligibility is checked at checkout.`);
    }
    setShow(false);
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
