import { useEffect, useState } from 'react';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';
import Icon from './Icon';
import { useShop } from '../context/ShopContext';

const DISMISSED_KEY = 'gnw-first-offer-dismissed';
const CLAIMED_KEY = 'gnw-first-offer-claimed';
const OFFER_CODE = 'FIRST10';

export default function OfferPopup() {
  const [show, setShow] = useState(false);
  const [claimed, setClaimed] = useState(() => window.sessionStorage.getItem(CLAIMED_KEY) === 'true');
  const { notify } = useShop();

  useEffect(() => {
    if (window.sessionStorage.getItem(DISMISSED_KEY) || claimed) return undefined;
    const timer = window.setTimeout(() => setShow(true), 7500);
    return () => window.clearTimeout(timer);
  }, [claimed]);

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISSED_KEY, 'true');
    setShow(false);
  };

  const claim = async () => {
    window.sessionStorage.setItem(CLAIMED_KEY, 'true');
    setClaimed(true);
    try {
      await navigator.clipboard?.writeText(OFFER_CODE);
      notify(`Offer code ${OFFER_CODE} copied. Eligibility is checked at checkout.`);
    } catch {
      notify(`Your offer code is ${OFFER_CODE}. Eligibility is checked at checkout.`);
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
          <span>10</span><small>% off</small>
        </div>
        <div className="offer-dialog__copy">
          <p className="eyebrow">A little welcome</p>
          <h2 id="first-offer-title">Make your first keepsake even sweeter.</h2>
          <p>Claim 10% off your first eligible order. Your code stays with you for this visit.</p>
          <Button className="button-burgundy w-100" onClick={claim}>Claim my first-order offer</Button>
          <button type="button" className="plain-link" onClick={dismiss}>No thank you, I’ll keep browsing</button>
          <small>One use per customer. Excludes bulk and corporate orders. Final eligibility is confirmed before payment.</small>
        </div>
      </Modal.Body>
    </Modal>
  );
}
