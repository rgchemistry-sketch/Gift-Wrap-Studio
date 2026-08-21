const customizationLabels = {
  name: 'Name or initials',
  date: 'Special date',
  message: 'Artist notes',
  colour: 'Colour story',
  color: 'Colour story',
  finish: 'Metallic finish',
};

const internalMediaFields = new Set(['publicId', 'expiresAt', 'pending']);

const readableLabel = (key) => customizationLabels[key] || String(key || 'Detail')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replaceAll('_', ' ')
  .replace(/^./, (letter) => letter.toUpperCase());

const displayValue = (key, value) => {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  }
  return String(value);
};

const safeMediaUrl = (value) => {
  const candidate = String(value || '').trim();
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'res.cloudinary.com' ? url.href : '';
  } catch {
    return '';
  }
};

export const parseOrderCustomization = (rawValue) => {
  if (!rawValue) return { fields: [], media: [] };
  let customization = rawValue;
  if (typeof rawValue === 'string') {
    try {
      customization = JSON.parse(rawValue);
    } catch {
      return { fields: [{ label: 'Personalization', value: rawValue }], media: [] };
    }
  }

  if (!customization || typeof customization !== 'object' || Array.isArray(customization)) {
    return { fields: [{ label: 'Personalization', value: String(customization) }], media: [] };
  }

  const fields = [];
  const media = [];
  const visit = (value, key, path = []) => {
    if (value == null || value === '') return;
    if (key === 'media' && typeof value === 'object' && !Array.isArray(value)) {
      const url = safeMediaUrl(value.url);
      if (url) media.push({ url, name: String(value.name || 'Customer reference') });
      if (value.name) fields.push({ label: 'Reference file', value: String(value.name) });
      Object.entries(value).forEach(([mediaKey, mediaValue]) => {
        if (mediaKey === 'url' || mediaKey === 'name' || internalMediaFields.has(mediaKey)) return;
        visit(mediaValue, mediaKey, [...path, key]);
      });
      return;
    }
    if (Array.isArray(value)) {
      const primitiveValues = value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item));
      if (primitiveValues.length === value.length) {
        fields.push({ label: readableLabel(key), value: primitiveValues.map(String).join(', ') });
      } else {
        value.forEach((item, index) => visit(item, `${key} ${index + 1}`, path));
      }
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey, [...path, key]));
      return;
    }
    fields.push({
      label: readableLabel(path.length ? `${path.at(-1)} ${key}` : key),
      value: displayValue(key, value),
    });
  };

  Object.entries(customization).forEach(([key, value]) => visit(value, key));
  return { fields, media };
};

export const orderContactSnapshot = (order = {}) => {
  const lines = String(order.note || '').split(/\r?\n/);
  let legacyNeededBy = '';
  let legacyContactPreference = '';
  const customerNoteLines = [];

  lines.forEach((line) => {
    const neededBy = line.match(/^Needed by:\s*(.+)$/i);
    const contactPreference = line.match(/^Preferred contact:\s*(.+)$/i);
    if (!order.neededBy && neededBy && !legacyNeededBy) {
      legacyNeededBy = neededBy[1].trim();
    } else if (!order.contactPreference && contactPreference && !legacyContactPreference) {
      legacyContactPreference = contactPreference[1].trim();
    } else {
      customerNoteLines.push(line);
    }
  });

  return {
    neededBy: order.neededBy || legacyNeededBy,
    contactPreference: order.contactPreference || legacyContactPreference || 'Not specified',
    customerNote: customerNoteLines.join('\n').trim(),
  };
};

export const canRetryInquiryStatusWithoutSnapshot = ({ error, expectedStatus, undo }) => {
  if (!expectedStatus || undo || error?.status !== 422 || error?.code !== 'VALIDATION_ERROR') return false;
  return Array.isArray(error.details) && error.details.some((detail) => (
    /unrecognized key/i.test(String(detail?.message || ''))
    && /expectedStatus|undo/i.test(String(detail?.message || ''))
  ));
};

export const buildInboxStatusUpdate = ({
  status,
  adminNote,
  expectedStatus = '',
  undo = false,
} = {}) => {
  const trimmedNote = typeof adminNote === 'string' ? adminNote.trim() : '';
  return {
    status,
    ...(trimmedNote ? { adminNote: trimmedNote } : {}),
    ...(expectedStatus ? { expectedStatus } : {}),
    ...(undo ? { undo: true } : {}),
  };
};
