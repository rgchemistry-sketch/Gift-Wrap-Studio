import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Icon from '../Icon';
import { api } from '../../api/client';
import AdminSectionState from './AdminSectionState';
import {
  FACEBOOK_PROFILE_MESSAGE,
  INSTAGRAM_PROFILE_MESSAGE,
  normalizeFacebookProfile,
  normalizeInstagramProfile,
} from '../../../shared/social-profiles.js';

const defaults = {
  leadTimes: { ready: '3–10 business days', custom: '5–15 business days' },
  offer: {
    enabled: true,
    eyebrow: 'A little welcome gift',
    title: 'Make your first story together.',
    body: 'Enjoy a thoughtful saving on your first Gift N Wrap Studio order.',
    code: 'FIRST10',
    percent: 10,
    maxDiscount: 500,
    delaySeconds: 5,
  },
  shipping: { flatFee: 99, freeThreshold: 2000, bulkThreshold: 10 },
  announcement: { enabled: true, text: 'Every piece handmade with care', linkLabel: 'PAN India delivery', linkUrl: '/shop' },
  contact: {
    email: 'info@giftnwrapstudio.com',
    phone: '+919588281126',
    instagram: '@giftnwrapstudio',
    facebook: '',
  },
};

const mergeSettings = (value = {}) => ({
  ...defaults,
  ...value,
  leadTimes: { ...defaults.leadTimes, ...(value.leadTimes || {}) },
  offer: { ...defaults.offer, ...(value.offer || value.welcomeOffer || {}) },
  shipping: { ...defaults.shipping, ...(value.shipping || {}) },
  announcement: { ...defaults.announcement, ...(value.announcement || {}) },
  contact: { ...defaults.contact, ...(value.contact || {}) },
});

const numericDraftValue = (event) => event.target.value === '' ? '' : Number(event.target.value);
const numericPayloadValue = (value) => Number(value);
const normalizeAnnouncementLink = (input) => {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

export default function SettingsEditor({ preview = false, notify }) {
  const [saved, setSaved] = useState(defaults);
  const [draft, setDraft] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [draft, saved]);
  const instagramPreview = useMemo(
    () => normalizeInstagramProfile(draft.contact.instagram),
    [draft.contact.instagram],
  );
  const facebookPreview = useMemo(
    () => normalizeFacebookProfile(draft.contact.facebook),
    [draft.contact.facebook],
  );
  const announcementLinkPreview = useMemo(
    () => normalizeAnnouncementLink(draft.announcement.linkUrl),
    [draft.announcement.linkUrl],
  );
  const instagramError = draft.contact.instagram.trim() && !instagramPreview
    ? INSTAGRAM_PROFILE_MESSAGE
    : '';
  const facebookError = draft.contact.facebook.trim() && !facebookPreview
    ? FACEBOOK_PROFILE_MESSAGE
    : '';
  const announcementLinkError = draft.announcement.linkUrl.trim() && announcementLinkPreview === null
    ? 'Enter an HTTPS URL or a site path beginning with /'
    : '';
  const hasFieldErrors = Boolean(instagramError || facebookError || announcementLinkError);

  const loadSettings = useCallback(async () => {
    setLoading(true); setLoaded(false); setError('');
    try {
      const result = await api.getAdminSettings();
      const value = mergeSettings(result.settings || result.data?.settings || result.data || result);
      setSaved(value); setDraft(value); setLoaded(true);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  useEffect(() => {
    if (!dirty || saving) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty, saving]);

  const update = (group, name, value) => setDraft((current) => ({
    ...current,
    [group]: { ...current[group], [name]: value },
  }));

  const save = async (event) => {
    event.preventDefault();
    if (hasFieldErrors) {
      setError('Check the highlighted links before publishing.');
      return;
    }
    setSaving(true); setError('');
    try {
      const payload = {
        leadTimes: { ready: draft.leadTimes.ready, custom: draft.leadTimes.custom },
        offer: {
          enabled: draft.offer.enabled,
          eyebrow: draft.offer.eyebrow,
          title: draft.offer.title,
          body: draft.offer.body,
          code: draft.offer.code,
          percent: numericPayloadValue(draft.offer.percent),
          maxDiscount: numericPayloadValue(draft.offer.maxDiscount),
          delaySeconds: numericPayloadValue(draft.offer.delaySeconds),
        },
        shipping: {
          flatFee: numericPayloadValue(draft.shipping.flatFee),
          freeThreshold: numericPayloadValue(draft.shipping.freeThreshold),
          bulkThreshold: numericPayloadValue(draft.shipping.bulkThreshold),
        },
        announcement: {
          enabled: draft.announcement.enabled,
          text: draft.announcement.text,
          linkLabel: draft.announcement.linkLabel,
          linkUrl: draft.announcement.linkUrl,
        },
        contact: {
          email: draft.contact.email,
          phone: draft.contact.phone,
          instagram: draft.contact.instagram,
          facebook: draft.contact.facebook,
        },
      };
      const result = await api.updateAdminSettings(payload);
      const next = mergeSettings(result.settings || result.data?.settings || result.data || draft);
      setSaved(next); setDraft(next); notify('Studio settings are live.');
    } catch (requestError) { setError(requestError.message); notify(requestError.message, 'error'); }
    finally { setSaving(false); }
  };

  if (loading) return <AdminSectionState loading title="Opening studio settings" message="Gathering your current storefront controls…"/>;
  if (!loaded) return <AdminSectionState title="Settings could not load" message={error || 'The studio settings service did not return a usable response.'} actionLabel="Try again" onAction={loadSettings}/>;

  return <Form className="settings-editor" onSubmit={save}>
    <div className="admin-section-head settings-editor__head"><div><p className="eyebrow">Studio controls</p><h2>Settings</h2><p className="admin-section-copy">Offers, service details and shop messages — without touching code.</p></div><div className="settings-editor__actions"><span className={dirty ? 'is-dirty' : ''}>{dirty ? 'Unsaved changes' : 'Everything saved'}</span><Button type="button" variant="outline-dark" disabled={!dirty || saving} onClick={() => { setDraft(saved); setError(''); }}>Discard</Button><Button type="submit" variant="dark" disabled={!dirty || saving || preview || hasFieldErrors}>{saving && <Spinner animation="border" size="sm"/>}{saving ? 'Publishing…' : 'Save & publish'}</Button></div></div>
    {error && <Alert variant="danger" className="soft-alert">{error}</Alert>}
    {preview && <Alert variant="warning" className="soft-alert">Settings cannot be changed while preview data is active.</Alert>}

    <fieldset className="settings-editor__fieldset" disabled={saving || preview}>
    <div className="settings-editor__layout">
      <div className="settings-editor__forms">
        <section className="admin-panel setting-card">
          <div className="setting-card__head"><span><Icon name="spark"/></span><div><p className="eyebrow">Storefront moment</p><h3>Welcome offer popup</h3><p>Control the first message new customers see.</p></div><Form.Check type="switch" id="offer-enabled" label={draft.offer.enabled ? 'Live' : 'Hidden'} checked={draft.offer.enabled} onChange={(event) => update('offer', 'enabled', event.target.checked)}/></div>
          <div className="admin-setting-row"><Form.Group controlId="offer-eyebrow"><Form.Label>Eyebrow</Form.Label><Form.Control maxLength={80} value={draft.offer.eyebrow} onChange={(event) => update('offer', 'eyebrow', event.target.value)}/></Form.Group><Form.Group controlId="offer-delay"><Form.Label>Popup delay (seconds)</Form.Label><Form.Control required type="number" min="0" max="60" step="1" value={draft.offer.delaySeconds} onChange={(event) => update('offer', 'delaySeconds', numericDraftValue(event))}/></Form.Group></div>
          <Form.Group controlId="offer-title"><Form.Label>Headline</Form.Label><Form.Control maxLength={140} value={draft.offer.title} onChange={(event) => update('offer', 'title', event.target.value)}/></Form.Group>
          <Form.Group controlId="offer-body"><Form.Label>Message</Form.Label><Form.Control as="textarea" rows={3} maxLength={300} value={draft.offer.body} onChange={(event) => update('offer', 'body', event.target.value)}/></Form.Group>
          <div className="admin-setting-row admin-setting-row--three"><Form.Group controlId="offer-code"><Form.Label>Offer code</Form.Label><Form.Control required value={draft.offer.code} onChange={(event) => update('offer', 'code', event.target.value.toUpperCase().replace(/\s/g, ''))}/></Form.Group><Form.Group controlId="offer-percent"><Form.Label>Discount (%)</Form.Label><Form.Control required type="number" min="0" max="100" step="1" value={draft.offer.percent} onChange={(event) => update('offer', 'percent', numericDraftValue(event))}/></Form.Group><Form.Group controlId="offer-max-discount"><Form.Label>Maximum saving (₹)</Form.Label><Form.Control required type="number" min="0" max="100000" step="1" value={draft.offer.maxDiscount} onChange={(event) => update('offer', 'maxDiscount', numericDraftValue(event))}/></Form.Group></div>
        </section>

        <section className="admin-panel setting-card">
          <div className="setting-card__head"><span><Icon name="truck"/></span><div><p className="eyebrow">Operations</p><h3>Timelines & thresholds</h3><p>Set clear expectations before customers order.</p></div></div>
          <div className="admin-setting-row admin-setting-row--three"><Form.Group controlId="ready-lead-time"><Form.Label>Ready-piece lead time</Form.Label><Form.Control required value={draft.leadTimes.ready} onChange={(event) => update('leadTimes', 'ready', event.target.value)}/></Form.Group><Form.Group controlId="custom-lead-time"><Form.Label>Custom-piece lead time</Form.Label><Form.Control required value={draft.leadTimes.custom} onChange={(event) => update('leadTimes', 'custom', event.target.value)}/></Form.Group><Form.Group controlId="shipping-fee"><Form.Label>Standard shipping fee (₹)</Form.Label><Form.Control required type="number" min="0" max="10000" step="1" value={draft.shipping.flatFee} onChange={(event) => update('shipping', 'flatFee', numericDraftValue(event))}/></Form.Group><Form.Group controlId="free-shipping-threshold"><Form.Label>Free shipping from (₹)</Form.Label><Form.Control required type="number" min="0" max="1000000" step="1" value={draft.shipping.freeThreshold} onChange={(event) => update('shipping', 'freeThreshold', numericDraftValue(event))}/></Form.Group><Form.Group controlId="bulk-order-threshold"><Form.Label>Bulk order from (pieces)</Form.Label><Form.Control required type="number" min="2" max="100" step="1" value={draft.shipping.bulkThreshold} onChange={(event) => update('shipping', 'bulkThreshold', numericDraftValue(event))}/></Form.Group></div>
        </section>

        <section className="admin-panel setting-card">
          <div className="setting-card__head"><span><Icon name="mail"/></span><div><p className="eyebrow">Storefront communication</p><h3>Announcement & contact</h3><p>Keep customers informed and make the studio easy to reach.</p></div><Form.Check type="switch" id="announcement-enabled" label={draft.announcement.enabled ? 'Live' : 'Hidden'} checked={draft.announcement.enabled} onChange={(event) => update('announcement', 'enabled', event.target.checked)}/></div>
          <Form.Group controlId="announcement-text"><Form.Label>Announcement text</Form.Label><Form.Control maxLength={160} value={draft.announcement.text} onChange={(event) => update('announcement', 'text', event.target.value)} placeholder="Wedding orders for October are now open."/></Form.Group>
          <div className="admin-setting-row">
            <Form.Group controlId="announcement-link-label">
              <Form.Label>Link label</Form.Label>
              <Form.Control maxLength={40} value={draft.announcement.linkLabel} onChange={(event) => update('announcement', 'linkLabel', event.target.value)} placeholder="Explore the shop"/>
            </Form.Group>
            <Form.Group controlId="announcement-link-url">
              <Form.Label>Link URL</Form.Label>
              <Form.Control
                inputMode="url"
                maxLength={1000}
                value={draft.announcement.linkUrl}
                onChange={(event) => update('announcement', 'linkUrl', event.target.value)}
                placeholder="/shop"
                isInvalid={Boolean(announcementLinkError)}
                aria-describedby="announcement-link-url-help"
              />
              <Form.Control.Feedback type="invalid">{announcementLinkError}</Form.Control.Feedback>
              <Form.Text id="announcement-link-url-help">
                Use a site path beginning with / or a complete HTTPS URL.
                {announcementLinkPreview && <>{' '}<a href={announcementLinkPreview} target="_blank" rel="noreferrer">Open preview ↗</a></>}
              </Form.Text>
            </Form.Group>
          </div>
          <div className="admin-setting-row">
            <Form.Group controlId="contact-email">
              <Form.Label>Customer email</Form.Label>
              <Form.Control type="email" value={draft.contact.email} onChange={(event) => update('contact', 'email', event.target.value)} placeholder="hello@giftnwrapstudio.com"/>
              <Form.Text>Leave blank to hide email links on the storefront.</Form.Text>
            </Form.Group>
            <Form.Group controlId="contact-phone">
              <Form.Label>Customer phone</Form.Label>
              <Form.Control type="tel" value={draft.contact.phone} onChange={(event) => update('contact', 'phone', event.target.value)} placeholder="+91 98765 43210"/>
              <Form.Text>Leave blank to hide phone links on the storefront.</Form.Text>
            </Form.Group>
          </div>
          <div className="admin-setting-row">
            <Form.Group controlId="contact-instagram">
              <Form.Label>Instagram profile</Form.Label>
              <Form.Control
                inputMode="url"
                maxLength={200}
                value={draft.contact.instagram}
                onChange={(event) => update('contact', 'instagram', event.target.value)}
                placeholder="@giftnwrapstudio"
                isInvalid={Boolean(instagramError)}
                aria-describedby="contact-instagram-help"
              />
              <Form.Control.Feedback type="invalid">{instagramError}</Form.Control.Feedback>
              <Form.Text id="contact-instagram-help">
                Use @handle or a profile URL; post and reel links are rejected. Leave blank to hide.
                {instagramPreview?.url && <>{' '}<a href={instagramPreview.url} target="_blank" rel="noreferrer">Open Instagram ↗</a></>}
              </Form.Text>
            </Form.Group>
            <Form.Group controlId="contact-facebook">
              <Form.Label>Facebook page or profile</Form.Label>
              <Form.Control
                inputMode="url"
                maxLength={200}
                value={draft.contact.facebook}
                onChange={(event) => update('contact', 'facebook', event.target.value)}
                placeholder="https://www.facebook.com/your-page"
                isInvalid={Boolean(facebookError)}
                aria-describedby="contact-facebook-help"
              />
              <Form.Control.Feedback type="invalid">{facebookError}</Form.Control.Feedback>
              <Form.Text id="contact-facebook-help">
                No page is assumed. Add the verified studio page, or leave blank to hide.
                {facebookPreview?.url && <>{' '}<a href={facebookPreview.url} target="_blank" rel="noreferrer">Open Facebook ↗</a></>}
              </Form.Text>
            </Form.Group>
          </div>
        </section>
      </div>

      <aside className="settings-preview-column">
        <div className="settings-preview-column__sticky">
          <p className="eyebrow">Live preview</p>
          <div className={`announcement-preview ${!draft.announcement.enabled ? 'is-disabled' : ''}`}>
            <span>{draft.announcement.text || 'Your announcement will appear here.'}</span>
            {draft.announcement.linkLabel && announcementLinkPreview && <a href={announcementLinkPreview} target="_blank" rel="noreferrer">{draft.announcement.linkLabel} →</a>}
            {!draft.announcement.enabled && <b>Announcement hidden</b>}
          </div>
          <div className={`offer-preview ${!draft.offer.enabled ? 'is-disabled' : ''}`}>
            <span className="offer-preview__spark"><Icon name="spark"/></span>
            <p className="eyebrow">{draft.offer.eyebrow}</p>
            <h3>{draft.offer.title}</h3>
            <p>{draft.offer.body}</p>
            <div><strong>{draft.offer.percent}% off</strong><code>{draft.offer.code}</code></div>
            <small>Appears after {draft.offer.delaySeconds} seconds · maximum saving ₹{Number(draft.offer.maxDiscount || 0).toLocaleString('en-IN')}</small>
            {!draft.offer.enabled && <b className="offer-preview__hidden">Popup hidden</b>}
          </div>
          {(instagramPreview?.url || facebookPreview?.url) && <div className="settings-preview-note">
            <Icon name="instagram" size={17}/>
            <p>
              <strong>Social links</strong>
              <span className="d-flex flex-wrap gap-2">
                {instagramPreview?.url && <a href={instagramPreview.url} target="_blank" rel="noreferrer">Instagram ↗</a>}
                {facebookPreview?.url && <a href={facebookPreview.url} target="_blank" rel="noreferrer">Facebook ↗</a>}
              </span>
            </p>
          </div>}
          <div className="settings-preview-note"><Icon name="shield" size={17}/><p><strong>Safe publishing</strong><span>Changes are validated and stored by the server before customers see them.</span></p></div>
        </div>
      </aside>
    </div>
    </fieldset>
  </Form>;
}
