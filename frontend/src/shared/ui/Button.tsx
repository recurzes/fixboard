import type { ComponentProps } from "react";
import { Spinner } from "./Feedback";

export function Button({
  loading = false,
  disabled,
  type = "button",
  className = "",
  children,
  ...rest
}: ComponentProps<"button"> & { loading?: boolean }) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:bg-gray-300 disabled:text-gray-700 ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
