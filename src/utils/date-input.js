const padDatePart = (value) => String(value).padStart(2, '0');

/**
 * Format a Date for a native date input without converting it to UTC first.
 * `toISOString()` can return yesterday for visitors east of UTC near midnight.
 */
export function localDateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-');
}

export function dateInputIsBeforeMinimum(value, minimum = localDateInputValue()) {
  const candidate = String(value || '').trim();
  const floor = String(minimum || '').trim();
  return Boolean(candidate && floor && candidate < floor);
}
