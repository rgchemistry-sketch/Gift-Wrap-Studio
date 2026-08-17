export const INDIAN_MOBILE_MESSAGE =
  'Enter a valid Indian mobile number (10 digits, with optional 0 or +91)';

export const normalizeIndianMobile = (input) => {
  const value = String(input ?? '').trim();
  if (!value || !/^\+?[0-9\s()-]+$/.test(value)) return null;

  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+') && !/^91[6-9][0-9]{9}$/.test(digits)) return null;

  const local = /^91[6-9][0-9]{9}$/.test(digits)
    ? digits.slice(2)
    : /^0[6-9][0-9]{9}$/.test(digits)
      ? digits.slice(1)
      : /^[6-9][0-9]{9}$/.test(digits)
        ? digits
        : '';

  return local ? `+91${local}` : null;
};
