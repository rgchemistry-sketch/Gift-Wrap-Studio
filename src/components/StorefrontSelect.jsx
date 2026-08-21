import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  findTypeaheadOptionIndex,
  firstEnabledOptionIndex,
  lastEnabledOptionIndex,
  nextEnabledOptionIndex,
} from '../utils/storefront-select';
import '../storefront-select.css';

const TYPEAHEAD_RESET_MS = 650;

function normalizeOption(option) {
  if (typeof option === 'string') return { value: option, label: option, disabled: false };
  return {
    value: String(option.value ?? ''),
    label: String(option.label ?? option.value ?? ''),
    disabled: Boolean(option.disabled),
  };
}

export default function StorefrontSelect({
  id,
  name,
  value,
  options,
  onChange,
  disabled = false,
  required = false,
  invalid = false,
  ariaDescribedBy,
  ariaLabel,
  className = '',
}) {
  const generatedId = useId().replace(/:/g, '');
  const controlId = id || `studio-select-${generatedId}`;
  const listboxId = `${controlId}-options`;
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const typeaheadRef = useRef({ query: '', timer: null });
  const normalizedOptions = useMemo(() => options.map(normalizeOption), [options]);
  const selectedIndex = normalizedOptions.findIndex((option) => option.value === String(value ?? ''));
  const selectedOption = normalizedOptions[selectedIndex] || normalizedOptions[0];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [placement, setPlacement] = useState('bottom');

  useEffect(() => {
    if (!open) return undefined;

    const closeOnOutsidePointer = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    const choosePlacement = () => {
      const rectangle = buttonRef.current?.getBoundingClientRect();
      if (!rectangle) return;
      const estimatedMenuHeight = Math.min(300, normalizedOptions.length * 50 + 16);
      const roomBelow = window.innerHeight - rectangle.bottom;
      setPlacement(roomBelow < estimatedMenuHeight && rectangle.top > roomBelow ? 'top' : 'bottom');
    };

    choosePlacement();
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('resize', choosePlacement);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('resize', choosePlacement);
    };
  }, [normalizedOptions.length, open]);

  useEffect(() => () => {
    if (typeaheadRef.current.timer) window.clearTimeout(typeaheadRef.current.timer);
  }, []);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const menu = menuRef.current;
    const activeOption = menu?.children[activeIndex];
    if (!menu || !activeOption) return;
    const optionTop = activeOption.offsetTop;
    const optionBottom = optionTop + activeOption.offsetHeight;
    if (optionTop < menu.scrollTop) menu.scrollTop = optionTop;
    else if (optionBottom > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = optionBottom - menu.clientHeight;
    }
  }, [activeIndex, open]);

  const openMenu = (preferredIndex = selectedIndex) => {
    if (disabled) return;
    const fallbackIndex = firstEnabledOptionIndex(normalizedOptions);
    const nextIndex = preferredIndex >= 0 && !normalizedOptions[preferredIndex]?.disabled
      ? preferredIndex
      : fallbackIndex;
    setActiveIndex(nextIndex);
    setOpen(true);
  };

  const selectOption = (index) => {
    const option = normalizedOptions[index];
    if (!option || option.disabled) return;
    onChange(option.value, option);
    setActiveIndex(index);
    setOpen(false);
    window.requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  };

  const moveActive = (direction) => {
    setActiveIndex((current) => nextEnabledOptionIndex(normalizedOptions, current, direction));
  };

  const handleTypeahead = (key) => {
    const state = typeaheadRef.current;
    if (state.timer) window.clearTimeout(state.timer);
    state.query += key.toLocaleLowerCase();
    const startIndex = open ? activeIndex : selectedIndex;
    let match = findTypeaheadOptionIndex(normalizedOptions, state.query, startIndex);
    if (match < 0 && state.query.length > 1) {
      state.query = key.toLocaleLowerCase();
      match = findTypeaheadOptionIndex(normalizedOptions, state.query, startIndex);
    }
    if (match >= 0) {
      if (open) setActiveIndex(match);
      else selectOption(match);
    }
    state.timer = window.setTimeout(() => {
      state.query = '';
      state.timer = null;
    }, TYPEAHEAD_RESET_MS);
  };

  const handleKeyDown = (event) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu();
      else moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const edgeIndex = event.key === 'Home'
        ? firstEnabledOptionIndex(normalizedOptions)
        : lastEnabledOptionIndex(normalizedOptions);
      if (!open) openMenu(edgeIndex);
      else setActiveIndex(edgeIndex);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open && activeIndex >= 0) selectOption(activeIndex);
      else openMenu();
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      handleTypeahead(event.key);
    }
  };

  const activeOptionId = open && activeIndex >= 0 ? `${controlId}-option-${activeIndex}` : undefined;
  const wrapperClasses = [
    'storefront-select',
    open ? 'is-open' : '',
    invalid ? 'is-invalid' : '',
    disabled ? 'is-disabled' : '',
    selectedOption?.value === '' ? 'is-placeholder' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={wrapperRef}
      className={wrapperClasses}
      data-placement={placement}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      <button
        ref={buttonRef}
        id={controlId}
        type="button"
        className="storefront-select__trigger"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={activeOptionId}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="storefront-select__value">{selectedOption?.label || 'Choose an option'}</span>
        <span className="storefront-select__chevron" aria-hidden="true" />
      </button>

      {open && (
        <ul ref={menuRef} id={listboxId} className="storefront-select__menu" role="listbox" aria-label={ariaLabel}>
          {normalizedOptions.map((option, index) => (
            <li
              id={`${controlId}-option-${index}`}
              key={`${option.value}-${index}`}
              className={[
                'storefront-select__option',
                selectedIndex === index ? 'is-selected' : '',
                activeIndex === index ? 'is-active' : '',
                option.disabled ? 'is-disabled' : '',
              ].filter(Boolean).join(' ')}
              role="option"
              aria-selected={selectedIndex === index}
              aria-disabled={option.disabled || undefined}
              onPointerMove={() => {
                if (!option.disabled) setActiveIndex(index);
              }}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectOption(index)}
            >
              <span>{option.label}</span>
              <span className="storefront-select__check" aria-hidden="true">✓</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
