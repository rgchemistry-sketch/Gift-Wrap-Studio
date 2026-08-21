import {
  INDIAN_MOBILE_MESSAGE,
  normalizeIndianMobile,
} from '../../shared/indian-phone.js';
import { dateInputIsBeforeMinimum } from './date-input.js';
import { customReferencePayload } from './custom-reference-upload.js';

const validEmail = (value) => /^\S+@\S+\.\S+$/.test(String(value || '').trim());

const validReference = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  try {
    return ['http:', 'https:'].includes(new URL(trimmed).protocol);
  } catch {
    return false;
  }
};

export const isCorporateCustomOrder = (form = {}) => (
  form.requestKind === 'corporate' || form.productType === 'Corporate gifts'
);

export const selectCustomOrderProductType = (form = {}, productType = '') => ({
  ...form,
  productType,
  requestKind: productType === 'Corporate gifts' ? 'corporate' : 'personal',
});

export const customOrderStepErrors = (form = {}, step = 0) => {
  const errors = {};

  if (step === 0) {
    if (!form.productType) errors.productType = 'Choose the kind of piece you have in mind.';
    if (String(form.description || '').trim().length < 10) {
      errors.description = 'Describe your idea in at least 10 characters.';
    }
    if (dateInputIsBeforeMinimum(form.neededBy)) {
      errors.neededBy = 'Choose today or a future date for “Needed by”.';
    }
    if (isCorporateCustomOrder(form)) {
      if (String(form.company || '').trim().length < 2) {
        errors.company = 'Enter the company or organisation name.';
      }
      const quantity = Number(form.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) {
        errors.quantity = 'Enter a whole-number quantity between 1 and 100,000.';
      }
    }
  }

  if (step === 1) {
    if (!String(form.personalization || '').trim()) {
      errors.personalization = 'Tell us which names, dates, photos, logo or details should be included.';
    }
    if (!validReference(form.referenceUrl)) {
      errors.referenceUrl = 'Enter a complete HTTP or HTTPS reference link.';
    }
  }

  if (step === 2) {
    if (String(form.name || '').trim().length < 2) {
      errors.name = 'Enter your name using at least 2 characters.';
    }
    if (!validEmail(form.email)) errors.email = 'Enter a valid email address.';
    if (!normalizeIndianMobile(form.phone)) errors.phone = INDIAN_MOBILE_MESSAGE;
  }

  return errors;
};

export const firstCustomOrderError = (errors = {}) => Object.values(errors)[0] || '';

export const customInquiryPayload = (form, verifiedEmail, verifiedUserId = '') => {
  const corporate = isCorporateCustomOrder(form);
  const { referenceImages } = customReferencePayload(form.referenceImages, {
    ownerId: verifiedUserId,
  });
  const corporateContext = corporate
    ? `Corporate gifting brief\nCompany / organisation: ${String(form.company || '').trim()}\nEstimated quantity: ${Number(form.quantity)}\n\n`
    : '';

  return {
    name: String(form.name || '').trim(),
    email: verifiedEmail,
    phone: normalizeIndianMobile(form.phone),
    productType: form.productType,
    occasion: form.occasion,
    description: `${corporateContext}${String(form.description || '').trim()}`,
    personalization: String(form.personalization || '').trim(),
    palette: String(form.palette || '').trim(),
    budget: form.budget,
    neededBy: form.neededBy,
    contactPreference: form.contactPreference,
    referenceUrl: String(form.referenceUrl || '').trim(),
    referenceImages,
  };
};
