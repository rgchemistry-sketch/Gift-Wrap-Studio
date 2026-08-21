import { Link } from 'react-router-dom';
import Container from 'react-bootstrap/Container';
import Icon from '../components/Icon';
import { useShop } from '../context/ShopContext';
import { formatCurrency } from '../data/catalog';
import { DEFAULT_STUDIO_CONTACT, formatPhoneLabel, resolveStudioContact } from '../utils/studio-contact';
import '../legal.css';

const EFFECTIVE_DATE = '21 August 2026';
const STUDIO_ADDRESS = 'Rose County, Kunal Icon Road, Roseland Residency, Pimple Saudagar, Pimpri-Chinchwad, Maharashtra 411027, India';
const MAPS_URL = 'https://maps.app.goo.gl/Tfcr1XpcvsaZqgJ28?g_st=iw';

const supportLink = (contact) => contact.email
  ? <a href={`mailto:${contact.email}`}>{contact.email}</a>
  : <Link to="/contact">the contact page</Link>;

const documentFor = (type, { contact, settings }) => {
  const readyTime = settings?.leadTimes?.ready || '3–10 business days';
  const customTime = settings?.leadTimes?.custom || '5–15 business days';
  const flatShipping = Number(settings?.shipping?.flatFee);
  const freeThreshold = Number(settings?.shipping?.freeThreshold);
  const shippingSummary = Number.isFinite(flatShipping) && Number.isFinite(freeThreshold)
    ? <>Current standard configuration is {formatCurrency(flatShipping)}, with free standard shipping from {formatCurrency(freeThreshold)} when that offer applies. The amount confirmed before payment controls.</>
    : <>The applicable delivery fee is displayed or confirmed before payment.</>;

  const sharedContact = <>
    <p><strong>Trading name:</strong> Gift N Wrap Studio</p>
    <p><strong>Business address:</strong> {STUDIO_ADDRESS}</p>
    <p><strong>Customer support:</strong> {supportLink(contact)}{contact.phoneHref && <> · <a href={contact.phoneHref}>{contact.phoneLabel}</a></>}</p>
    <p><strong>Grievance Officer:</strong> Proprietor, Gift N Wrap Studio, reachable through the customer-support details above.</p>
  </>;

  const documents = {
    terms: {
      eyebrow: 'The agreement behind every piece',
      title: 'Terms & Conditions',
      summary: 'The practical rules for browsing, ordering, personalizing, paying for and receiving work from Gift N Wrap Studio.',
      sections: [
        ['about', '1. About us and these terms', <>
          <p>These Terms & Conditions govern use of giftnwrapstudio.com and purchases or order requests made with Gift N Wrap Studio. By creating an account, sending an order request, approving a custom design or placing a paid order, you agree to the version displayed at that time.</p>
          {sharedContact}
          <p>If you do not agree, please do not submit an order or proceed to payment. Mandatory rights available under Indian consumer law are not restricted by these terms.</p>
        </>],
        ['products', '2. Handmade products and personalization', <>
          <p>Every resin piece is handmade. Small variations in colour, placement, bubbles, botanical material and finish are natural characteristics, not defects, provided the product remains consistent with its description and any approved design.</p>
          <p>Product photographs are illustrative. Screen settings can affect colour. For custom work, the written quotation and approved concept define the agreed dimensions, materials, personalization, quantity, price and timing. You are responsible for checking names, dates, spellings and files before approval.</p>
          <p>You must have permission to submit any photograph, logo, artwork or personal information used in a design. We may decline unlawful, infringing, unsafe or technically unsuitable material.</p>
        </>],
        ['orders-pricing', '3. Orders, quotations and pricing', <>
          <p>Submitting the current website form creates an order request, not an accepted sale, and no payment is taken on that form. An order becomes accepted when we confirm availability, personalization, final charges and payment, or otherwise expressly confirm acceptance.</p>
          <p>Prices are shown in Indian Rupees. Before payment, we disclose the product price, discount, tax, shipping, handling and any other compulsory or optional charge that applies. A custom quotation states its validity period. A later scope or price change requires your approval before an additional payment is collected.</p>
          <p>We may correct an obvious pricing or stock error before accepting the order. If payment was already taken for an order we cannot fulfil, we will cancel it and issue a full refund to the original payment method.</p>
        </>],
        ['payments', '4. Razorpay and payment processing', <>
          <p>Where online payment is offered, it is processed securely by Razorpay Payments Private Limited and its banking, card-network, UPI and other facility-provider partners. Razorpay is a payment service provider; it does not sell, make, endorse or guarantee our products.</p>
          <p>By affirmatively proceeding to payment, you consent to the sharing of personal and transaction information reasonably necessary to process, verify, reconcile, track, refund and protect the transaction with Razorpay, its group entities, facility providers, banks, card networks and competent regulatory or governmental authorities, as described in our <Link to="/privacy-policy">Privacy Policy</Link>.</p>
          <p>We do not collect or store your complete card number, CVV, UPI PIN, net-banking password or other payment-instrument credentials. Do not send such credentials to us by message, email or upload.</p>
        </>],
        ['fulfilment', '5. Fulfilment and delivery', <>
          <p>Processing estimates begin after required details, design approval and payment are complete. Ready or small-batch pieces are normally processed in {readyTime}; custom pieces in {customTime}. These are estimates, not guaranteed event-date commitments unless we confirm one in writing.</p>
          <p>Delivery coverage, fees, tracking, address responsibilities and delay handling are described in our <Link to="/shipping-policy">Shipping & Delivery Policy</Link>.</p>
        </>],
        ['changes-cancellations', '6. Changes, cancellations, returns and refunds', <>
          <p>Ready-to-ship orders may generally be cancelled before dispatch. Custom or personalized work may generally be cancelled before final design approval or production begins. Once personalized production begins, change-of-mind cancellation or return may be unavailable because the item is made to your specifications.</p>
          <p>This does not remove remedies for damaged, defective, deficient, spurious, incorrectly supplied, materially mismatched or unlawfully delayed goods. Full eligibility, evidence, timelines and original-source refund rules appear in our <Link to="/cancellation-and-refund-policy">Cancellation & Refund Policy</Link>.</p>
        </>],
        ['accounts', '7. Accounts and acceptable use', <>
          <p>Keep access to your verified email and device secure. You may not misuse the website, attempt unauthorized access, interfere with availability, upload malware, scrape protected data or use the service for unlawful activity. We may suspend access where reasonably necessary to protect customers, the studio or the service.</p>
        </>],
        ['intellectual-property', '8. Intellectual property', <>
          <p>The site design, product photography, original artwork, copy and brand materials belong to Gift N Wrap Studio or their respective licensors. Purchasing a product does not transfer reproduction or commercial-use rights. Your rights in material you submit remain yours; you grant us a limited licence to use it only to quote, design, produce, deliver and support your order.</p>
        </>],
        ['liability', '9. Responsibility and events outside control', <>
          <p>Nothing here excludes liability that cannot lawfully be excluded. Subject to those rights, we are responsible for the products we sell and will use reasonable care in production, packaging, support and delivery coordination.</p>
          <p>Events outside reasonable control—such as severe weather, transport disruption, government action, network outage or material shortage—may change an estimate. We will communicate a revised plan and the remedies reasonably available rather than treating handover to a courier as the end of our responsibility.</p>
        </>],
        ['law-contact', '10. Governing law, complaints and contact', <>
          <p>These terms are governed by Indian law. Courts and consumer forums with lawful jurisdiction remain available. We acknowledge consumer complaints within 48 hours, aim to resolve payment or transaction queries within four business days, and aim to resolve other consumer grievances within one month after receiving the information reasonably needed to investigate.</p>
          {sharedContact}
        </>],
      ],
    },
    privacy: {
      eyebrow: 'Personal details, treated personally',
      title: 'Privacy Policy',
      summary: 'What we collect, why we need it, who helps us process it and the choices you retain.',
      sections: [
        ['scope', '1. Scope and responsible business', <>
          <p>This policy explains how Gift N Wrap Studio handles personal information through the website, customer accounts, enquiries, orders, custom-design conversations, delivery, support and payment processing.</p>
          {sharedContact}
        </>],
        ['collection', '2. Information we collect', <>
          <ul>
            <li><strong>Identity and contact:</strong> name, verified email, mobile number and account-provider identifiers.</li>
            <li><strong>Order and delivery:</strong> billing or delivery address, products, personalization, quotations, dates, messages, support history and delivery evidence.</li>
            <li><strong>Creative material:</strong> photographs, logos, names, dates, reference links and files you choose to submit for a product or enquiry.</li>
            <li><strong>Payment records:</strong> amount, currency, order ID, payment status, Razorpay reference, refund reference and fraud or dispute signals. We do not store complete card details, CVV, UPI PIN or payment passwords.</li>
            <li><strong>Technical data:</strong> IP address, browser or device information, security logs, cookie or local-storage choices and interaction data reasonably needed to operate and protect the service.</li>
          </ul>
        </>],
        ['purpose', '3. Why we use it', <>
          <p>We use this information to create and secure accounts; answer enquiries; quote, personalize, produce and deliver orders; process payments and refunds; provide status updates and support; prevent fraud; maintain accounting and transaction records; improve reliability; comply with law; and establish or defend legal claims.</p>
          <p>Marketing messages are optional and require a separate choice where offered. Service, security, order and payment messages are not marketing.</p>
        </>],
        ['razorpay', '4. Razorpay and payment consent', <>
          <p>When you choose online payment, we share only the personal and transaction information reasonably necessary for Razorpay, its group entities, facility providers, banks and payment networks to process and reconcile payment, prevent fraud, issue refunds, investigate disputes and meet legal or regulatory duties.</p>
          <p>Razorpay processes information under its own <a href="https://razorpay.com/privacy-policy/" target="_blank" rel="noreferrer">Privacy Policy</a>. Withdrawing consent may prevent completion of a service that necessarily requires payment processing, but it does not affect processing already lawfully completed.</p>
          <p>Never send us full card numbers, CVV, UPI PINs, banking passwords or one-time payment codes. Razorpay’s hosted payment interface collects payment credentials directly where applicable.</p>
        </>],
        ['sharing', '5. Who receives information', <>
          <p>We disclose information only as reasonably necessary to Razorpay and payment partners; couriers and logistics providers; cloud hosting, image storage, authentication and email providers; professional advisers; fraud-prevention services; and regulators, courts or law-enforcement authorities where lawfully required.</p>
          <p>We do not sell payment information or customer-uploaded photographs. Providers may use information only for their contracted service and applicable legal obligations.</p>
        </>],
        ['retention', '6. Retention and deletion', <>
          <p>Transaction and order records may be retained for up to ten years to meet payment, accounting, tax, audit, chargeback and merchant-record obligations. Other information is kept only while needed for the purpose described, a live account, support, fraud prevention or a legal requirement.</p>
          <p>Customization files and photographs are access-restricted and should be removed or anonymised after fulfilment and the reasonable support or dispute period, subject to configured storage-provider retention and legal holds. Expired unused uploads are scheduled for secure deletion.</p>
        </>],
        ['cookies', '7. Cookies and device storage', <>
          <p>We use essential cookies for secure sign-in and fraud protection. The browser may also store your bag, wishlist, form drafts, offer acknowledgement and interface preferences on your device. Clearing browser storage may remove those local drafts.</p>
          <p>If optional analytics or advertising tools are introduced, this policy and the consent interface will be updated before non-essential tracking is enabled.</p>
        </>],
        ['reviews', '8. Customer reviews and external services', <>
          <p>After a purchase is marked delivered, a signed-in customer may publish a 1–5 star rating and written review. The homepage may display that rating, review, a privacy-safe customer name, the reviewed product and the review date. Email addresses, delivery addresses, payment details and order references are never published with a review.</p>
          <p>Customers may edit their own review from their account. Links to Instagram, Razorpay, couriers or other third-party services take you to their independent sites and policies.</p>
        </>],
        ['security', '9. Security practices', <>
          <p>We use HTTPS, access controls, administrator allowlisting, signed sessions, restricted provider credentials, validation, rate limits, logging, backups and encryption where appropriate. No internet service can guarantee absolute security, so we also limit collection and access.</p>
        </>],
        ['choices', '10. Your choices and requests', <>
          <p>You may ask to access or correct your account and order contact information, withdraw a consent that is not required to complete an existing obligation, object to optional marketing, or request deletion where retention is no longer legally or operationally required.</p>
          <p>Send a clear request through {supportLink(contact)}. We may verify identity before acting. A withdrawal does not invalidate earlier lawful processing and may mean we cannot continue a service that needs the information.</p>
        </>],
        ['changes-contact', '11. Changes and grievances', <>
          <p>Material changes will be posted here with a revised effective date and, where appropriate, a notice or fresh consent. Privacy questions and grievances may be sent to the Grievance Officer using the details below.</p>
          {sharedContact}
        </>],
      ],
    },
    refunds: {
      eyebrow: 'Clear outcomes when plans change',
      title: 'Cancellation & Refund Policy',
      summary: 'When an order can be changed or cancelled, what qualifies for a return, and how payment is sent back.',
      sections: [
        ['request-stage', '1. Order requests and unpaid quotations', <>
          <p>The current checkout form sends an order request only. You can withdraw an unpaid request at any time by contacting us. No refund is needed where no payment was taken.</p>
        </>],
        ['cancellation', '2. Cancellation before dispatch or production', <>
          <p>A ready-to-ship order may be cancelled until dispatch. A custom or personalized order may be cancelled until final design approval or production begins. We do not charge a separate cancellation fee.</p>
          <p>After personalized production begins, a change-of-mind cancellation or return may be unavailable because materials and work have been committed to your specifications. If we cannot fulfil an accepted order, we will cancel it and issue a full refund.</p>
        </>],
        ['eligible-issues', '3. Damage, defect, mismatch or incorrect supply', <>
          <p>The custom-order restriction does not remove remedies where an item arrives damaged or defective, is materially different from its description or approved design, is incorrectly supplied, is spurious or deficient, or is delivered after the agreed schedule for reasons other than force majeure.</p>
          <p>Contact us promptly with the order number and a description of the issue. Photographs and an unboxing video can help a courier or production investigation, but their absence by itself does not remove statutory consumer rights.</p>
        </>],
        ['returns', '4. Return assessment', <>
          <p>Do not send an item back before receiving return instructions. For an eligible issue caused by damage, defect, incorrect supply or material non-conformity, we bear reasonable return-shipping costs and offer an appropriate repair, replacement, re-delivery or refund.</p>
          <p>If we voluntarily approve another type of return, we will confirm in writing the return address, packaging standard, inspection process and who bears shipping before you send it.</p>
        </>],
        ['refunds', '5. Refund method and timing', <>
          <p>Approved refunds are initiated within seven business days after approval or receipt and inspection of the returned item, as applicable. Online-payment refunds are sent only to the original payment method where technically supported; cash refunds or transfers to unrelated accounts are not offered.</p>
          <p>After initiation, Razorpay and the customer’s bank generally require approximately 5–7 working days to credit the original method. Bank processing is outside our direct control, but we provide the available refund reference.</p>
        </>],
        ['payment-problems', '6. Failed, duplicate or disputed payments', <>
          <p>If a payment fails but your account is debited, first allow the bank or payment network’s reversal window. For a duplicate, unlinked or unresolved transaction, send the payment reference, amount, date and order or account email—never send card credentials, CVV, UPI PIN or an OTP.</p>
          <p>We acknowledge complaints within 48 hours and aim to resolve payment or transaction queries within four business days after receiving the information reasonably required to investigate. Chargeback and consumer-law rights remain available.</p>
        </>],
        ['contact', '7. How to request help', <>
          <p>Contact {supportLink(contact)}{contact.phoneHref && <> or <a href={contact.phoneHref}>{contact.phoneLabel}</a></>} with your order number and requested outcome. We will provide a traceable response through your verified account or contact channel.</p>
          {sharedContact}
        </>],
      ],
    },
    shipping: {
      eyebrow: 'From the studio table to your doorstep',
      title: 'Shipping & Delivery Policy',
      summary: 'Processing estimates, delivery charges, tracking, address changes and what happens if a parcel is delayed or damaged.',
      sections: [
        ['coverage', '1. Service area and address', <>
          <p>We offer delivery to serviceable PIN codes across India. You must provide a complete deliverable address and mobile number. Please report an error before dispatch; a carrier may charge for re-routing or re-delivery after dispatch, and we will disclose any such charge before collecting it.</p>
        </>],
        ['processing', '2. Processing before dispatch', <>
          <p>Ready and small-batch pieces are normally processed in {readyTime}. Custom pieces are normally processed in {customTime} after final design approval, receipt of required files and payment. Bulk or unusually complex work follows the written quotation.</p>
          <p>Processing time is separate from carrier transit time. If an event date is essential, wait for written feasibility confirmation before paying.</p>
        </>],
        ['charges', '3. Shipping charges and order total', <>
          <p>{shippingSummary} Custom, fragile, remote-area or bulk shipments may require a separately disclosed quote. No undisclosed compulsory delivery charge is added after order confirmation.</p>
        </>],
        ['transit', '4. Dispatch, transit and tracking', <>
          <p>We choose a serviceable carrier and send tracking details when available. The delivery estimate is shown or confirmed before purchase and may vary by destination, item, carrier and public holidays.</p>
          <p>A tracking scan can take time to appear after handover. Contact us if the parcel stops moving, is marked delivered but missing, or passes the confirmed delivery window.</p>
        </>],
        ['delays', '5. Delays and events outside control', <>
          <p>Severe weather, transport disruption, government action, network outages, strikes and other force-majeure events may affect delivery. We will communicate a revised estimate and available choices. We do not treat courier handover as the end of our responsibility for the sale.</p>
        </>],
        ['damage-loss', '6. Damage, loss and incorrect delivery', <>
          <p>Keep the packaging and contact us promptly if a parcel is materially damaged, lost or incorrectly delivered. Photographs or an unboxing video help investigation but are not the sole basis of statutory rights.</p>
          <p>After investigation, we arrange an appropriate replacement, re-delivery, repair or refund under the <Link to="/cancellation-and-refund-policy">Cancellation & Refund Policy</Link>. We bear reasonable return or re-delivery costs when the issue is ours or the carrier’s.</p>
        </>],
        ['contact', '7. Delivery support', <>
          <p>Send the order number and tracking number through {supportLink(contact)}{contact.phoneHref && <> or call <a href={contact.phoneHref}>{contact.phoneLabel}</a></>}. For the studio address, <a href={MAPS_URL} target="_blank" rel="noreferrer">open Google Maps</a>.</p>
          {sharedContact}
        </>],
      ],
    },
  };
  return documents[type];
};

function PolicyPage({ type }) {
  const { studioSettings } = useShop();
  const configuredContact = resolveStudioContact(studioSettings);
  const compliancePhone = configuredContact.phone || DEFAULT_STUDIO_CONTACT.phone;
  const contact = {
    ...configuredContact,
    email: configuredContact.email || DEFAULT_STUDIO_CONTACT.email,
    phone: compliancePhone,
    phoneHref: configuredContact.phoneHref || `tel:${compliancePhone}`,
    phoneLabel: configuredContact.phoneLabel || formatPhoneLabel(compliancePhone),
  };
  const document = documentFor(type, { contact, settings: studioSettings });

  return (
    <article className="legal-page">
      <header className="legal-hero">
        <Container fluid="xl">
          <p className="eyebrow">{document.eyebrow}</p>
          <h1>{document.title}</h1>
          <p>{document.summary}</p>
          <div><span>Effective {EFFECTIVE_DATE}</span><span>Gift N Wrap Studio · India</span></div>
        </Container>
      </header>

      <Container fluid="xl" className="legal-layout">
        <aside>
          <p className="eyebrow">In this policy</p>
          <nav aria-label={`${document.title} contents`}>
            {document.sections.map(([id, title]) => <a href={`#${id}`} key={id}>{title.replace(/^\d+\.\s*/, '')}</a>)}
          </nav>
          <div className="legal-help-card">
            <Icon name="mail" size={19} />
            <p><strong>Need a plain-language answer?</strong><span>Tell us the order or policy detail you are unsure about.</span></p>
            <Link to="/contact">Contact the studio <Icon name="arrow" size={14} /></Link>
          </div>
        </aside>

        <div className="legal-document">
          <div className="legal-document__notice"><Icon name="shield" size={18} /><p><strong>Designed for informed consent.</strong><span>Please read this policy before approval or payment. Linked policies form part of the same customer agreement.</span></p></div>
          {document.sections.map(([id, title, content]) => (
            <section id={id} key={id}>
              <h2>{title}</h2>
              {content}
            </section>
          ))}
          <footer>
            <span>Last updated {EFFECTIVE_DATE}</span>
            <Link to="/contact">Ask a question <Icon name="arrow" size={15} /></Link>
          </footer>
        </div>
      </Container>
    </article>
  );
}

export const TermsPage = () => <PolicyPage type="terms" />;
export const PrivacyPage = () => <PolicyPage type="privacy" />;
export const RefundPolicyPage = () => <PolicyPage type="refunds" />;
export const ShippingPolicyPage = () => <PolicyPage type="shipping" />;
