import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MasterOption } from '../types';

interface Props {
  vendors: MasterOption[];
  value: number | '';
  onChange: (id: number | '') => void;
  placeholder?: string;
  required?: boolean;
}

export function VendorSelect({ vendors, value, onChange, placeholder = 'Select vendor', required }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync text when value changes externally (e.g. form reset)
  useEffect(() => {
    if (value === '') {
      setQuery('');
    } else {
      const found = vendors.find((v) => v.id === value);
      if (found) setQuery(found.name);
    }
  }, [value, vendors]);

  // Position dropdown under the input using viewport coords
  const updateDropdownPosition = () => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const listEl = document.getElementById('vendor-select-portal');
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(target) &&
        !(listEl && listEl.contains(target))
      ) {
        setOpen(false);
        // Restore label if user typed but didn't pick
        if (value !== '') {
          const found = vendors.find((v) => v.id === value);
          setQuery(found ? found.name : '');
        } else {
          setQuery('');
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, value, vendors]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    const handler = () => updateDropdownPosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]);

  const filtered = query.trim()
    ? vendors.filter((v) => v.name.toLowerCase().includes(query.toLowerCase()))
    : vendors;

  const handleSelect = (v: MasterOption) => {
    onChange(v.id);
    setQuery(v.name);
    setOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleFocus = () => {
    updateDropdownPosition();
    setOpen(true);
  };

  const dropdown = open && (
    <ul id="vendor-select-portal" className="vendor-select-list" style={dropdownStyle}>
      {filtered.length === 0 ? (
        <li className="vendor-select-empty-item">No vendors found</li>
      ) : (
        filtered.map((v) => (
          <li
            key={v.id}
            className={`vendor-select-item${v.id === value ? ' selected' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); handleSelect(v); }}
          >
            {v.name}
          </li>
        ))
      )}
    </ul>
  );

  return (
    <div className="vendor-select-wrap" ref={wrapperRef}>
      <div className="vendor-select-input-row">
        <input
          ref={inputRef}
          type="text"
          className="vendor-select-input"
          value={query}
          placeholder={placeholder}
          required={required && value === ''}
          onChange={(e) => {
            setQuery(e.target.value);
            updateDropdownPosition();
            setOpen(true);
            if (e.target.value === '') onChange('');
          }}
          onFocus={handleFocus}
          autoComplete="off"
        />
        {value !== '' && (
          <button type="button" className="vendor-select-clear" onClick={handleClear} tabIndex={-1}>
            ×
          </button>
        )}
      </div>
      {createPortal(dropdown, document.body)}
    </div>
  );
}
