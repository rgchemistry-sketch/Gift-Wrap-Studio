import { useId } from 'react';
import Dropdown from 'react-bootstrap/Dropdown';
import Icon from '../Icon';

export default function AdminStatusDropdown({
  value,
  options,
  onChange,
  disabled = false,
  busy = false,
  label = 'Change status',
  align = 'end',
}) {
  const id = useId();
  const selected = options.find((option) => option.value === value) || options[0];

  return (
    <Dropdown
      className={`admin-status-dropdown status-${selected.value}`}
      align={align}
      onSelect={(nextValue) => {
        if (nextValue && nextValue !== value && !disabled && !busy) onChange(nextValue);
      }}
    >
      <Dropdown.Toggle
        id={`admin-status-${id.replaceAll(':', '')}`}
        disabled={disabled || busy}
        aria-label={`${label}. Current value: ${selected.label}`}
        className="admin-status-dropdown__toggle"
      >
        <span className="admin-status-dot" aria-hidden="true" />
        <span>{busy ? 'Updating…' : selected.label}</span>
        <Icon name="arrow" size={13} />
      </Dropdown.Toggle>
      <Dropdown.Menu
        className="admin-status-dropdown__menu"
        popperConfig={{ strategy: 'fixed' }}
      >
        <div className="admin-status-dropdown__label" aria-hidden="true">Move to</div>
        {options.map((option) => (
          <Dropdown.Item
            key={option.value}
            eventKey={option.value}
            active={option.value === value}
          >
            <span className={`admin-status-dot status-${option.value}`} aria-hidden="true" />
            <span>{option.label}</span>
            {option.value === value && <Icon name="check" size={14} />}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}
