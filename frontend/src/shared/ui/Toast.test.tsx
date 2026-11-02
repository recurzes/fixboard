import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Toast, useToast } from "./Toast";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

it("a toast appears inside a live region that was already there, then goes after 5 seconds", async () => {
  vi.useFakeTimers();
  let show: ReturnType<typeof useToast>[1] = () => {};
  function Demo() {
    const [toast, showToast] = useToast();
    show = showToast;
    return <Toast toast={toast} />;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Demo />));
  const region = container.querySelector('[aria-live="polite"]')!;
  expect(region.textContent).toBe("");

  await act(async () => show("Saved"));
  expect(container.querySelector('[aria-live="polite"]')).toBe(region);
  expect(region.textContent).toBe("Saved");

  await act(async () => vi.advanceTimersByTime(4999));
  expect(region.textContent).toBe("Saved");
  await act(async () => vi.advanceTimersByTime(1));
  expect(region.textContent).toBe("");

  act(() => root.unmount());
  vi.useRealTimers();
});
