import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Icon from '../Icon';
import { api } from '../../api/client';
import AdminSectionState from './AdminSectionState';
import {
  INSTAGRAM_PROFILE_MESSAGE,
  normalizeInstagramProfile,
} from '../../../shared/social-profiles.js';
import { effectiveOfferDelaySeconds } from '../../utils/offer-popup';

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
    delaySeconds: 10,
  },
  shipping: { flatFee: 99, freeThreshold: 2000, bulkThreshold: 10 },
  announcement: { enabled: true, text: 'Every piece handmade with care', linkLabel: 'PAN India delivery', linkUrl: '/shop' },
  contact: {
    email: 'info@giftnwrapstudio.com',
    phone: '+919588281126',
    instagram: '@giftnwrapstudio',
  },
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const objectValue = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const textValue = (source, key, fallback) => hasOwn(source, key)
  ? String(source[key] ?? '')
  : fallback;
const booleanValue = (source, key, fallback) => typeof source[key] === 'boolean'
  ? source[key]
  : fallback;
const numberValue = (source, key, fallback) => {
  if (!hasOwn(source, key)) return fallback;
  if (source[key] === '') return '';
  const number = Number(source[key]);
  return Number.isFinite(number) ? number : fallback;
};

const mergeSettings = (input = {}) => {
  const value = objectValue(input);
  const leadTimes = objectValue(value.leadTimes);
  const offer = objectValue(value.offer || value.welcomeOffer);
  const shipping = objectValue(value.shipping);
  const announcement = objectValue(value.announcement);
  const contact = objectValue(value.contact);
  return {
    leadTimes: {
      ready: textValue(leadTimes, 'ready', defaults.leadTimes.ready),
      custom: textValue(leadTimes, 'custom', defaults.leadTimes.custom),
    },
    offer: {
      enabled: booleanValue(offer, 'enabled', defaults.offer.enabled),
      eyebrow: textValue(offer, 'eyebrow', defaults.offer.eyebrow),
      title: textValue(offer, 'title', defaults.offer.title),
      body: textValue(offer, 'body', defaults.offer.body),
      code: textValue(offer, 'code', defaults.offer.code),
      percent: numberValue(offer, 'percent', defaults.offer.percent),
      maxDiscount: numberValue(offer, 'maxDiscount', defaults.offer.maxDiscount),
      delaySeconds: numberValue(offer, 'delaySeconds', defaults.offer.delaySeconds),
    },
    shipping: {
      flatFee: numberValue(shipping, 'flatFee', defaults.shipping.flatFee),
      freeThreshold: numberValue(shipping, 'freeThreshold', defaults.shipping.freeThreshold),
      bulkThreshold: numberValue(shipping, 'bulkThreshold', defaults.shipping.bulkThreshold),
    },
    announcement: {
      enabled: booleanValue(announcement, 'enabled', defaults.announcement.enabled),
      text: textValue(announcement, 'text', defaults.announcement.text),
      linkLabel: textValue(announcement, 'linkLabel', defaults.announcement.linkLabel),
      linkUrl: textValue(announcement, 'linkUrl', defaults.announcement.linkUrl),
    },
    contact: {
      email: textValue(contact, 'email', defaults.contact.email),
      phone: textValue(contact, 'phone', defaults.contact.phone),
      instagram: textValue(contact, 'instagram', defaults.contact.instagram),
    },
  };
};

const settingsDiff = (base, next) => Object.fromEntries(
  Object.keys(defaults).flatMap((group) => {
    const changes = Object.fromEntries(
      Object.keys(defaults[group]).filter((key) => !Object.is(base[group][key], next[group][key]))
        .map((key) => [key, next[group][key]]),
    );
    return Object.keys(changes).length ? [[group, changes]] : [];
  }),
);

const overlaySettings = (base, changes) => mergeSettings(Object.fromEntries(
  Object.keys(defaults).map((group) => [
    group,
    { ...base[group], ...objectValue(changes?.[group]) },
  ]),
));

const numericDraftValue = (event) => event.target.value === '' ? '' : Number(event.target.value);
const numericPayloadValue = (value) => Number(value);
const SETTINGS_DRAFT_KEY = 'gnw-admin-settings-draft';
const SETTINGS_DRAFT_VERSION = 1;
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

const socialPublicationState = ({ savedValue, draftValue, profile, error, noun, normalize = normalizeInstagramProfile }) => {
  const savedProfile = normalize(savedValue);
  const savedIsLive = Boolean(savedProfile?.url);
  const draftIsPublishable = Boolean(profile?.url);
  const changed = String(savedValue || '').trim() !== String(draftValue || '').trim();
  if (!changed) return savedIsLive
    ? { badge: 'Live', description: `${noun} profile connected`, connected: true }
    : { badge: 'Off', description: `${noun} profile hidden`, connected: false };
  if (error) return { badge: 'Invalid draft', description: 'Fix this link before publishing', connected: false };
  if (draftIsPublishable) return {
    badge: 'Ready to publish',
    description: savedIsLive ? 'Profile update ready' : 'Profile ready to connect',
    connected: true,
  };
  return savedIsLive
    ? { badge: 'Will hide', description: 'Profile will hide after publishing', connected: false }
    : { badge: 'Off', description: `${noun} profile hidden`, connected: false };
};

export default function SettingsEditor({ preview = false, notify, onPublished, draftScope = 'studio' }) {
  const formRef = useRef(null);
  const [saved, setSaved] = useState(defaults);
  const [draft, setDraft] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [restoredDraft, setRestoredDraft] = useState(false);
  const draftStorageKey = `${SETTINGS_DRAFT_KEY}:${String(draftScope || 'studio')}`;
  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [draft, saved]);
  const instagramPreview = useMemo(
    () => normalizeInstagramProfile(draft.contact.instagram),
    [draft.contact.instagram],
  );
  const announcementLinkPreview = useMemo(
    () => normalizeAnnouncementLink(draft.announcement.linkUrl),
    [draft.announcement.linkUrl],
  );
  const fieldError = (group, name) => fieldErrors[`${group}.${name}`] || '';
  const instagramError = fieldError('contact', 'instagram') || (
    draft.contact.instagram.trim() && !instagramPreview ? INSTAGRAM_PROFILE_MESSAGE : ''
  );
  const announcementLinkError = fieldError('announcement', 'linkUrl') || (
    draft.announcement.linkUrl.trim() && announcementLinkPreview === null
      ? 'Enter an HTTPS URL or a site path beginning with /'
      : ''
  );
  const hasFieldErrors = Boolean(
    instagramError || announcementLinkError || Object.keys(fieldErrors).length,
  );
  const validationCount = new Set([
    ...Object.keys(fieldErrors),
    ...(instagramError ? ['contact.instagram'] : []),
    ...(announcementLinkError ? ['announcement.linkUrl'] : []),
  ]).size;
  const instagramPublication = socialPublicationState({
    savedValue: saved.contact.instagram,
    draftValue: draft.contact.instagram,
    profile: instagramPreview,
    error: instagramError,
    noun: 'Instagram',
  });
  const loadSettings = useCallback(async () => {
    setLoading(true); setLoaded(false); setError(''); setFieldErrors({});
    try {
      const result = await api.getAdminSettings();
      const value = mergeSettings(result.settings || result.data?.settings || result.data || result);
      let nextDraft = value;
      try {
        const storedDraft = window.sessionStorage.getItem(draftStorageKey);
        if (storedDraft) {
          const stored = JSON.parse(storedDraft);
          if (
            stored?.version === SETTINGS_DRAFT_VERSION
            && objectValue(stored.changes) === stored.changes
          ) {
            nextDraft = overlaySettings(value, stored.changes);
            setRestoredDraft(JSON.stringify(nextDraft) !== JSON.stringify(value));
          } else {
            window.sessionStorage.removeItem(draftStorageKey);
          }
        }
      } catch {
        try { window.sessionStorage.removeItem(draftStorageKey); } catch { /* optional cache */ }
      }
      setSaved(value); setDraft(nextDraft); setLoaded(true);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [draftStorageKey]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  useEffect(() => {
    if (!loaded) return;
    try {
      if (dirty) {
        window.sessionStorage.setItem(draftStorageKey, JSON.stringify({
          version: SETTINGS_DRAFT_VERSION,
          changes: settingsDiff(saved, draft),
        }));
      }
      else window.sessionStorage.removeItem(draftStorageKey);
    } catch {
      // Settings remain editable even if private browsing blocks session storage.
    }
  }, [dirty, draft, draftStorageKey, loaded, saved]);

  useEffect(() => {
    if (!dirty || saving) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty, saving]);

  const update = (group, name, value) => {
    const key = `${group}.${name}`;
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setDraft((current) => ({
      ...current,
      [group]: { ...current[group], [name]: value },
    }));
  };

  const discard = () => {
    setDraft(saved);
    setError('');
    setFieldErrors({});
    setRestoredDraft(false);
    try { window.sessionStorage.removeItem(draftStorageKey); } catch { /* optional cache */ }
  };

  const focusFirstError = useCallback(() => {
    window.requestAnimationFrame(() => {
      const target = formRef.current?.querySelector('.is-invalid, [aria-invalid="true"]');
      if (!target) return;
      target.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      target.focus?.({ preventScroll: true });
    });
  }, []);

  const save = async (event) => {
    event.preventDefault();
    if (hasFieldErrors) {
      setError(`Fix ${validationCount} highlighted ${validationCount === 1 ? 'field' : 'fields'} before publishing.`);
      focusFirstError();
      return;
    }
    setSaving(true); setError(''); setFieldErrors({});
    try {
      const nextValues = {
        leadTimes: { ready: draft.leadTimes.ready, custom: draft.leadTimes.custom },
        offer: {
          enabled: draft.offer.enabled,
          eyebrow: draft.offer.eyebrow,
          title: draft.offer.title,
          body: draft.offer.body,
          code: draft.offer.code,
          percent: numericPayloadValue(draft.offer.percent),
          maxDiscount: numericPayloadValue(draft.offer.maxDiscount),
          delaySeconds: effectiveOfferDelaySeconds(draft.offer.delaySeconds),
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
        },
      };
      const payload = settingsDiff(saved, nextValues);
      const result = await api.updateAdminSettings(payload);
      const next = mergeSettings(result.settings || result.data?.settings || result.data || draft);
      setSaved(next); setDraft(next); setRestoredDraft(false);
      try { window.sessionStorage.removeItem(draftStorageKey); } catch { /* optional cache */ }
      onPublished?.(next);
      notify('Studio settings are live.');
    } catch (requestError) {
      const details = Array.isArray(requestError.details)
        ? requestError.details
        : Array.isArray(requestError.details?.issues)
          ? requestError.details.issues
          : [];
      const nextFieldErrors = {};
      details.forEach((detail) => {
        const field = String(detail?.field || '').replace(/^settings\./, '');
        if (field.includes('.')) nextFieldErrors[field] = detail.message || requestError.message;
      });
      setFieldErrors(nextFieldErrors);
      const message = Object.keys(nextFieldErrors).length
        ? 'Settings were not published. Review the highlighted fields below.'
        : requestError.message;
      setError(message);
      notify(message, 'error');
      focusFirstError();
    }
    finally { setSaving(false); }
  };

  if (loading) return <AdminSectionState loading title="Opening studio settings" message="Gathering your current storefront controls…"/>;
  if (!loaded) return <AdminSectionState title="Settings could not load" message={error || 'The studio settings service did not return a usable response.'} actionLabel="Try again" onAction={loadSettings}/>;

  const offerDelaySeconds = effectiveOfferDelaySeconds(draft.offer.delaySeconds);

  return <Form ref={formRef} className="settings-editor" onSubmit={save}>
    <div className="admin-section-head settings-editor__head"><div><p className="eyebrow">Studio controls</p><h2>Settings</h2><p className="admin-section-copy">Offers, service details and shop messages — without touching code.</p></div><div className="settings-editor__actions"><span className={hasFieldErrors ? 'has-errors' : dirty ? 'is-dirty' : ''}>{hasFieldErrors ? `${validationCount} ${validationCount === 1 ? 'field needs' : 'fields need'} attention` : dirty ? 'Unsaved changes' : 'Everything saved'}</span><Button type="button" variant="outline-dark" disabled={!dirty || saving} onClick={discard}>Discard</Button><Button type="submit" variant="dark" disabled={!dirty || saving || preview}>{saving && <Spinner animation="border" size="sm"/>}{saving ? 'Publishing…' : 'Save & publish'}</Button></div></div>
    {error && <Alert variant="danger" className="soft-alert">{error}</Alert>}
    {restoredDraft && dirty && <Alert variant="info" className="soft-alert"><strong>Unsaved settings restored.</strong> Your draft was kept when you moved to another admin section.</Alert>}
    {preview && <Alert variant="warning" className="soft-alert">Settings cannot be changed while preview data is active.</Alert>}

    <fieldset className="settings-editor__fieldset" disabled={saving || preview}>
    <div className="settings-editor__layout">
      <div className="settings-editor__forms">
        <section className="admin-panel setting-card">
          <div className="setting-card__head"><span><Icon name="spark"/></span><div><p className="eyebrow">Storefront moment</p><h3>Welcome offer popup</h3><p>Control the first message new customers see.</p></div><Form.Check type="switch" id="offer-enabled" label={draft.offer.enabled ? 'Live' : 'Hidden'} checked={draft.offer.enabled} onChange={(event) => update('offer', 'enabled', event.target.checked)}/></div>
          <div className="admin-setting-row"><Form.Group controlId="offer-eyebrow"><Form.Label>Eyebrow</Form.Label><Form.Control maxLength={80} value={draft.offer.eyebrow} isInvalid={Boolean(fieldError('offer', 'eyebrow'))} onChange={(event) => update('offer', 'eyebrow', event.target.value)}/><Form.Control.Feedback type="invalid">{fieldError('offer', 'eyebrow')}</Form.Control.Feedback></Form.Group><Form.Group controlId="offer-timing"><Form.Label>Popup timing</Form.Label><Form.Control readOnly value={`About ${offerDelaySeconds} seconds after eligibility is confirmed`}/><Form.Text>A short pause lets visitors settle in before the welcome offer appears.</Form.Text></Form.Group></div>
          <Form.Group controlId="offer-title"><Form.Label>Headline</Form.Label><Form.Control maxLength={140} value={draft.offer.title} isInvalid={Boolean(fieldError('offer', 'title'))} onChange={(event) => update('offer', 'title', event.target.value)}/><Form.Control.Feedback type="invalid">{fieldError('offer', 'title')}</Form.Control.Feedback></Form.Group>
          <Form.Group controlId="offer-body"><Form.Label>Message</Form.Label><Form.Control as="textarea" rows={3} maxLength={300} value={draft.offer.body} isInvalid={Boolean(fieldError('offer', 'body'))} onChange={(event) => update('offer', 'body', event.target.value)}/><Form.Control.Feedback type="invalid">{fieldError('offer', 'body')}</Form.Control.Feedback></Form.Group>
          <div className="admin-setting-row admin-setting-row--three"><Form.Group controlId="offer-code"><Form.Label>Offer code</Form.Label><Form.Control required value={draft.offer.code} isInvalid={Boolean(fieldError('offer', 'code'))} onChange={(event) => update('offer', 'code', event.target.value.toUpperCase().replace(/\s/g, ''))}/><Form.Control.Feedback type="invalid">{fieldError('offer', 'code')}</Form.Control.Feedback></Form.Group><Form.Group controlId="offer-percent"><Form.Label>Discount (%)</Form.Label><Form.Control required type="number" min="0" max="100" step="1" value={draft.offer.percent} isInvalid={Boolean(fieldError('offer', 'percent'))} onChange={(event) => update('offer', 'percent', numericDraftValue(event))}/><Form.Control.Feedback type="invalid">{fieldError('offer', 'percent')}</Form.Control.Feedback></Form.Group><Form.Group controlId="offer-max-discount"><Form.Label>Maximum saving (₹)</Form.Label><Form.Control required type="number" min="0" max="100000" step="1" value={draft.offer.maxDiscount} isInvalid={Boolean(fieldError('offer', 'maxDiscount'))} onChange={(event) => update('offer', 'maxDiscount', numericDraftValue(event))}/><Form.Control.Feedback type="invalid">{fieldError('offer', 'maxDiscount')}</Form.Control.Feedback></Form.Group></div>
        </section>

        <section className="admin-panel setting-card">
          <div className="setting-card__head"><span><Icon name="truck"/></span><div><p className="eyebrow">Operations</p><h3>Timelines & thresholds</h3><p>Set clear expectations before customers order.</p></div></div>
          <div className="admin-setting-row admin-setting-row--three"><Form.Group controlId="ready-lead-time"><Form.Label>Ready-piece lead time</Form.Label><Form.Control required value={draft.leadTimes.ready} isInvalid={Boolean(fieldError('leadTimes', 'ready'))} onChange={(event) => update('leadTimes', 'ready', event.target.value)}/><Form.Control.Feedback type="invalid">{fieldError('leadTimes', 'ready')}</Form.Control.Feedback></Form.Group><Form.Group controlId="custom-lead-time"><Form.Label>Custom-piece lead time</Form.Label><Form.Control required value={draft.leadTimes.custom} isInvalid={Boolean(fieldError('leadTimes', 'custom'))} onChange={(event) => update('leadTimes', 'custom', event.target.value)}/><Form.Control.Feedback type="invalid">{fieldError('leadTimes', 'custom')}</Form.Control.Feedback></Form.Group><Form.Group controlId="shipping-fee"><Form.Label>Standard shipping fee (₹)</Form.Label><Form.Control required type="number" min="0" max="10000" step="1" value={draft.shipping.flatFee} isInvalid={Boolean(fieldError('shipping', 'flatFee'))} onChange={(event) => update('shipping', 'flatFee', numericDraftValue(event))}/><Form.Control.Feedback type="invalid">{fieldError('shipping', 'flatFee')}</Form.Control.Feedback></Form.Group><Form.Group controlId="free-shipping-threshold"><Form.Label>Free shipping from (₹)</Form.Label><Form.Control required type="number" min="0" max="1000000" step="1" value={draft.shipping.freeThreshold} isInvalid={Boolean(fieldError('shipping', 'freeThreshold'))} onChange={(event) => update('shipping', 'freeThreshold', numericDraftValue(event))}/><Form.Control.Feedback type="invalid">{fieldError('shipping', 'freeThreshold')}</Form.Control.Feedback></Form.Group><Form.Group controlId="bulk-order-threshold"><Form.Label>Bulk order from (pieces)</Form.Label><Form.Control required type="number" min="2" max="100" step="1" value={draft.shipping.bulkThreshold} isInvalid={Boolean(fieldError('shipping', 'bulkThreshold'))} onChange={(event) => update('shipping', 'bulkThreshold', numericDraftValue(event))}/><Form.Control.Feedback type="invalid">{fieldError('shipping', 'bulkThreshold')}</Form.Control.Feedback></Form.Group></div>
        </section>

        <section className="admin-panel setting-card">
          <div className="setting-card__head"><span><Icon name="mail"/></span><div><p className="eyebrow">Storefront communication</p><h3>Announcement & contact</h3><p>Keep customers informed and make the studio easy to reach.</p></div><Form.Check type="switch" id="announcement-enabled" label={draft.announcement.enabled ? 'Live' : 'Hidden'} checked={draft.announcement.enabled} onChange={(event) => update('announcement', 'enabled', event.target.checked)}/></div>
          <Form.Group controlId="announcement-text"><Form.Label>Announcement text</Form.Label><Form.Control maxLength={160} value={draft.announcement.text} isInvalid={Boolean(fieldError('announcement', 'text'))} onChange={(event) => update('announcement', 'text', event.target.value)} placeholder="Wedding orders for October are now open."/><Form.Control.Feedback type="invalid">{fieldError('announcement', 'text')}</Form.Control.Feedback></Form.Group>
          <div className="admin-setting-row">
            <Form.Group controlId="announcement-link-label">
              <Form.Label>Link label</Form.Label>
              <Form.Control maxLength={40} value={draft.announcement.linkLabel} isInvalid={Boolean(fieldError('announcement', 'linkLabel'))} onChange={(event) => update('announcement', 'linkLabel', event.target.value)} placeholder="Explore the shop"/>
              <Form.Control.Feedback type="invalid">{fieldError('announcement', 'linkLabel')}</Form.Control.Feedback>
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
              <Form.Control type="email" value={draft.contact.email} isInvalid={Boolean(fieldError('contact', 'email'))} onChange={(event) => update('contact', 'email', event.target.value)} placeholder="hello@giftnwrapstudio.com"/>
              <Form.Control.Feedback type="invalid">{fieldError('contact', 'email')}</Form.Control.Feedback>
              <Form.Text>Leave blank to hide email links on the storefront.</Form.Text>
            </Form.Group>
            <Form.Group controlId="contact-phone">
              <Form.Label>Customer phone</Form.Label>
              <Form.Control type="tel" value={draft.contact.phone} isInvalid={Boolean(fieldError('contact', 'phone'))} onChange={(event) => update('contact', 'phone', event.target.value)} placeholder="+91 98765 43210"/>
              <Form.Control.Feedback type="invalid">{fieldError('contact', 'phone')}</Form.Control.Feedback>
              <Form.Text>Leave blank to hide phone links on the storefront.</Form.Text>
            </Form.Group>
          </div>
        </section>

        <section className="admin-panel setting-card setting-card--social">
          <div className="setting-card__head"><span><Icon name="spark"/></span><div><p className="eyebrow">Connected presence</p><h3>Instagram</h3><p>Keep the studio profile connected wherever customers discover your work.</p></div></div>
          <div className="social-channel-grid">
            <article className={`social-channel social-channel--instagram ${instagramPublication.connected ? 'is-connected' : ''}`}>
              <header><span><Icon name="instagram"/></span><div><strong>Instagram</strong><small>{instagramPublication.description}</small></div><b>{instagramPublication.badge}</b></header>
              <Form.Group controlId="contact-instagram">
                <Form.Label>Instagram handle or profile URL</Form.Label>
                <Form.Control inputMode="url" maxLength={200} value={draft.contact.instagram} onChange={(event) => update('contact', 'instagram', event.target.value)} placeholder="@giftnwrapstudio" isInvalid={Boolean(instagramError)} aria-describedby="contact-instagram-help"/>
                <Form.Control.Feedback type="invalid">{instagramError}</Form.Control.Feedback>
                <Form.Text id="contact-instagram-help">Use @handle or an HTTPS profile URL. Post and reel links are rejected.</Form.Text>
              </Form.Group>
              {instagramPreview?.url && <a className="social-channel__test" href={instagramPreview.url} target="_blank" rel="noreferrer">Test Instagram link <Icon name="arrow" size={13}/></a>}
            </article>
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
            <small>Appears after a {offerDelaySeconds}-second welcome pause · maximum saving ₹{Number(draft.offer.maxDiscount || 0).toLocaleString('en-IN')}</small>
            {!draft.offer.enabled && <b className="offer-preview__hidden">Popup hidden</b>}
          </div>
          {instagramPreview?.url && <div className="settings-preview-note settings-social-preview">
            <Icon name="spark" size={17}/>
            <p>
              <strong>Social links</strong>
              <span className="settings-social-preview__links">
                {instagramPreview?.url && <a href={instagramPreview.url} target="_blank" rel="noreferrer"><Icon name="instagram" size={14}/> Instagram</a>}
              </span>
            </p>
          </div>}
          <div className="settings-preview-note"><Icon name="shield" size={17}/><p><strong>Safe publishing</strong><span>Changes are validated and stored by the server before customers see them.</span></p></div>
        </div>
      </aside>
    </div>
    </fieldset>
    <div className="settings-editor__mobile-actions" aria-hidden={!dirty}>
      <span>{dirty ? 'Unsaved storefront changes' : 'Everything saved'}</span>
      <Button type="button" variant="outline-dark" disabled={!dirty || saving} onClick={discard}>Discard</Button>
      <Button type="submit" variant="dark" disabled={!dirty || saving || preview}>{saving ? 'Publishing…' : 'Save'}</Button>
    </div>
  </Form>;
}
