import { useId } from "react";
import type { ComponentProps } from "react";
import { fieldParts } from "./Field";
import type { FieldText } from "./Field";

// Native inputs, because they already handle arrow keys, space, and screen readers.
const INPUT = "size-5 shrink-0 accent-blue-700";

export function RadioGroup({
  label,
  hint,
  error,
  options,
  value,
  onChange,
  disabled,
}: FieldText & {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const { aria, hintText, errorText } = fieldParts(id, hint, error);
  return (
    <fieldset role="radiogroup" disabled={disabled} {...aria}>
      <legend className="mb-1 font-medium">{label}</legend>
      {hintText}
      <div className="space-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 items-center gap-3 rounded-lg border border-gray-500 px-3 py-2 has-checked:border-2 has-checked:border-blue-700 has-checked:bg-blue-50 has-disabled:bg-gray-100 has-disabled:text-gray-600"
          >
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className={INPUT}
            />
            {option.label}
          </label>
        ))}
      </div>
      {errorText}
    </fieldset>
  );
}

export function Checkbox({
  label,
  hint,
  error,
  ...rest
}: FieldText & Omit<ComponentProps<"input">, "type" | "className">) {
  const id = useId();
  const { aria, hintText, errorText } = fieldParts(id, hint, error);
  return (
    <div>
      {hintText}
      <label className="flex min-h-11 items-center gap-3 py-2 has-disabled:text-gray-600">
        <input {...rest} {...aria} type="checkbox" className={INPUT} />
        {label}
      </label>
      {errorText}
    </div>
  );
}
