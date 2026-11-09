import { useState } from 'react';
import { Input } from '../../ui/input';

/** A money or quantity field that keeps what is typed until it loses focus. */
export default function NumericInput({ value, onChange, placeholder = '0.00', className = '', disabled = false }: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const displayed = raw !== null ? raw : (value === 0 ? '' : String(value));

  return (
    <Input
      type="text"
      disabled={disabled}
      value={displayed}
      onChange={e => {
        let v = e.target.value.replace(/[^0-9.]/g, '');
        // Allow only one decimal point
        const dots = v.split('.').length - 1;
        if (dots > 1) {
          const parts = v.split('.');
          v = parts[0] + '.' + parts.slice(1).join('');
        }
        setRaw(v);
        const num = parseFloat(v);
        if (!isNaN(num)) {
          if (num !== value) onChange(num);
        } else if (v === '') {
          if (value !== 0) onChange(0);
        }
      }}
      onBlur={() => setRaw(null)}
      placeholder={placeholder}
      className={className}
    />
  );
}
