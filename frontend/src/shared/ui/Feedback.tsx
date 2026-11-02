import type { ReactNode } from "react";

const ALERTS = {
  info: { word: "Info", className: "border-blue-700 bg-blue-50" },
  warning: { word: "Warning", className: "border-amber-600 bg-amber-50" },
  error: { word: "Error", className: "border-red-700 bg-red-50" },
};

export function Alert({
  variant,
  children,
}: {
  variant: keyof typeof ALERTS;
  children: ReactNode;
}) {
  const { word, className } = ALERTS[variant];
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`rounded-lg border-l-4 p-3 ${className}`}
    >
      <strong>{word}:</strong> {children}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-gray-400 p-6 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-gray-700">{children}</div>}
    </div>
  );
}

const BADGES = {
  neutral: "bg-gray-200 text-gray-900",
  info: "bg-blue-100 text-blue-900",
  warning: "bg-amber-100 text-amber-900",
  error: "bg-red-100 text-red-900",
  strong: "bg-blue-900 text-white",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof BADGES;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-sm font-medium ${BADGES[tone]}`}
    >
      {children}
    </span>
  );
}
