// Shared input primitives for the spec forms — keeps each per-category form
// concise. All fields are controlled and call the parent's onChange so spec
// edits are local until exported.

interface NumberFieldProps {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}

export function NumberField({
  label,
  value,
  onChange,
  unit = "mm",
  min,
  max,
  step = 1,
}: NumberFieldProps) {
  return (
    <div className="spec-field">
      <label>{label}</label>
      <div className="spec-input-row">
        <input
          type="number"
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="unit">{unit}</span>
      </div>
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  suggestions?: readonly string[];
  placeholder?: string;
}

export function TextField({
  label,
  value,
  onChange,
  suggestions,
  placeholder,
}: TextFieldProps) {
  const listId = suggestions ? `dl-${label.replace(/\s/g, "-")}` : undefined;
  return (
    <div className="spec-field">
      <label>{label}</label>
      <input
        type="text"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
      />
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  formatOption?: (v: T) => string;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  formatOption,
}: SelectFieldProps<T>) {
  return (
    <div className="spec-field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {formatOption ? formatOption(o) : o}
          </option>
        ))}
      </select>
    </div>
  );
}

interface BoolFieldProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

export function BoolField({ label, value, onChange }: BoolFieldProps) {
  return (
    <div className="spec-field row">
      <label>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    </div>
  );
}

interface ColorFieldProps {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
}

export function ColorField({ label, value, onChange }: ColorFieldProps) {
  return (
    <div className="spec-field row">
      <label>{label}</label>
      <div className="spec-input-row">
        <input
          type="color"
          value={value ?? "#888888"}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 80, fontFamily: "ui-monospace, monospace" }}
        />
      </div>
    </div>
  );
}

export function SpecGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="spec-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}
