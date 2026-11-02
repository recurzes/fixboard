import { useEffect } from "react";

/** The browser's own "Leave site?" prompt on refresh or close, while `when` is true. */
export function useLeaveWarning(when: boolean) {
  useEffect(() => {
    if (!when) return;
    const warn = (event: BeforeUnloadEvent) => {
      // Chromium fires this for tel: links too, and a call must never wait on a prompt.
      // shortcut: relies on a clicked link taking focus, which desktop Safari skips, so it still prompts there.
      if (document.activeElement?.matches('a[href^="tel:"]')) return;
      event.preventDefault();
      // Chrome and Edge before 119 ignore preventDefault here.
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [when]);
}
