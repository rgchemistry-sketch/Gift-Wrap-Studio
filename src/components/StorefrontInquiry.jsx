import { useEffect, useId, useMemo, useState } from 'react';
import {
  createEmailHref,
  createProductInquiryText,
  createWhatsAppHref,
} from '../utils/inquiry-links';
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
      <span className="product-inquiry__index" aria-hidden="true">ASK</span>
      <div className="product-inquiry__heading">
        <div>
          <p className="eyebrow">A direct studio conversation</p>
          <h2 id={`${fieldId}-title`}>Wondering if it can feel more like yours?</h2>
        </div>
        <span className="product-inquiry__seal" aria-hidden="true">G<span>·</span>W</span>
      </div>
      <p className="product-inquiry__lede">Add your question below. The exact piece and page link will travel with your note, so the studio knows what caught your eye.</p>
      <label className="product-inquiry__label" htmlFor={fieldId}>Your message</label>
      <textarea
        id={fieldId}
        value={message}
        maxLength={600}
        rows={4}
        aria-describedby={`${helpId} ${countId}`}
        onChange={(event) => setMessage(event.target.value)}
      />
      <div className="product-inquiry__field-meta">
        <span id={helpId}>Edit freely before opening your chosen app.</span>
        <span id={countId}>{message.length}/600</span>
      </div>
      <div className="product-inquiry__actions">
        {whatsAppHref ? (
          <a className="product-inquiry__action product-inquiry__action--whatsapp" href={whatsAppHref} target="_blank" rel="noreferrer"><WhatsAppMark /> Ask on WhatsApp <span className="visually-hidden">, opens in a new tab</span></a>
        ) : (
          <span className="product-inquiry__action is-disabled" role="link" aria-disabled="true"><WhatsAppMark /> WhatsApp unavailable</span>
        )}
        {emailHref ? (
          <a className="product-inquiry__action product-inquiry__action--email" href={emailHref}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
            Draft an email
          </a>
        ) : (
          <span className="product-inquiry__action is-disabled" role="link" aria-disabled="true">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
            Email unavailable
          </span>
        )}
      </div>
      <p className="product-inquiry__note">Nothing is sent automatically—you can review the complete message in WhatsApp or email first.</p>
      {!contactAvailable && <p className="product-inquiry__unavailable" role="status">Studio contact links are temporarily unavailable. Please try again later.</p>}
    </section>
  );
}
