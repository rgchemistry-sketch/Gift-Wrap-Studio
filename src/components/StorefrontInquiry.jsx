import { useEffect, useId, useMemo, useState } from 'react';
import {
  createEmailHref,
  createProductInquiryText,
  createWhatsAppHref,
} from '../utils/inquiry-links';
import Icon from './Icon';
import '../storefront-inquiry.css';

const GENERAL_WHATSAPP_MESSAGE = 'Hello Gift N Wrap Studio, I’d love help choosing a handmade resin piece.';

const defaultProductMessage = (product) => (
  `Hello Gift N Wrap Studio, I’m interested in ${product.title}. `
  + `${product.customizable ? 'Could you help me understand the personalization options and availability?' : 'Could you tell me more about its availability and delivery?'}`
);

function WhatsAppMark() {
  return (
    <svg className="whatsapp-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 11.6a8 8 0 0 1-11.8 7L4 20l1.4-4A8 8 0 1 1 20 11.6Z" />
      <path d="M8.2 7.8c.3-.3.7-.2.9.1l1 1.8c.1.3.1.6-.1.8l-.7.7c.7 1.5 1.8 2.6 3.4 3.3l.7-.8c.2-.2.5-.3.8-.1l1.8.9c.3.2.5.6.3.9-.5 1-1.4 1.5-2.5 1.4-3.7-.5-6.7-3.4-7.1-7.1-.1-.8.5-1.5 1.5-1.9Z" />
    </svg>
  );
}

export function FloatingWhatsAppButton({ phone }) {
  const href = createWhatsAppHref(phone, GENERAL_WHATSAPP_MESSAGE);

  if (!href) return null;

  return (
    <a className="storefront-whatsapp-float" href={href} target="_blank" rel="noreferrer" aria-label="WhatsApp — ask the studio (opens in a new tab)">
      <span className="storefront-whatsapp-float__mark"><WhatsAppMark /></span>
      <span className="storefront-whatsapp-float__copy"><strong>WhatsApp</strong><small>Ask the studio</small></span>
      <span className="visually-hidden">, opens in a new tab</span>
    </a>
  );
}

export function ProductInquiryPanel({ product, productUrl, contact }) {
  const { id: productId, slug, title, customizable } = product;
  const fieldId = useId();
  const helpId = `${fieldId}-help`;
  const countId = `${fieldId}-count`;
  const [message, setMessage] = useState(() => defaultProductMessage(product));

  useEffect(() => {
    setMessage(defaultProductMessage({ title, customizable }));
  }, [productId, slug, title, customizable]);

  const inquiryText = useMemo(() => createProductInquiryText({
    message,
    productTitle: title,
    productUrl,
  }), [message, title, productUrl]);
  const whatsAppHref = createWhatsAppHref(contact.phone, inquiryText);
  const emailHref = createEmailHref(contact.email, {
    subject: `Product inquiry · ${title}`,
    body: inquiryText,
  });
  const contactAvailable = Boolean(whatsAppHref || emailHref);

  return (
    <section className="product-inquiry" aria-labelledby={`${fieldId}-title`}>
      <header className="product-inquiry__intro">
        <div className="product-inquiry__kicker">
          <span aria-hidden="true"><Icon name="spark" size={16} /></span>
          <p className="eyebrow">Ask the studio</p>
        </div>
        <h2 id={`${fieldId}-title`}>{customizable ? 'Could this piece be made more personal?' : 'Need help with availability or delivery?'}</h2>
        <p className="product-inquiry__lede">Write your question once, then continue by WhatsApp or email. We’ll include this piece and its page link for context.</p>
      </header>
      <div className="product-inquiry__editor">
        <div className="product-inquiry__label-row">
          <label className="product-inquiry__label" htmlFor={fieldId}>Your message</label>
          <span id={countId}>{message.length}/600</span>
        </div>
        <textarea
          id={fieldId}
          value={message}
          maxLength={600}
          rows={4}
          aria-describedby={`${helpId} ${countId}`}
          onChange={(event) => setMessage(event.target.value)}
        />
        <p className="product-inquiry__field-help" id={helpId}>You can edit the draft before anything opens or is sent.</p>
      </div>
      <div className="product-inquiry__actions">
        {whatsAppHref ? (
          <a className="product-inquiry__action product-inquiry__action--whatsapp" href={whatsAppHref} target="_blank" rel="noreferrer">
            <WhatsAppMark />
            <span><strong>Continue on WhatsApp</strong><small>Opens with your draft</small></span>
            <span className="visually-hidden">, opens in a new tab</span>
          </a>
        ) : (
          <span className="product-inquiry__action is-disabled" role="link" aria-disabled="true"><WhatsAppMark /> WhatsApp unavailable</span>
        )}
        {emailHref ? (
          <a className="product-inquiry__action product-inquiry__action--email" href={emailHref}>
            <Icon name="mail" />
            <span><strong>Continue by email</strong><small>Opens a ready-to-send email</small></span>
          </a>
        ) : (
          <span className="product-inquiry__action is-disabled" role="link" aria-disabled="true">
            <Icon name="mail" />
            Email unavailable
          </span>
        )}
      </div>
      {!contactAvailable && <p className="product-inquiry__unavailable" role="status">Studio contact links are temporarily unavailable. Please try again later.</p>}
    </section>
  );
}
