import { useId } from "react";

export function NumberField({
  label,
  value,
  min = 1,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="num">
      <label htmlFor={id}>{label}</label>
      <div className="stepper">
        <button
          type="button"
          aria-label={`${label} verringern`}
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <input
          id={id}
          type="number"
          min={min}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        <button
          type="button"
          aria-label={`${label} erhöhen`}
          disabled={disabled}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
