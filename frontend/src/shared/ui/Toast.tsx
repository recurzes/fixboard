import { useCallback, useEffect, useState } from "react";

export type ToastMessage = {
  id: number;
  text: string;
  variant: "success" | "error";
};

const DISMISS_MS = 5000;
let nextId = 0;

/** The message showing, and `show()`. Each message clears itself after 5 seconds. */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  const show = useCallback(
    (text: string, variant: ToastMessage["variant"] = "success") =>
      setToast({ id: ++nextId, text, variant }),
    [],
  );
  return [toast, show] as const;
}

/** Render it always: a live region inserted along with its message is often not announced. */
export function Toast({ toast }: { toast: ToastMessage | null }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center"
    >
      {toast && (
        // The key makes the same text twice a new node, so it is announced again.
        <p
          key={toast.id}
          className={`rounded-lg px-4 py-3 font-semibold text-white shadow-lg ${toast.variant === "error" ? "bg-red-800" : "bg-gray-900"}`}
        >
          {toast.text}
        </p>
      )}
    </div>
  );
}
