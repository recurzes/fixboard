import { useId } from "react";
import type { ComponentProps, ReactElement } from "react";

export type FieldText = { label: string; hint?: string; error?: string };

/** The hint and error text, and the attributes that link them to a control. */
export function fieldParts(id: string, hint?: string, error?: string) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return {
    aria: {
      "aria-describedby":
        [hint && hintId, error && errorId].filter(Boolean).join(" ") ||
        undefined,
      "aria-invalid": error ? true : undefined,
    },
    hintText: hint && (
      <p id={hintId} className="mb-1 text-sm text-gray-700">
        {hint}
      </p>
    ),
    errorText: error && (
      <p id={errorId} className="mt-1 text-sm font-medium text-red-700">
        {error}
      </p>
    ),
  };
}

export function Field({
  label,
  hint,
  error,
  children,
}: FieldText & {
  children: (
    control: { id: string } & ReturnType<typeof fieldParts>["aria"],
  ) => ReactElement;
}) {
  const id = useId();
  const { aria, hintText, errorText } = fieldParts(id, hint, error);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-medium">
        {label}
      </label>
      {hintText}
      {children({ id, ...aria })}
      {errorText}
    </div>
  );
}

const CONTROL =
  "w-full rounded-lg border border-gray-500 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700 disabled:bg-gray-100 disabled:text-gray-600 aria-invalid:border-2 aria-invalid:border-red-700";

type ControlProps<T extends "input" | "select" | "textarea"> = FieldText &
  Omit<ComponentProps<T>, "id" | "className">;

export function TextInput({
  label,
  hint,
  error,
  ...rest
}: ControlProps<"input">) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <input {...rest} {...control} className={`${CONTROL} min-h-11`} />
      )}
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  ...rest
}: ControlProps<"select">) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <select {...rest} {...control} className={`${CONTROL} min-h-11`} />
      )}
    </Field>
  );
}

export function Textarea({
  label,
  hint,
  error,
  ...rest
}: ControlProps<"textarea">) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <textarea
          {...rest}
          {...control}
          className={`${CONTROL} min-h-24 py-2`}
        />
      )}
    </Field>
  );
}
