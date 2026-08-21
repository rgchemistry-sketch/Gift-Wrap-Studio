export function firstEnabledOptionIndex(options) {
  return options.findIndex((option) => !option.disabled);
}

export function lastEnabledOptionIndex(options) {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index].disabled) return index;
  }
  return -1;
}

export function nextEnabledOptionIndex(options, currentIndex, direction) {
  if (!options.length) return -1;
  const enabledCount = options.filter((option) => !option.disabled).length;
  if (!enabledCount) return -1;

  let index = Number.isInteger(currentIndex) ? currentIndex : -1;
  for (let step = 0; step < options.length; step += 1) {
    index = (index + direction + options.length) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
}

export function findTypeaheadOptionIndex(options, query, startIndex = -1) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  if (!normalizedQuery || !options.length) return -1;

  for (let step = 1; step <= options.length; step += 1) {
    const index = (startIndex + step + options.length) % options.length;
    const option = options[index];
    if (!option.disabled && option.label.toLocaleLowerCase().startsWith(normalizedQuery)) {
      return index;
    }
  }
  return -1;
}
