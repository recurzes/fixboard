import { useEffect, useId, useRef } from "react";
import type { ComponentProps } from "react";
import { Button } from "./Button";

/**
 * The native dialog opened with showModal() traps focus, closes on Esc, and puts focus back where
 * it was, so none of that is written here. Content renders only while open.
 */
export function Modal({
  open,
  onClose,
  title,
  className = "",
  children,
  ...rest
}: Omit<ComponentProps<"dialog">, "open" | "onClose"> & {
  open: boolean;
  onClose: () => void;
  title: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      {...rest}
      ref={ref}
      aria-labelledby={titleId}
      // Esc and the Close button both end here, so there is one way out.
      onClose={onClose}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl rounded-lg p-4 backdrop:bg-black/60 ${className}`}
    >
      {open && (
        <>
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id={titleId} className="text-xl font-semibold">
              {title}
            </h2>
            <Button onClick={() => ref.current!.close()}>Close</Button>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}
