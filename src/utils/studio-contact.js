import {
  normalizeFacebookProfile,
  normalizeInstagramProfile,
} from '../../shared/social-profiles.js';

export const DEFAULT_STUDIO_CONTACT = Object.freeze({
  email: 'info@giftnwrapstudio.com',
  phone: '+919588281126',
  instagram: '@giftnwrapstudio',
  facebook: '',
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const configuredValue = (settings, nestedKey, legacyKey, fallback) => {
  if (!settings) return fallback;
  const contact = settings.contact || {};
  if (hasOwn(contact, nestedKey)) return contact[nestedKey] ?? '';
  if (legacyKey && hasOwn(settings, legacyKey)) return settings[legacyKey] ?? '';
  return fallback;
};

const socialInput = (settings, provider, fallback) => {
  if (!settings) return fallback;
  const contact = settings.contact || {};
  if (hasOwn(contact, provider)) return contact[provider] ?? '';
  const urlKey = `${provider}Url`;
  if (hasOwn(contact, urlKey)) return contact[urlKey] ?? '';
  if (hasOwn(settings, urlKey)) return settings[urlKey] ?? '';
  return fallback;
};

export function formatPhoneLabel(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length !== 10) return String(value || '');
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

export function resolveStudioContact(settings) {
  const phone = String(configuredValue(
    settings,
    'phone',
    'contactPhone',
    DEFAULT_STUDIO_CONTACT.phone,
  )).trim();
  const email = String(configuredValue(
    settings,
    'email',
    'contactEmail',
    DEFAULT_STUDIO_CONTACT.email,
  )).trim();
  const configuredPhoneLabel = String(configuredValue(settings, 'phoneLabel', 'contactPhoneLabel', '')).trim();
  const instagram = normalizeInstagramProfile(
    socialInput(settings, 'instagram', DEFAULT_STUDIO_CONTACT.instagram),
  );
  const facebook = normalizeFacebookProfile(
    socialInput(settings, 'facebook', DEFAULT_STUDIO_CONTACT.facebook),
  );

  return {
    email,
    phone,
    phoneHref: phone ? `tel:${phone.replace(/[^+\d]/g, '')}` : '',
    phoneLabel: configuredPhoneLabel || formatPhoneLabel(phone),
    instagramUrl: instagram?.url || '',
    instagramLabel: instagram?.label || '',
    facebookUrl: facebook?.url || '',
    facebookLabel: facebook?.label || '',
  };
}
